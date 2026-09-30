# Deploy da expansão no projeto remoto (xucwjsycawizrlouqkvh)

Ordem segura, testada no banco isolado (ver "O que foi testado"). As migrations 20260929000001–09 já estão no remoto e nunca
mais são editadas; este roteiro aplica 10–19. Ninguém deve rodar `db push`, `functions deploy`, `secrets set` ou `config push`
fora desta ordem.

## 0. Antes de tudo

1. Espaço livre no disco e Docker de pé (o CLI empacota funções com Docker; por isso todo `functions deploy` abaixo usa
   `--use-api`, que empacota no servidor e não precisa do Docker).
2. Backup fora do repositório: `supabase db dump -f <arquivo>.sql` (esquema) e `supabase db dump --data-only -f <arquivo>-dados.sql`.
3. Prévia do corte no SQL editor do remoto: `scripts/migracao/previa.sql` (só leitura; a saída tem dado pessoal, não salvar).
   Conferir com o negócio: conflitos de CPF, juntadas com nome ou RG diferentes (seção 10), parceiros bloqueados/pendentes sem
   CPF e CRECI (seção 5). Decisões (`dono_cpf`, `etapa_cliente_portal`) entram em `migracao_decisoes` ANTES do push.
4. Segredos das Edge Functions (só os nomes; conferir no painel, nunca imprimir valores):

   | Segredo | Para quê |
   |---|---|
   | `AMBIENTE=producao` | todas. Sem ele vale "desenvolvimento": CORS aceita localhost e o Turnstile é dispensado se faltar o segredo |
   | `SITE_URL` | CORS (com e sem www) e links de e-mail |
   | `TURNSTILE_SECRET` | `pre-cadastro` e `enviar-lead` (em produção, sem ele as duas recusam com 503) e o captcha do Auth (passo 4). **A secret REAL de produção**, par da chave de site do build (item 5). A secret de teste da Cloudflare (`1x0000…AA`) NUNCA entra aqui, nem em `supabase/.env` no momento do `config push`: com ela o captcha aprova qualquer token |
   | `RESEND_API_KEY`, `WEBHOOK_SECRET`, `NOTIFICAR_PARA` (`NOTIFICAR_REMETENTE` opcional) | `notificar` |
   | `CRON_SEGREDO` | `d4sign-reconciliar` |
   | `D4SIGN_TOKEN`, `D4SIGN_CRYPT_KEY`, `D4SIGN_COFRE_UUID` (`D4SIGN_URL`, `D4SIGN_HMAC_SECRET` opcionais) | contratos (só quando a conta D4Sign existir) |
   | `RESEND_URL` | NÃO definir em produção |

5. **Turnstile de produção (FR1-02).** O `.env` de desenvolvimento usa a chave de TESTE da Cloudflare (`VITE_TURNSTILE_SITE_KEY=1x0000…AA`,
   sempre aprova), e a chave de site é gravada NO BUNDLE pelo `npm run build`. Antes do deploy:
   - no painel da Cloudflare (Turnstile), criar o widget de produção com os hostnames restritos a `arkenincorporadora.com.br` e
     `www.arkenincorporadora.com.br` (um token de outro site não vale). Ele dá o par: chave de site e secret;
   - a **secret** vai para `TURNSTILE_SECRET` (segredos das Edge Functions, item 4, e `supabase/.env` só na hora do `config push`);
   - a **chave de site** vai para `VITE_TURNSTILE_SITE_KEY` do build de produção (passo 5). Use um arquivo `.env.production.local` (não
     versionado, o Vite lê no `vite build` e ele vence o `.env`), assim o `.env` de desenvolvimento segue com a chave de teste;
   - os dois lados têm de ser do MESMO par: chave de teste no front + secret real no servidor recusa todo token (login, cadastro,
     recuperação de senha, pré-cadastro e contato falham para todos); chave real no front + secret de teste no servidor deixa o
     captcha inútil.
6. Vault do banco: `notificar_url` e `notificar_secret` (16+ caracteres, igual a `WEBHOOK_SECRET`); `d4sign_reconciliar_url` e
   `cron_segredo` (16+ caracteres, igual a `CRON_SEGREDO`) só quando a conta D4Sign existir.

