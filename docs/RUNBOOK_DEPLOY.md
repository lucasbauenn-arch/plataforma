# Runbook de deploy da expansão no remoto (projeto `xucwjsycawizrlouqkvh`)

Passo a passo, na **ordem segura validada**, para publicar a expansão (rede de parceiros, CRM, contratos, imóveis, governança). Quem executa é o dono do projeto ou alguém com a CLI logada nele. O detalhe técnico do banco e das funções está em `scripts/migracao/DEPLOY.md`; o desenho, em `docs/ARQUITETURA_EXPANSAO.md` (§10.7); o que depende do negócio, em `docs/PRD.md` §13.1.

**Ordem em uma linha:** preparar (gate, backup, ensaio, prévia, segredos) → `cliente-login` novo **antes** do banco → `db push` das 10 a 19 → demais funções → `config push` → front (`build` + `conferir:dist`) → Super pelo SQL → TOTP → `exigir_mfa_interno` → pós-go-live.

Regras que valem o tempo todo:
- Nada de `db push`, `functions deploy`, `secrets set` ou `config push` fora desta ordem. Use **só a CLI** (o conector MCP do Supabase da máquina aponta para outra conta).
- **Nunca** cole segredo em chat, ticket, commit, histórico de terminal ou no SQL editor. Segredos entram por `supabase secrets set --env-file <arquivo fora do repositório>` (apague o arquivo depois) e, no Vault, pelo painel (Database → Vault).
- As migrations `20260929000001` a `09` **já estão no remoto e nunca mais são editadas**. Correção nelas, ou em qualquer migration depois do `db push`, vai em migration nova (`20260929000020` em diante).
- Os passos 1 a 5 são feitos numa janela só, em sequência, sem pausa longa (cerca de 30 minutos, de preferência com pouco uso). Durante ela: o portal do cliente responde 503 entre os passos 1 e 2; as telas antigas de parceiro e admin deixam de funcionar assim que a 18 entra (o front novo as substitui no passo 5). O site público e os relatórios não são afetados.

## Estado de partida

| Camada | No remoto hoje | Vai neste deploy |
|---|---|---|
| Banco | migrations até `20260923000001` e a `20260929000001` a `09` (WP0) | `20260929000010` a `19` |
| Edge Functions | `cliente-login`, `enviar-lead`, `notificar`, `convidar-parceiros` (versões antigas) | as 4 novas versões e as 7 novas (`pre-cadastro`, `baixar-arquivo`, `lgpd-anonimizar`, `contrato-gerar`, `contrato-assinatura`, `d4sign-webhook`, `d4sign-reconciliar`) |
| Auth (`config.toml`) | o de 22/09 (não foi lido antes deste roteiro) | hook de token, TOTP, `otp_length = 10` |
| Front (Hostinger) | ainda não publicado (o deploy do site nunca aconteceu) | `dist/` novo |
| Dados | só de teste: 3 perfis, 1 cliente do portal, 3 `parceiro_clientes`, 5 propostas, 0 leads | migrados pela 18 |

## Passo 0. Preparação (nada aqui altera o remoto)

**0.1 Gate de qualidade.** Só siga com tudo verde na versão exata que vai subir; se qualquer arquivo de `supabase/migrations/…10` a `19`, `supabase/functions` ou `public/.htaccess` mudar depois, repita:
```
npm run typecheck && npm run lint && npm test && npm run test:e2e
BASE_ATE=20260929999999 PARAR_AO_FINAL=1 bash scripts/testar-db.sh gate 54852 "" todos      # pgTAP com todas as migrations
```
O pgTAP completo precisa passar inteiro, **com a 19** (`tentativas.test.sql`). A última rodada completa (2.144 asserções) foi antes da 19: rode de novo. Derrube o banco ao terminar (`… parar`).

