#!/usr/bin/env bash
# Banco Postgres local ISOLADO para rodar as migrations e o pgTAP sem tocar no banco do repositório nem no remoto
# (vários agentes ou pessoas em paralelo, cada um com nome e porta próprios).
#
# uso: bash scripts/testar-db.sh <nome> <porta> "<prefixos extras>" "<testes>" [testar|so-aplicar|parar]
#   nome     = sufixo do projeto (container supabase_db_arken-<nome>); um por execução
#   porta    = porta do Postgres; a porta+1 é a do banco sombra. Escolha portas livres e diferentes entre execuções
#   extras   = prefixos de versão de migrations acima da base, ex.: "20260929000010 20260929000011" (ou "" para nenhum)
#   testes   = nomes sem .test.sql, ex.: "rls relatorio nucleo invariantes escopo rede", ou "todos"
#   modo     = testar (padrão: sobe, aplica e roda `supabase test db`), so-aplicar (sobe e aplica, sem testes) ou
#              parar (derruba e apaga os dados: `supabase stop --no-backup`)
#
# Variáveis:
#   BASE_ATE       aplica todas as migrations com versão <= este valor (padrão 20260929000009, a base já no remoto).
#                  Para TODAS as migrations do repositório: BASE_ATE=20260929999999 bash scripts/testar-db.sh x 54852 "" todos
#   ARKEN_DB_TMP   pasta de trabalho (padrão /tmp/arken-db). Fica fora do repositório; no Windows /tmp é o Temp do C:
#   ESPACO_MIN_MB  recusa subir com menos espaço livre que isto na pasta de trabalho (padrão 3000). O disco cheio derruba o Docker
#   PARAR_AO_FINAL=1  derruba o banco ao terminar, inclusive quando algo falha (use em execução sem supervisão)
#
# Exemplos:
#   BASE_ATE=20260929999999 bash scripts/testar-db.sh completo 54852 "" todos            # tudo, como o remoto ficará
#   PARAR_AO_FINAL=1 bash scripts/testar-db.sh rede 54830 "20260929000010" "rls rede"     # base 01–09 + a 10, dois testes
#   bash scripts/testar-db.sh completo 54852 "" todos parar                              # derruba
#   psql: docker exec -i supabase_db_arken-<nome> psql -U postgres -v ON_ERROR_STOP=1 < arquivo.sql
#
# Regras: NUNCA rode `supabase start`, `db start` ou `db reset` na pasta do repositório (ficaria com o estado de quem
# rodou por último); use este script. No máximo um banco isolado por vez, e sempre derrube ao terminar. A imagem do
# Postgres é a do remoto (supabase/.temp/postgres-version): a padrão da CLI derruba o servidor quando `anon` chama uma
# função sem permissão. Nada aqui fala com o projeto remoto (sem link, sem push).
set -euo pipefail

if [ "$#" -lt 2 ]; then sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2; fi

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
NOME=$1; PORTA=$2; EXTRAS=${3:-}; TESTES=${4:-todos}; MODO=${5:-testar}
BASE_ATE=${BASE_ATE:-20260929000009}
TMP=${ARKEN_DB_TMP:-/tmp/arken-db}
ESPACO_MIN_MB=${ESPACO_MIN_MB:-3000}
RAIZ=$TMP/db-$NOME
W=$RAIZ/supabase
export SUPABASE_DB_PORT=$PORTA SUPABASE_DB_SHADOW_PORT=$((PORTA + 1))

filtro() { grep -v 'new version of Supabase CLI\|recommend updating' || true; }

if [ "$MODO" = parar ]; then supabase --workdir "$RAIZ" stop --no-backup 2>&1 | filtro; exit 0; fi
if [ ! -f "$REPO/supabase/.temp/postgres-version" ]; then
  echo "ERRO: falta supabase/.temp/postgres-version (versão do Postgres do remoto; vem do link do projeto)." >&2; exit 1
fi

mkdir -p "$TMP"
livre_mb=$(df -Pk "$TMP" | awk 'NR==2 { print int($4 / 1024) }')
if [ "${livre_mb:-0}" -lt "$ESPACO_MIN_MB" ]; then
  echo "ERRO: só há ${livre_mb} MB livres em $TMP (mínimo ${ESPACO_MIN_MB}). Libere espaço antes: com o disco cheio o Docker cai." >&2; exit 1
fi
if [ "${PARAR_AO_FINAL:-0}" = 1 ]; then trap 'supabase --workdir "$RAIZ" stop --no-backup >/dev/null 2>&1 || true' EXIT; fi

mkdir -p "$W/.temp" "$W/migrations" "$W/tests"
rm -f "$W"/migrations/*.sql; rm -rf "$W"/tests/*
sed "s/^project_id = .*/project_id = \"arken-$NOME\"/" "$REPO/supabase/config.toml" > "$W/config.toml"
cp "$REPO/supabase/.temp/postgres-version" "$W/.temp/"
rm -rf "$W/templates" "$W/seed" "$W/functions"
cp -r "$REPO/supabase/templates" "$REPO/supabase/seed" "$REPO/supabase/functions" "$W/"
touch "$W/.env"

for f in "$REPO"/supabase/migrations/*.sql; do
  v=$(basename "$f" | cut -d_ -f1)
  if [[ ! "$v" > "$BASE_ATE" ]]; then cp "$f" "$W/migrations/"; fi
done
for p in $EXTRAS; do cp "$REPO"/supabase/migrations/${p}_*.sql "$W/migrations/"; done
if [ -d "$REPO/supabase/tests/_fixtures" ]; then cp -r "$REPO/supabase/tests/_fixtures" "$W/tests/"; fi
if [ "$TESTES" = todos ]; then cp "$REPO"/supabase/tests/*.test.sql "$W/tests/"
else for t in $TESTES; do cp "$REPO/supabase/tests/$t.test.sql" "$W/tests/"; done; fi

echo "== migrations aplicadas:"; ls "$W/migrations"
echo "== testes:"; ls "$W/tests"
if docker ps --format '{{.Names}}' | grep -qx "supabase_db_arken-$NOME"; then
  supabase --workdir "$RAIZ" db reset --local 2>&1 | filtro
else
  supabase --workdir "$RAIZ" db start 2>&1 | filtro
fi
if [ "$MODO" = so-aplicar ]; then exit 0; fi
supabase --workdir "$RAIZ" test db 2>&1 | filtro