## 1. Publicar o `cliente-login` NOVO, antes do banco (DEP-01), e ir direto ao passo 2

```
supabase functions deploy cliente-login --use-api
```

Por que primeiro: a função antiga procura o cliente só por CPF, sem filtrar `portal_liberado`, inativado nem anonimizado. Depois do
`db push` da 18 a tabela `clientes` passa a ter os clientes do CRM migrados (`portal_liberado = false`); até a função nova entrar, quem
digitasse o CPF de um deles receberia uma sessão do portal (e a função antiga gravaria conta no Auth, `profiles.papel = 'cliente'` e
`clientes.user_id` nessa ficha). A função nova é compatível com o banco de ANTES e de DEPOIS: enquanto `portal_localizar_cliente` é o
esqueleto da 09 (erro `0A000`), ela lê `clientes` com o mesmo filtro; depois da 15, usa a RPC. Ela também passa a criar a conta do
portal com `app_metadata.portal_cliente_id` e nunca adota conta que só tenha o e-mail interno do cliente (WP7R1-02); a conta legada do
cliente do portal atual (criada pela versão antiga, confirmada na criação) recebe o marcador no primeiro login.

**Atenção (FR1-01):** a função nova limita as tentativas por IP com a reserva atômica do banco (RPC `tentativas_reservar`, migration 19).
Enquanto o passo 2 não terminar, essa RPC não existe e o login do portal responde **503** ("Serviço indisponível"): é a falha fechada, o
esperado (nunca libera sem contar). O site, o painel e os parceiros não usam essa função. Por isso: publique e siga para o passo 2 sem
pausa, e só confira o login do portal DEPOIS do push.

## 2. `supabase db push` (migrations 10–19, cada uma na sua transação)

Conferir logo depois (SQL editor):

```sql
select acao, detalhe from public.auditoria where acao = 'migracao' order by id desc limit 1;   -- totais do corte
select tipo, count(*) from public.migracao_pendencias where resolvido_em is null group by 1;  -- fila para o negócio
select jobname from cron.job order by 1;                                                     -- 5 tarefas arken-*
select id from public.clientes where user_id is not null and not portal_liberado;             -- deve vir vazio (DEP-01)
select proname from pg_proc where pronamespace = 'public'::regnamespace
   and proname in ('tentativas_reservar', 'tentativas_confirmar') order by 1;                 -- 2 linhas (migration 19)
```

Se a penúltima consulta trouxer linhas, a função antiga rodou na janela: anular `user_id` dessas fichas e remover as contas Auth criadas.

Conferir o `cliente-login` (agora com o banco completo): login por CPF do cliente do portal atual entra; CPF inexistente → 404
"CPF não encontrado".

## 3. Demais funções (todas com `--use-api`)

```
supabase functions deploy convidar-parceiros --use-api
supabase functions deploy pre-cadastro --use-api
supabase functions deploy enviar-lead --use-api
supabase functions deploy notificar --use-api
supabase functions deploy baixar-arquivo --use-api
supabase functions deploy lgpd-anonimizar --use-api
supabase functions deploy contrato-gerar --use-api
supabase functions deploy contrato-assinatura --use-api
supabase functions deploy d4sign-webhook --use-api
supabase functions deploy d4sign-reconciliar --use-api
```

`convidar-parceiros`, `baixar-arquivo`, `lgpd-anonimizar` e as de contrato dependem das RPCs da 10–15 (por isso vêm DEPOIS do push);
`pre-cadastro` e `enviar-lead` dependem da 19 (reserva de tentativas).
`enviar-lead` novo recusa sem `TURNSTILE_SECRET` em produção e só aceita as origens de `SITE_URL`.

## 4. `supabase config push` (depois do push e das funções)

O diff que o comando mostra é a conferência (não foi possível ler o `[auth]` remoto daqui; ver DEP-02 no comentário do `config.toml`):