**0.2 Máquina.** Espaço livre no C: e Docker de pé (o disco cheio derrubou o Docker Desktop; com ele fora não há backup nem ensaio). CLI logada (`supabase login`) e o projeto vinculado (`supabase/.temp/project-ref` = `xucwjsycawizrlouqkvh`). No máximo um banco isolado por vez.

**0.3 Backup** (fora do repositório; tem dado pessoal, guarde em disco protegido e apague quando não precisar mais):
```
supabase db dump -f <pasta>/schema-<data>.sql
supabase db dump --data-only -f <pasta>/dados-<data>.sql
supabase migration list        # local × remoto: 01–09 nos dois lados, 10–19 só no local
```
O dump **não** inclui os arquivos dos buckets do Storage; este deploy não mexe neles. Conferência do ponto de partida (SQL editor): o que foi aplicado no remoto tem que ser igual ao repositório.
```sql
select count(*) from supabase_migrations.schema_migrations where version like '20260929%';   -- 9
select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects'
  and cmd in ('SELECT', 'ALL') and (coalesce(qual, '') || coalesce(with_check, '')) ~ '(crm-documentos|contratos)';   -- 0 linhas
```
Se a segunda consulta trouxer linha, a 09 aplicada difere da do repositório (o download por RPC + Edge exige buckets **sem** política de leitura): pare e corrija por migration nova antes de seguir.
*Reverter:* não há o que reverter.

**0.4 Ensaio com dados reais** (banco isolado, nunca o remoto). Repita sempre que 10–19 mudarem:
1. `BASE_ATE=20260929000009 bash scripts/testar-db.sh ensaio 54840 "" "" so-aplicar` (o esquema idêntico ao remoto).
2. Trocar os dados locais pelos do backup: `docker exec -i supabase_db_arken-ensaio psql -U postgres -v ON_ERROR_STOP=1` com `set session_replication_role = replica;`, `truncate` cascade de todas as tabelas de `public` e de `auth.users`, `delete` em `storage.objects` e `storage.buckets`, e então o arquivo `dados-<data>.sql` do backup. Se `storage.buckets` ficar sem os 5 buckets (`empreendimentos`, `cliente-arquivos`, `crm-documentos`, `contratos`, `imoveis`), reinsira os que faltam.
3. Aplicar as 10 a 19, uma por vez, cada uma numa transação: `for f in supabase/migrations/2026092900001*.sql; do docker exec -i supabase_db_arken-ensaio psql -U postgres -v ON_ERROR_STOP=1 -1 < "$f" || break; done`.
4. Conferir (mesmas consultas do passo 2 abaixo) e, como cada perfil real, que `meu_escopo()` responde e que `relatorio()` responde para o admin:
```sql
do $$
declare u record; r jsonb;
begin
  for u in select id, papel from public.profiles loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
    set local role authenticated;
    begin r := public.meu_escopo(); raise notice 'papel=% interno=% permissoes=%', u.papel, r->>'interno', jsonb_array_length(coalesce(r->'permissoes', '[]'::jsonb));
    exception when others then raise notice 'papel=% ERRO % %', u.papel, sqlstate, sqlerrm; end;
    reset role;
  end loop;
end $$;
```
5. Derrubar: `bash scripts/testar-db.sh ensaio 54840 "" "" parar`, e apagar o dump de trabalho.
*Reverter:* nada (o banco isolado é descartável).

