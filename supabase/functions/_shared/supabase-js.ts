// Único ponto de importação do SDK do Supabase nas Edge Functions (Deno; NÃO é importado pelo Vitest).
// A versão é EXATA (FR1-04): com `npm:@supabase/supabase-js@2` cada deploy resolvia a última 2.x do momento, e uma
// versão comprometida ou com regressão entraria em produção sem revisão, já recebendo a chave secreta (service role).
// O supabase-js fixa, por sua vez, as versões exatas dos pacotes que traz (auth-js, postgrest-js, storage-js…).
// Para atualizar: subir o número aqui e no package.json do front (mesma versão, package-lock), rodar `npm test` e os
// fluxos reais contra a stack Supabase local completa (e2e-real/) e só então publicar as funções.
// As demais dependências npm das funções também são fixas (pdf-lib@1.17.1 em contrato-gerar/pdf-lib.ts).
export { createClient } from "npm:@supabase/supabase-js@2.116.0";
export type { SupabaseClient, User } from "npm:@supabase/supabase-js@2.116.0";
