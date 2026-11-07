#!/bin/bash
# Funzioni comuni del job e del rilascio: caricamento dei file nello spazio file pubblico "dati" di Supabase
# e aggiornamento dei branch di riserva su GitHub.
# La chiave segreta di Supabase (sb_secret_...) arriva dalla variabile SUPABASE_SECRET_KEY (GitHub Actions,
# secret del repo pubblico) oppure dal file sul Mac ~/CollectorOne-chiave/supabase-secret-key.txt: mai nel codice.
# Chi scarica legge da https://lafgthxgasunkxrgwqng.supabase.co/storage/v1/object/public/dati/<percorso>
# Con SENZA_CARICARE=1 (prove) non si carica nulla: si stampa solo cosa si sarebbe caricato.
SUPA_URL=https://lafgthxgasunkxrgwqng.supabase.co
SUPA_KEY_FILE="$HOME/CollectorOne-chiave/supabase-secret-key.txt"
REPO_DATI=cirolomonaco90-cyber/cirolomonaco90-cyber.github.io

# carica <file locale> <percorso nel bucket> [tipo]
# Se il file sul server è già identico (l'etag di Supabase è l'md5 del contenuto) non si ricarica:
# così l'app non riscarica file uguali. Stampa "caricato" o "invariato".
carica() {
  local key type md5 remoto
  if [ "${SENZA_CARICARE:-}" = 1 ]; then echo "(prova) non carico $2 ($(wc -c < "$1" | tr -d ' ') byte)"; return 0; fi
  md5=$(openssl dgst -md5 "$1" | awk '{print $NF}')
  remoto=$(curl -sI "$SUPA_URL/storage/v1/object/public/dati/$2" | tr -d '\r"' | awk 'tolower($1)=="etag:"{print $2}')
  if [ -n "$md5" ] && [ "$md5" = "$remoto" ]; then echo "invariato $2"; return 0; fi
  key=${SUPABASE_SECRET_KEY:-}
  [ -n "$key" ] || key=$(tr -d '[:space:]' < "$SUPA_KEY_FILE")
  type=${3:-application/json}
  curl -sS --fail-with-body -X POST "$SUPA_URL/storage/v1/object/dati/$2" \
    -H "apikey: $key" -H "Authorization: Bearer $key" -H "x-upsert: true" -H "Cache-Control: max-age=300" \
    -H "Content-Type: $type" --data-binary @"$1" > /dev/null && echo "caricato $2"
}

# scarica <percorso nel bucket> <file locale>: l'ultima versione pubblicata (per completare la riserva).
scarica() {
  curl -sS --fail -o "$2" "$SUPA_URL/storage/v1/object/public/dati/$1"
}

# riserva <cartella> <branch>: copia della cartella sul branch di riserva del repo pubblico (un solo commit,
# sovrascritto ogni volta: il branch non cresce). L'app la usa se Supabase non risponde. Token da GITHUB_TOKEN
# (Actions) o da gh (Mac); senza token si salta.
riserva() {
  local tok
  tok=${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}
  if [ -z "$tok" ]; then echo "riserva GitHub ($2): nessun token, salto"; return 0; fi
  if [ "${SENZA_CARICARE:-}" = 1 ]; then echo "(prova) non aggiorno il branch di riserva $2"; return 0; fi
  (
    cd "$1" && rm -rf .git &&
      echo "Riserva del job notturno, aggiornata: $(date -u '+%Y-%m-%d %H:%M UTC'). I dati veri stanno su Supabase." > README.md &&
      git init -q -b "$2" && git add -A &&
      git -c user.name="job notturno" -c user.email="noreply@collectorone" commit -q -m "$2 del $(date -u +%F)" &&
      git push -q -f "https://x-access-token:${tok}@github.com/$REPO_DATI.git" "$2" 2>/dev/null
  ) && echo "riserva GitHub aggiornata: branch $2" || echo "riserva GitHub non aggiornata ($2)"
}