**0.5 Prévia do corte e decisões** (SQL editor do remoto; só leitura). Cole `scripts/migracao/previa.sql`; **a saída tem dado pessoal: não salve nem envie**. Revise com o negócio: conflitos de CPF (seções 2 e 3), CPF inválido (4), parceiros sem CPF e CRECI (5), clientes do portal com e sem negócio (6), donos sem vínculo (7), propostas (8), cadastros juntados com nome ou RG diferentes (10). Estado conferido antes: 1 parceiro legado sem CPF e CRECI, 1 cliente do portal, 3 registros legados, 5 propostas, nenhum conflito. As decisões (se houver) entram **antes** do `db push`:
```sql
insert into public.migracao_decisoes (tipo, chave, valor, decidido_por) values
  ('dono_cpf', '<CPF, 11 dígitos>', '<id do perfil do parceiro que fica com o cliente>', '<quem decidiu>'),
  ('etapa_cliente_portal', '<id do cliente ou CPF>', '<novo_contato|contato_iniciado|documentacao|finalizado|perdido>', '<quem decidiu>');
```
Sem decisão vale a regra padrão (o cadastro mais antigo é o dono provisório; cliente do portal fica na casa, `finalizado` se tiver negócio, senão `novo_contato`). A tabela é esvaziada pelo corte. Decisões sem efeito aparecem na seção 9.
*Reverter:* `delete from public.migracao_decisoes where …` (antes do push).

**0.6 Segredos das Edge Functions** (só os nomes; conferir com `supabase secrets list`, que não mostra valores):

| Segredo | Para quê |
|---|---|
| `AMBIENTE=producao` | todas. Sem ele vale "desenvolvimento": o CORS aceita localhost e o Turnstile é dispensado se faltar o segredo. Depois de definido, o front local (`localhost`) perde o CORS nas funções do remoto |
| `SITE_URL` | CORS (com e sem www) e links de e-mail |
| `TURNSTILE_SECRET` | `pre-cadastro`, `enviar-lead` (em produção, sem ele as duas recusam com 503) e o captcha do Auth (passo 4). Sempre a secret **real**, par da chave de site do build (0.7) |
| `RESEND_API_KEY`, `WEBHOOK_SECRET`, `NOTIFICAR_PARA` (opcional `NOTIFICAR_REMETENTE`) | `notificar`. `WEBHOOK_SECRET` com 16+ caracteres e igual ao `notificar_secret` do Vault (0.8) |
| `CRON_SEGREDO` | `d4sign-reconciliar` (16+ caracteres, igual ao `cron_segredo` do Vault) |
| `D4SIGN_TOKEN`, `D4SIGN_CRYPT_KEY`, `D4SIGN_COFRE_UUID` (opcionais `D4SIGN_URL`, `D4SIGN_HMAC_SECRET`) | contratos; só quando a conta D4Sign existir |
| `RESEND_URL` | **não definir** em produção (é o simulador local) |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já vêm do Supabase; não os defina.
*Reverter:* `supabase secrets unset <NOME>` (cuidado: `AMBIENTE` ausente volta ao modo desenvolvimento).

**0.7 Turnstile de produção.** O `.env` usa a chave de TESTE da Cloudflare (sempre aprova) e a chave de site é gravada no bundle pelo `npm run build`. Crie o widget de produção na Cloudflare com os hostnames restritos a `arkenincorporadora.com.br` e `www.arkenincorporadora.com.br`; ele dá o par chave de site + secret.
- A **secret** vai para `TURNSTILE_SECRET` (0.6) e para `supabase/.env` só na hora do `config push`.
- A **chave de site** vai para `VITE_TURNSTILE_SITE_KEY` num `.env.production.local` (não versionado; o Vite o lê no `vite build` e ele vence o `.env`).
- O par tem de casar: chave de teste no front com secret real no servidor recusa todo token (login, cadastro, recuperação, pré-cadastro e contato falham para todos); chave real no front com secret de teste no servidor deixa o captcha inútil.
- Conferência antes do `config push`: `grep -c "^TURNSTILE_SECRET=1x0" supabase/.env` tem de imprimir `0`.