- esperado: hook `custom_access_token` (a função existe desde a 09), MFA TOTP, `otp_length` 6 → 10;
- `otp_expiry`: se o remoto estiver em 600 (registro de 22/09 no PRD), o push amplia para 86400 (24 h dos convites por WhatsApp);
  intencional e seguro com 10 dígitos. Se o diff mostrar QUALQUER outra mudança de `[auth]`, parar e revisar;
- `TURNSTILE_SECRET` e `RESEND_API_KEY` precisam estar no ambiente (ou em `supabase/.env`, fora do Git). O `[auth.captcha]` do
  `config.toml` usa `env(TURNSTILE_SECRET)`: confira que é a secret REAL (item 5 do passo 0), não a de teste.

Risco: com o hook ligado e a função com erro, nenhum login funciona; voltar atrás = desligar o hook no painel do Auth.

## 5. Front e primeiros acessos

1. Chave de site real do Turnstile (item 5 do passo 0) em `.env.production.local`, depois:

   ```
   npm run build
   npm run conferir:dist
   ```

   O `conferir:dist` falha se o build tiver a chave de TESTE do Turnstile, não tiver chave real, ou trouxer segredo (chave
   `sb_secret_…`, JWT `service_role`). Só envie `dist/` (Hostinger) com ele verde: os links de convite e recuperação apontam para o front novo.
2. O `public/.htaccess` (vai junto no `dist/`) agora define HSTS e a política de segurança de conteúdo (CSP, FR1-03), que fixa o endereço
   do projeto Supabase e os serviços externos usados. Depois do envio, abrir o site, `/parceiros`, `/portal-do-cliente` e `/admin` com o
   console do navegador aberto: nenhuma mensagem "Refused to … Content Security Policy". Se aparecer, o comentário no `.htaccess`
   diz onde ajustar; para diagnosticar sem bloquear, troque o nome do cabeçalho por `Content-Security-Policy-Report-Only`. Trocar o
   projeto Supabase ou incluir um serviço externo pede a atualização da CSP.
3. Definir o Super (N2) pelo SQL editor (depois da 17, `profiles` não tem mais UPDATE pela API); o Super cadastra o TOTP e só então
   liga `exigir_mfa_interno`.
4. Parceiro bloqueado ou inativo no sistema antigo e sem CPF/CRECI: para aprovar, completar o cadastro na Rede e desbloquear (a
   primeira aprovação exige os dois campos, WP7RN-01).

## O que foi testado

- Banco isolado nas duas pontas: com só as migrations 01–09 (estado do remoto) a leitura direta do `cliente-login` usa colunas que
  existem (`tipo_pessoa`, `portal_liberado`, `inativado_em`, `anonimizado_em`); com 01–18 a RPC e a leitura direta devolvem o mesmo
  resultado, e a consulta da função antiga devolve o cliente do CRM que a nova recusa (a janela do DEP-01).
- `supabase/functions/cliente-login/portal.test.ts` (Vitest): desvio para a leitura direta só no erro `0A000`, limite por IP (IPv6 /64,
  sem IP, teto global), e a conta do Auth (marcador, conta legada, conta hostil nunca adotada, corrida entre dois primeiros logins).
- Reserva atômica de tentativas (FR1-01, migration 19): `supabase/tests/tentativas.test.sql` (pgTAP: regra, janela, tudo-ou-nada,
  trava, grants, entrada inválida) e `supabase/functions/_shared/limite-ip.test.ts` (Vitest: rajadas simultâneas, com a contra-prova
  do defeito antigo). Em Postgres 17 real com 60 conexões simultâneas: 300 requisições do mesmo IP → só 10 passam; 1000 de 250 IPs
  com dois baldes em ordens opostas → só 300 passam no teto global, sem deadlock; trava presa → a segunda chamada desiste em 3 s (55P03).
- Ensaio sobre uma cópia dos dados reais (backup anterior à 09): migrations 01–18 em ordem, cada uma com `psql -1`, conferindo os
  totais do corte e o escopo do admin, do parceiro de teste e do cliente do portal. (A 19 só depende da tabela `tentativas_publicas`,
  da 02.)
