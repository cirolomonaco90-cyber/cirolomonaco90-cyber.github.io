#!/bin/bash
# Backup del database di Supabase (account, collezioni salvate, classifica, Pro regalati: tutto lo schema "public" più
# gli utenti e i loro accessi di "auth"), ogni notte, in uno spazio PRIVATO di Cloudflare R2 (bucket collectorone-backup,
# non raggiungibile da fuori). Il piano gratuito di Supabase non fa backup (13 novembre 2026, richiesto dall'utente).
#   db/<giorno>/public.dump   schema e dati di public (formato di pg_restore)
#   db/<giorno>/auth.dump     dati di auth.users e auth.identities (per ridare a ognuno lo stesso id)
#   db/<giorno>/info.json     dimensioni e righe contate
# Restano gli ultimi GIORNI_BACKUP (30) giorni. Gira su GitHub (workflow "Backup del database") con pg_dump 17 in docker.
# Chiavi, mai nel codice e mai stampate: SUPABASE_DB_URL (stringa di collegamento col "session pooler"),
# R2_ACCOUNT_ID, R2_BACKUP_ACCESS_KEY_ID, R2_BACKUP_SECRET_ACCESS_KEY (token R2 del solo bucket dei backup): segreti del
# repo pubblico oppure, sul Mac, ~/CollectorOne-chiave/backup-keys.txt (li scrive scripts/chiavi-backup.sh).
# I registri di GitHub sono pubblici: qui non si stampa nulla dei dati, solo l'esito e le dimensioni.
# Per riprendere un backup: bash scripts/scarica-backup.sh [giorno], poi pg_restore (vedi CLAUDE.md).
set -uo pipefail
BUCKET=collectorone-backup
GIORNI=${GIORNI_BACKUP:-30}
PG_IMAGE=postgres:17
FILE_CHIAVI="$HOME/CollectorOne-chiave/backup-keys.txt"
if [ -z "${SUPABASE_DB_URL:-}" ] && [ -f "$FILE_CHIAVI" ]; then
  while IFS='=' read -r k v; do
    case "$k" in SUPABASE_DB_URL|R2_ACCOUNT_ID|R2_BACKUP_ACCESS_KEY_ID|R2_BACKUP_SECRET_ACCESS_KEY) export "$k=$(printf '%s' "$v" | tr -d '[:space:]"')" ;; esac
  done < "$FILE_CHIAVI"
fi
for v in SUPABASE_DB_URL R2_ACCOUNT_ID R2_BACKUP_ACCESS_KEY_ID R2_BACKUP_SECRET_ACCESS_KEY; do
  [ -n "${!v:-}" ] || { echo "Backup: manca $v"; exit 1; }
done
export SUPABASE_DB_URL
command -v docker > /dev/null || { echo "Backup: serve docker (pg_dump 17)"; exit 1; }
T=$(mktemp -d)
chmod 700 "$T"
trap 'rm -rf "$T"' EXIT
GIORNO=$(date -u +%F)
S3="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com/$BUCKET"
b_curl() { printf 'user = "%s:%s"\n' "$R2_BACKUP_ACCESS_KEY_ID" "$R2_BACKUP_SECRET_ACCESS_KEY" | curl -K - --aws-sigv4 "aws:amz:auto:s3" "$@"; }
# Gli strumenti di Postgres 17 dentro docker; la stringa di collegamento passa come variabile, non sulla riga di comando.
pg() { docker run --rm -i -e SUPABASE_DB_URL -v "$T:/b" "$PG_IMAGE" "$@"; }
errore() { echo "Backup del $GIORNO NON riuscito: $1"; exit 1; }

pg sh -c 'pg_dump "$SUPABASE_DB_URL" -Fc --no-owner --no-privileges --schema=public -f /b/public.dump' 2> "$T/err.txt" \
  || errore "pg_dump di public ($(tail -1 "$T/err.txt" | cut -c1-160))"
