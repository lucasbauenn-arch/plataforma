// Edge Function pre-cadastro (pública; docs/ARQUITETURA_EXPANSAO.md §6.1, H4, N9, CRM-3).
// POST { codigo, tipo_pessoa, nome, sobrenome?, documento, email?, telefone, termo_id, captcha }
//   1. limite por IP em tentativas_publicas, com reserva atômica no banco (10 erros ou 20 tentativas em 15 min → 429);
//   2. Turnstile (falha fechada em produção);
//   3. formato: DV de CPF/CNPJ, telefone com DDD, termo_id uuid (dados.ts);
//   4. rpc crm_pre_cadastro com a service role (RPC de sistema, grant só para service_role), com o IP e o navegador.
// Resposta: 200 {ok:true} IGUAL para criado e duplicado (ninguém descobre se um CPF está na base; a confirmação por
// e-mail também é a mesma, posta na fila pela RPC); 404 para código inválido ou inativo; 503 sem termo revisado pelo
// jurídico (H4); 409 termo desatualizado (a página relê o termo); 429 limite do link (A2) ou por IP; 422 dados
// inválidos; toda tentativa é registrada. Nunca registra no log os dados enviados.
import { agenteUsuario, criarRota, ipCliente, lerJson } from "../_shared/http.ts";
import { corsDoSite, validarCaptcha } from "../_shared/ambiente.ts";
import { MENSAGEM_TURNSTILE, statusFalhaTurnstile } from "../_shared/turnstile.ts";
import { REGRA_PRE_CADASTRO, reservarTentativa, respostaDoBloqueio } from "../_shared/limite-ip.ts";
import { armazemTentativas, clienteAdmin } from "../_shared/supabase.ts";
import {
  camposDoDetalhe, MENSAGEM_DADOS, MENSAGEM_LINK_INVALIDO, respostaDaSituacao, validarPreCadastro,
} from "./dados.ts";

Deno.serve(criarRota({ nome: "pre-cadastro", cors: corsDoSite() }, async (req, r) => {
  const ip = ipCliente(req);
  const armazem = armazemTentativas();
  // reserva atômica (FR1-01): conferir e gravar num passo só, no banco; uma rajada simultânea não passa do limite.
  // A reserva já vale como falha; só o pré-cadastro aceito a confirma como sucesso.
  const limite = await reservarTentativa(armazem, [{ regra: REGRA_PRE_CADASTRO, ip }]);
  if (!limite.permitido) {
    const b = respostaDoBloqueio(limite, REGRA_PRE_CADASTRO);
    return r.erro(b.status, b.mensagem, { codigo: b.codigo, cabecalhos: b.cabecalhos });
  }
  const registrar = (sucesso: boolean) => limite.concluir(sucesso);
  const falhar = async (resposta: Response) => {
    await registrar(false);
    return resposta;
  };

  const corpo = await lerJson(req);
  if (!corpo.ok) return falhar(r.erro(corpo.status, corpo.erro, { codigo: corpo.codigo }));

  const captcha = await validarCaptcha(corpo.valor.captcha, ip);
  if (!captcha.ok) return falhar(r.erro(statusFalhaTurnstile(captcha), MENSAGEM_TURNSTILE));

  const pedido = validarPreCadastro(corpo.valor);
  if (!pedido.ok) {
    return pedido.campos.includes("codigo")
      ? falhar(r.erro(404, MENSAGEM_LINK_INVALIDO, { codigo: "codigo_invalido" }))
      : falhar(r.erro(422, MENSAGEM_DADOS, { detalhes: { campos: pedido.campos } }));
  }

  const { codigo, termoId, dados } = pedido.valor;
  const { data, error } = await clienteAdmin().rpc("crm_pre_cadastro", {
    p_codigo: codigo,
    p_dados: dados,
    p_termo_id: termoId,
    p_ip: ip,
    p_user_agent: agenteUsuario(req),
  });
  if (error) {
    await registrar(false);
    if (error.code === "P0001" && error.message === "DADOS_INVALIDOS") {
      return r.erro(422, MENSAGEM_DADOS, { detalhes: { campos: camposDoDetalhe(error.details) } });
    }
    // só o código do erro vai para o log (a mensagem do banco nunca leva os dados enviados, mas por garantia)
    throw new Error(`crm_pre_cadastro falhou (${error.code ?? "sem código"})`);
  }

  const resposta = respostaDaSituacao((data as { situacao?: unknown } | null)?.situacao);
  if (!resposta) {
    await registrar(false);
    throw new Error("crm_pre_cadastro: resposta inesperada");
  }
  await registrar(resposta.sucesso);
  return resposta.status === 200
    ? r.json(resposta.corpo)
    : r.erro(resposta.status, resposta.mensagem, { codigo: resposta.codigo });
}));
