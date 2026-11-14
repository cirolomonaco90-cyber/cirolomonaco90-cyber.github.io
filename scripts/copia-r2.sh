#!/bin/bash
# Copia su Cloudflare R2 i file già pubblicati nello spazio "dati" di Supabase (vedi dati-supabase.sh), cartella per
# cartella, con gli stessi percorsi. Si può rilanciare quanto si vuole: un file che su R2 è già identico (stesso etag =
# md5 del contenuto) non si scarica nemmeno. Non tocca e non cancella nulla su Supabase.
#   bash scripts/copia-r2.sh prezzi/v1 carte/v1 giochi/v1 storico/v1 stato
# Su GitHub: workflow "Dati notturni", parte "r2", campo "prefissi". Chiavi: quelle di R2 e SUPABASE_SECRET_KEY (per
# l'elenco dei file), dai segreti del repo o dai file di ~/CollectorOne-chiave. COPIA_PARALLELI (8) file alla volta.
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/dati-supabase.sh
[ $# -gt 0 ] || { echo "uso: bash scripts/copia-r2.sh <cartella> [<cartella>...]"; exit 1; }
r2_chiavi || { echo "Mancano le chiavi di R2 (segreti R2_… o ~/CollectorOne-chiave/r2-keys.txt)"; exit 1; }
SUPA_LIST_KEY=${SUPABASE_SECRET_KEY:-}
[ -n "$SUPA_LIST_KEY" ] || SUPA_LIST_KEY=$(tr -d '[:space:]' < "$SUPA_KEY_FILE")
export SUPA_LIST_KEY SUPA_URL R2_BUCKET
LISTA=$(mktemp)
ESITI=$(mktemp -d)
trap 'rm -rf "$LISTA" "$ESITI"' EXIT

# Elenco dei file delle cartelle chieste: "percorso <tab> tipo <tab> md5", una riga per file.
python3 - "$@" > "$LISTA" <<'PY'
import json, os, re, sys, urllib.request
url = os.environ["SUPA_URL"] + "/storage/v1/object/list/dati"
key = os.environ["SUPA_LIST_KEY"]
strani = 0
def elenco(prefisso):
    global strani
    offset = 0
    while True:
        body = json.dumps({"prefix": prefisso, "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}}).encode()
        req = urllib.request.Request(url, data=body, headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"})
        righe = json.load(urllib.request.urlopen(req, timeout=60))
        for r in righe:
            nome = (prefisso + "/" if prefisso else "") + r["name"]
            if r.get("id") is None:  # cartella
                elenco(nome)
                continue
            meta = r.get("metadata") or {}
            if not re.fullmatch(r"[A-Za-z0-9._/@+-]+", nome):
                strani += 1
                print("nome con caratteri particolari, saltato: " + nome, file=sys.stderr)
                continue
            print(nome, meta.get("mimetype") or "application/octet-stream", (meta.get("eTag") or "").strip('"'), sep="\t")
        if len(righe) < 1000:
            return
        offset += 1000
for p in sys.argv[1:]:
    elenco(p.strip("/"))
if strani:
    print(f"{strani} file saltati per il nome", file=sys.stderr)
PY
[ -s "$LISTA" ] || { echo "Nessun file trovato in: $*"; exit 1; }
echo "$(wc -l < "$LISTA" | tr -d ' ') file da controllare in: $*"

# Un file: se su R2 c'è già con lo stesso md5 niente, altrimenti si scarica da Supabase (compresso in viaggio) e si carica.
copia_riga() {
  local path type md5 remoto tmp
  IFS=$'\t' read -r path type md5 <<< "$1"
  remoto=$(r2_curl -sI "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com/$R2_BUCKET/$path" | tr -d '\r"' | awk 'tolower($1)=="etag:"{print $2}')
  if [ -n "$md5" ] && [ "$md5" = "$remoto" ]; then mktemp "$ESITI/u-XXXXXXXX" > /dev/null; return 0; fi
  tmp=$(mktemp)
  if curl -sS --fail --compressed --retry 3 -o "$tmp" "$SUPA_URL/storage/v1/object/public/dati/$path" && carica_r2 "$tmp" "$path" "$type" > /dev/null; then
    mktemp "$ESITI/c-XXXXXXXX" > /dev/null
  else
    echo "non copiato: $path" >&2; mktemp "$ESITI/e-XXXXXXXX" > /dev/null
  fi
  rm -f "$tmp"
}
export -f copia_riga carica_r2 r2_curl r2_chiavi
export ESITI R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_KEY_FILE
tr '\n' '\0' < "$LISTA" | xargs -0 -n 1 -P "${COPIA_PARALLELI:-8}" bash -c 'copia_riga "$1"' _
C=$(find "$ESITI" -name 'c-*' | wc -l | tr -d ' '); U=$(find "$ESITI" -name 'u-*' | wc -l | tr -d ' '); E=$(find "$ESITI" -name 'e-*' | wc -l | tr -d ' ')
echo "copiati $C, già uguali $U, non riusciti $E"
[ "$E" = 0 ]