**0.8 Vault do banco** (painel → Database → Vault): `notificar_url` (`https://xucwjsycawizrlouqkvh.supabase.co/functions/v1/notificar`) e `notificar_secret` (igual a `WEBHOOK_SECRET`); `d4sign_reconciliar_url` (`…/functions/v1/d4sign-reconciliar`) e `cron_segredo` (igual a `CRON_SEGREDO`) só quando a conta D4Sign existir. Ao trocar `WEBHOOK_SECRET`, troque o segredo da função e o do Vault na mesma janela; e-mails que falharem no intervalo voltam à fila e o cron reenvia a cada 10 minutos. Confirme o `pg_cron` (Database → Extensions): a migration 16 o cria; se falhar por isso, habilite no painel e rode o push de novo.

**0.9 Janela.** Avise a equipe (o painel e o portal ficam indisponíveis por alguns minutos); tenha à mão o último `public_html` do site, a senha do banco (`SUPABASE_DB_PASSWORD`) e a lista de passos abaixo.

## Passo 1. `cliente-login` novo, antes do banco (DEP-01), e seguir direto para o passo 2

Guarde antes a versão que está no ar como retorno: `mkdir -p <pasta temporária>/supabase && supabase --workdir <pasta temporária> functions download cliente-login --project-ref xucwjsycawizrlouqkvh --use-api`. **Sem o `--workdir` o comando sobrescreve `supabase/functions/cliente-login` do repositório.** Depois:
```
supabase functions deploy cliente-login --use-api
```
Por que primeiro: a função antiga procura o cliente só por CPF, sem checar `portal_liberado`, inativado nem anonimizado. Depois da 18, `clientes` terá os clientes do CRM migrados (`portal_liberado = false`); até a função nova entrar, quem digitasse o CPF de um deles receberia uma sessão do portal. A nova aceita o banco de antes e de depois, cria a conta do portal com `app_metadata.portal_cliente_id` e nunca adota conta que só tenha o e-mail interno.
**Atenção (FR1-01):** a nova limita as tentativas pela reserva atômica do banco (migration 19). Até o passo 2 terminar, o login do portal responde **503** ("Serviço indisponível"), que é a falha fechada esperada. Siga para o passo 2 sem pausa e só teste o login do portal depois dele.
*Reverter (só antes do passo 2):* redeploy da versão guardada. **Depois do `db push`, nunca volte à função antiga** (abre o portal aos clientes do CRM).

## Passo 2. `supabase db push` (migrations 10 a 19)

```
supabase db push --dry-run     # tem de listar exatamente 20260929000010 … 19
supabase db push
```
Cada migration roda na própria transação: se uma falhar, as anteriores ficam aplicadas e a falha não deixa meia migration; corrija **no próprio arquivo** (as 10–19 ainda podem ser editadas até este momento) e rode de novo o push. Conferir (SQL editor):
```sql
select acao, detalhe from public.auditoria where acao = 'migracao' order by id desc limit 1;   -- totais do corte
select tipo, count(*) from public.migracao_pendencias where resolvido_em is null group by 1;  -- fila para o negócio
select jobname from cron.job order by 1;                                                     -- 5 tarefas arken-*
select id from public.clientes where user_id is not null and not portal_liberado;             -- vazio (DEP-01)
select proname from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('tentativas_reservar', 'tentativas_confirmar') order by 1;                  -- 2 linhas (migration 19)
```
Se a penúltima trouxer linhas, a função antiga rodou na janela: anule o `user_id` dessas fichas e remova as contas do Auth criadas por ela.
Conferir o `cliente-login` agora: o CPF do cliente do portal atual entra; CPF inexistente devolve 404 "CPF não encontrado".
*Reverter:* **não há migration de volta.** Depois que o push termina, o caminho normal é corrigir para a frente com uma migration nova (`20260929000020`+). A volta total é restaurar o backup do passo 0.3 (perde tudo gravado depois dele; só com decisão do dono, e só faz sentido enquanto os dados forem de teste). O corte é rastreável: os clientes migrados têm `origem = 'migracao_parceiro_clientes'` e os mapas `migracao_parceiro_clientes` e `migracao_propostas` dizem de onde veio cada linha, mas desfazê-lo à mão é SQL revisado, não rotina.