pg sh -c 'pg_dump "$SUPABASE_DB_URL" -Fc --no-owner --no-privileges --data-only --table=auth.users --table=auth.identities -f /b/auth.dump' 2> "$T/err.txt" \
  || errore "pg_dump di auth ($(tail -1 "$T/err.txt" | cut -c1-160))"

# Rilettura completa dei due file (un backup che non si legge non è un backup) e conto delle righe, da confrontare
# con quelle del database in questo momento: le collezioni e gli utenti devono esserci tutti (qualche riga di scarto è
# normale: chi usa l'app mentre gira il backup).
righe() { pg sh -c "pg_restore -a -t $2 -f - /b/$1" 2> /dev/null | awk '/^COPY /{c=1;next} /^\\\.$/{c=0} c{n++} END{print n+0}'; }
vive() { pg sh -c "psql \"\$SUPABASE_DB_URL\" -Atc 'select count(*) from $1'" 2> /dev/null | tr -d '[:space:]'; }
pg sh -c 'pg_restore -f /dev/null /b/public.dump && pg_restore -f /dev/null /b/auth.dump' 2> "$T/err.txt" || errore "i file non si rileggono"
C_BACKUP=$(righe public.dump owned_cards); C_VIVE=$(vive public.owned_cards)
U_BACKUP=$(righe auth.dump users); U_VIVE=$(vive auth.users)
TABELLE=$(pg sh -c 'pg_restore -l /b/public.dump' 2> /dev/null | grep -c "TABLE DATA public")
python3 - "$C_BACKUP" "$C_VIVE" "$U_BACKUP" "$U_VIVE" "$TABELLE" <<'PY' || errore "le righe del backup non tornano con quelle del database"
import sys
cb, cv, ub, uv, t = (int(x or 0) for x in sys.argv[1:6])
ok = t >= 10 and ub > 0 and cb > 0 and abs(cb - cv) <= max(50, cv // 50) and abs(ub - uv) <= max(5, uv // 50)
sys.exit(0 if ok else 1)
PY
P=$(wc -c < "$T/public.dump" | tr -d ' '); A=$(wc -c < "$T/auth.dump" | tr -d ' ')
printf '{"giorno":"%s","fatto":"%s","public_byte":%s,"auth_byte":%s,"tabelle":%s,"owned_cards":%s,"utenti":%s,"postgres":"17"}\n' \
  "$GIORNO" "$(date -u +%FT%TZ)" "$P" "$A" "$TABELLE" "$C_BACKUP" "$U_BACKUP" > "$T/info.json"

for f in public.dump auth.dump info.json; do
  ok=0
  for n in 1 2 3; do
    b_curl -sS --fail -o /dev/null -X PUT "$S3/db/$GIORNO/$f" -H "Content-Type: application/octet-stream" --data-binary @"$T/$f" 2> "$T/err.txt" && { ok=1; break; }
    sleep $((n * 10))
  done
  [ "$ok" = 1 ] || errore "caricamento di $f ($(tail -1 "$T/err.txt" | cut -c1-160))"
done
# Controllo: il file caricato ha la stessa impronta di quello fatto qui.
MD5=$(openssl dgst -md5 "$T/public.dump" | awk '{print $NF}')
SU=$(b_curl -sI "$S3/db/$GIORNO/public.dump" | tr -d '\r"' | awk 'tolower($1)=="etag:"{print $2}')
[ "$MD5" = "$SU" ] || errore "il file caricato non è uguale a quello fatto"

# Via i backup più vecchi di GIORNI giorni (si provano i 15 giorni prima: anche se il job salta qualche notte).
for i in $(seq "$GIORNI" $((GIORNI + 15))); do
  V=$(python3 -c "import datetime, sys; print((datetime.datetime.now(datetime.timezone.utc).date() - datetime.timedelta(days=int(sys.argv[1]))).isoformat())" "$i")
  for f in public.dump auth.dump info.json; do b_curl -s -o /dev/null -X DELETE "$S3/db/$V/$f"; done
done
echo "Backup del $GIORNO fatto e riletto: public $((P / 1024)) KB, auth $((A / 1024)) KB, $TABELLE tabelle."