## Passo 3. Demais funções (todas com `--use-api`)

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
Antes de redeployar uma função que já existe (`enviar-lead`, `notificar`, `convidar-parceiros`), guarde a versão atual como no passo 1. Vêm **depois** do push porque usam as RPCs das 10–15 (`pre-cadastro` e `enviar-lead`, também a 19). `enviar-lead` novo recusa sem `TURNSTILE_SECRET` em produção e só aceita as origens de `SITE_URL`.
**verify_jwt:** todas as 11 funções têm `verify_jwt = false` no `supabase/config.toml` e se autenticam no próprio código (as chaves novas `sb_publishable_`/`sb_secret_` não são JWT; com a verificação do gateway ligada, o front recebe 401). Depois dos deploys, confira no painel (Edge Functions → função → *Enforce JWT verification* desligado). Se aparecer ligado, refaça o deploy daquela função com `--no-verify-jwt`.
*Reverter:* função que já existia (`enviar-lead`, `notificar`, `convidar-parceiros`): redeploy da versão anterior, guardada como no passo 1 (as antigas não conhecem as RPCs novas, então só vale como recurso emergencial). O `cliente-login` **nunca** volta à versão antiga depois do `db push`. Função nova com problema: `supabase functions delete <nome>` (some só a função; nada no banco depende dela para existir).

## Passo 4. `supabase config push` (depois do push e das funções)

O diff que o comando mostra é a conferência (o `[auth]` remoto não foi lido antes):
- **esperado:** hook `custom_access_token` (a função `public.hook_token_acesso` existe desde a 09), MFA TOTP habilitado e `otp_length` 6 → 10;
- `otp_expiry`: se o remoto estiver em 600 (registro de 22/09 no PRD), o push amplia para 86400 (24 h dos convites por WhatsApp); intencional e seguro com 10 dígitos. Se estiver em 86400, sem mudança;
- **qualquer outra mudança de `[auth]` (site URL, redirects, SMTP, captcha, senha): pare e revise;**
- `TURNSTILE_SECRET` e `RESEND_API_KEY` têm de estar em `supabase/.env` (fora do Git); o `[auth.captcha]` usa `env(TURNSTILE_SECRET)`: confirme a secret **real** (0.7), nunca a de teste. Depois do push, apague a secret de `supabase/.env` se preferir não deixá-la em disco.

Conferir: entrar como o admin no painel, como um parceiro e como o cliente do portal.
*Reverter:* com o hook ligado e a função com erro, **nenhum login funciona**: desligue o hook no painel do Auth (Authentication → Hooks) e investigue. Para desfazer o resto, volte o `config.toml` (por exemplo `otp_length = 6`) e rode `config push` de novo.

## Passo 5. Front na Hostinger

1. Baixe uma cópia do `public_html` atual (retorno; note que depois da 18 o front antigo não funciona mais para parceiro e admin).
2. Build de produção com a chave real do Turnstile em `.env.production.local` e a verificação do pacote:
```
npm run build
npm run conferir:dist
```
O `conferir:dist` falha se o build tiver a chave de TESTE do Turnstile, não tiver chave real (`0x4…`) ou trouxer segredo (`sb_secret_…`, JWT `service_role`). Só envie o `dist/` (inclui `public/.htaccess`) com ele verde.
3. Depois do envio, abra `/`, `/parceiros`, `/portal-do-cliente` e `/admin` com o console do navegador aberto: nenhuma mensagem "Refused to … Content Security Policy". O `.htaccess` define HSTS (15552000 s, sem `includeSubDomains`) e a CSP, que fixa o endereço do projeto Supabase e os serviços externos (Turnstile, Google Fonts, ViaCEP, BrasilAPI). Se algo for bloqueado, o comentário no `.htaccess` diz onde ajustar; para diagnosticar sem bloquear, troque o nome do cabeçalho por `Content-Security-Policy-Report-Only`. Depois de conferir os subdomínios, o HSTS pode subir para 1 ano.
4. Conferência de fumaça: formulário de lead grava; cadastro e login de parceiro; login do portal por CPF; `/admin` abre.
*Reverter:* restaure o `public_html` da cópia (só é útil se o banco ainda não foi migrado). Problema só de CSP: troque para `Report-Only`.

## Passo 6. Definir o Super (N2) pelo SQL

Nenhum admin vira Super sozinho. Depois da 17, `profiles` não aceita `UPDATE` pela API; o SQL editor (papel `postgres`) não é afetado pelo `protege_campos_profile`. O dono precisa já ter conta (não use o admin de demonstração):
```sql
update public.profiles set papel = 'super'
 where id = (select id from auth.users where email = '<e-mail do dono>')
returning id, papel, status_parceiro;
```
Tem de voltar 1 linha. A partir daí, papéis internos só pelo Super, em Configurações › Equipe (`equipe_definir_papel`); o último Super não deixa de ser Super.
*Reverter:* o mesmo `update` com `papel = 'admin'`.

## Passo 7. TOTP e 2FA de internos (H5)

1. O Super entra no painel, abre **Segurança** (`/admin/seguranca`) e cadastra o TOTP no aplicativo autenticador; cada admin faz o mesmo.
2. Só quando todos tiverem fator verificado (a consulta abaixo tem de voltar vazia), o Super liga **Exigir verificação em duas etapas da equipe interna** (grupo Segurança) em Configurações › Geral, confirmando o aviso:
```sql
select u.email from auth.users u join public.profiles p on p.id = u.id
 where p.papel in ('admin', 'super')
   and not exists (select 1 from auth.mfa_factors f where f.user_id = u.id and f.status = 'verified');
```
3. Teste: sair e entrar de novo pede o código; sem `aal2`, `/admin` recusa.
*Reverter (perdeu o aparelho ou ninguém consegue entrar):* pelo SQL editor, `update public.configuracao_geral set exigir_mfa_interno = false;`, entrar e recadastrar o TOTP (o fator antigo se remove no painel do Auth, no usuário).

## Passo 8. Pós-go-live (§8.2, passo 6 do desenho)

Cada item destrava uma parte do que está bloqueado (tabela adiante). Configurações são do Super, em `/admin/configuracoes`:
1. **Vendedora (N7):** razão social, CNPJ e endereço da Arken (Geral); a Imobiliária Arken recebe o CNPJ.
2. **Signatários (D3):** e-mail do representante Arken e, se for o caso, testemunhas (Signatários).
3. **Parâmetros de simulação (N14):** taxa, faixa de parcelas e `valor_minimo_flex`; publique a versão (Simulação).
4. **Modelos de contrato:** o texto revisado pelo jurídico; publique e libere para envio (Modelos).
5. **Termo LGPD revisado (H4):** publique com `revisado_juridico` (Termos). Só então o pré-cadastro público abre.
6. **D4Sign:** conta da Arken, cofre, token, chave de criptografia e HMAC nos segredos (0.6); primeiro no **sandbox**, conferindo o formato real do webhook e do `Content-Hmac`; depois produção; Vault com `d4sign_reconciliar_url` e `cron_segredo` (0.8).
7. **E-mail:** DNS do Resend (`docs/PRD.md` §13.5), `NOTIFICAR_PARA` definido e o domínio verificado.
8. **Migração:** resolver a fila em `/admin/migracao` (cada pendência pede uma decisão de 5+ caracteres).
9. **Portal:** ficha do cliente › Portal para liberar (`portal_liberado`) só quem deve entrar; reconfirmar o login só por CPF antes de ativar contratos (N1).
10. **Turnstile e HSTS:** conferir o console em produção (passo 5) e ajustar HSTS depois de olhar os subdomínios.

## Passo 9. Decisões do dono de 29/09/2026 (migrations 23 e 24, sem financeiro)
Depois das migrations já publicadas (até a `20260929000020` e as 21/22 dos outros pacotes, na ordem numérica):
```
supabase db push --dry-run     # tem de listar só as migrations novas, em ordem (… 23, 24)
supabase db push
supabase functions deploy notificar --use-api     # modelos crm.exclusividade_transferida e portal.solicitacao
```
Antes: rodar `BASE_ATE=20260929999999 PARAR_AO_FINAL=1 bash scripts/testar-db.sh excl 54890 "" todos` (pgTAP `exclusividade` e `portal_solicitacoes`, mais o conjunto todo). Conferir no SQL editor: `select exclusividade_dias from public.configuracao_geral` (180) e `select tipo, ativo from public.notificacoes_config where tipo in ('crm.exclusividade_transferida', 'portal.solicitacao')` (dois ligados). A 23 recalcula o prazo de todos os clientes (última atividade + 180 dias, sem encurtar). Sem o redeploy do `notificar`, os dois avisos novos ficam na fila como "tipo sem modelo" (ignorados), sem erro. Front: `build` + `conferir:dist` como no passo 5.

## O que continua bloqueado por pendência de negócio

O deploy em si não depende dessas respostas; cada uma trava só o que está indicado (numeração da §9.2 do desenho, situação em `docs/PRD.md` §13.1).

| # | Pendência | Continua bloqueado | Como destravar |
|---|---|---|---|
| 1 | Texto de consentimento revisado (H4) | Pré-cadastro público: a Edge responde 503 | Passo 8, item 5 |
| 2 | N7: vendedora | Envio de contrato para assinatura | Passo 8, item 1 |
| 3 | Modelos de contrato da Arken | Envio (sem `liberado_para_envio`) | Passo 8, item 4 |
| 4 | D3: signatários, e-mail do representante | Envio, de propósito | Passo 8, item 2 |
| 5 | N2: nome do Super | Configurações críticas, papéis internos, anonimização | Passo 6 |
| 6 | N14: parâmetros e `valor_minimo_flex` | Plano flexível (o parcelado usa a semente provisória) | Passo 8, item 3 |
| 7 | Conta D4Sign | Assinatura (o contrato chega até "pronto para enviar") | Passo 8, item 6 |
| 8 | N1/N9: reconfirmar o login só por CPF | Liberar documentos e contratos no portal | Passo 8, item 9 (recomendação: CPF + código) |
| 9 | N15: decisões da migração | O `db push` da 18 (passo 0.5) | Passo 0.5 |
| 10 | DNS do Resend e Turnstile real | E-mails de parceiro e notificações; anti-spam de verdade | Passo 0.7 e passo 8, item 7 |
| 11 | Base legal dos clientes migrados (o corte não cria consentimento) | Uso jurídico dos dados antigos; nenhum bloqueio técnico | Decisão do jurídico (N12) |
| 12 | Parceiro legado pendente com carteira | Reativação desses parceiros: entra `bloqueado`; desbloquear exige CPF e CRECI | Completar o cadastro na Rede e desbloquear |

## Conferências que ainda dependem da stack real

Não bloqueiam este roteiro, mas nunca rodaram contra GoTrue, Storage e Deno de verdade (a stack completa local caiu por falta de disco): upload pela Storage API em `crm-documentos` e `imoveis` (com as políticas novas e os tetos), `baixar-arquivo` e `lgpd-anonimizar` com o Storage real, `cliente-login` com a conta marcada, a legada e a hostil, o hook de login com o GoTrue, as rajadas do limite por IP e o pgTAP completo com a 19. O que o remoto ainda pode mostrar: quais cabeçalhos de IP chegam às funções (`cf-connecting-ip` ou `x-forwarded-for`; se só o segundo vier, o primeiro IP é forjável e o limite por IP fica contornável). Depois do deploy, olhe os logs das funções (painel → Edge Functions → Logs) nas primeiras horas.
