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
  local a="" b="" esito=0
  if [ "${SENZA_CARICARE:-}" = 1 ]; then echo "(prova) non carico $2 ($(wc -c < "$1" | tr -d ' ') byte)"; return 0; fi
  # Su Supabase finché le versioni dell'app che leggono da lì sono in giro (DATI_SUPABASE=0 per smettere), e su
  # Cloudflare R2 quando ci sono le chiavi. Una riga sola in uscita: "caricato" se almeno uno dei due è cambiato.
  if [ "${DATI_SUPABASE:-1}" = 1 ]; then a=$(carica_supabase "$@") || esito=1; fi
  if r2_chiavi; then b=$(carica_r2 "$@") || esito=1; fi
  case "$a $b" in
    *caricato*) echo "caricato $2" ;;
    *invariato*) echo "invariato $2" ;;
  esac
  return $esito
}

carica_supabase() {
  local key type md5 remoto
  md5=$(openssl dgst -md5 "$1" | awk '{print $NF}')
  remoto=$(curl -sI "$SUPA_URL/storage/v1/object/public/dati/$2" | tr -d '\r"' | awk 'tolower($1)=="etag:"{print $2}')
  if [ -n "$md5" ] && [ "$md5" = "$remoto" ]; then echo "invariato $2"; return 0; fi
  key=${SUPABASE_SECRET_KEY:-}
  [ -n "$key" ] || key=$(tr -d '[:space:]' < "$SUPA_KEY_FILE")
  type=${3:-application/json}
  # Fino a 4 tentativi (10, 20, 30 secondi di pausa): caricando centinaia di file di fila Supabase ogni tanto risponde
  # 429 "troppe richieste" (10 novembre 2026: 2 file dello storico Yu-Gi-Oh! su 618 non caricati, senza che nessuno riprovasse).
  local n err
  for n in 1 2 3 4; do
    err=$(curl -sS --fail-with-body -X POST "$SUPA_URL/storage/v1/object/dati/$2" \
      -H "apikey: $key" -H "Authorization: Bearer $key" -H "x-upsert: true" -H "Cache-Control: max-age=300" \
      -H "Content-Type: $type" --data-binary @"$1" 2>&1 > /dev/null) && { echo "caricato $2"; return 0; }
    [ "$n" = 4 ] || sleep $((n * 10))
  done
  echo "non caricato $2: $(printf '%s' "$err" | tail -1)" >&2
  return 1
}

# --- Cloudflare R2 (novembre 2026) ---------------------------------------------------------------------------------
# Supabase ha avvisato che il traffico del piano gratuito era superato (ogni telefono riscarica ogni giorno i file
# cambiati nella notte): i file che l'app scarica stanno nel bucket R2 "collectorone-dati", pubblico su
# https://dati.collectorone.app/<percorso> (stessi percorsi del bucket "dati" di Supabase), dove il traffico non si paga.
# Chiavi (un token R2 "Object Read & Write" del solo bucket): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
# segreti del repo pubblico oppure, sul Mac, il file ~/CollectorOne-chiave/r2-keys.txt con tre righe NOME=valore.
# Mai nel codice e mai stampate. Senza chiavi R2 si salta e tutto resta com'era.
R2_BUCKET=${R2_BUCKET:-collectorone-dati}
R2_URL=${R2_URL:-https://dati.collectorone.app}
R2_KEY_FILE="$HOME/CollectorOne-chiave/r2-keys.txt"

# 0 se le chiavi di R2 ci sono (dall'ambiente, o lette una volta dal file sul Mac).
r2_chiavi() {
  local k v
  if [ -z "${R2_ACCESS_KEY_ID:-}" ] && [ -f "$R2_KEY_FILE" ]; then
    while IFS='=' read -r k v; do
      case "$k" in R2_ACCOUNT_ID|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY) export "$k=$(printf '%s' "$v" | tr -d '[:space:]"')" ;; esac
    done < "$R2_KEY_FILE"
  fi
  [ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]
}

# curl verso l'indirizzo S3 di R2, con la firma (le chiavi passano da un file di configurazione sullo standard input,
# non dalla riga di comando, dove le vedrebbe chiunque guardi i processi).
r2_curl() {
  printf 'user = "%s:%s"\n' "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY" | curl -K - --aws-sigv4 "aws:amz:auto:s3" "$@"
}

# carica_r2 <file locale> <percorso nel bucket> [tipo]: come carica_supabase (l'etag di R2 è l'md5 del contenuto).
carica_r2() {
  local type md5 remoto url n err
  r2_chiavi || return 2
  url="https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com/$R2_BUCKET/$2"
  md5=$(openssl dgst -md5 "$1" | awk '{print $NF}')
  remoto=$(r2_curl -sI "$url" | tr -d '\r"' | awk 'tolower($1)=="etag:"{print $2}')
  if [ -n "$md5" ] && [ "$md5" = "$remoto" ]; then echo "invariato $2"; return 0; fi
  type=${3:-application/json}
  for n in 1 2 3 4; do
    err=$(r2_curl -sS --fail-with-body -X PUT "$url" -H "Cache-Control: max-age=300" \
      -H "Content-Type: $type" --data-binary @"$1" 2>&1 > /dev/null) && { echo "caricato $2"; return 0; }
    [ "$n" = 4 ] || sleep $((n * 10))
  done
  echo "non caricato su R2 $2: $(printf '%s' "$err" | tail -1 | cut -c1-200)" >&2
  return 1
}

# Da dove si leggono i file già pubblicati (job e storico.js): Supabase finché R2 non ha tutto, poi DATI_URL=$R2_URL.
DATI_URL=${DATI_URL:-$SUPA_URL/storage/v1/object/public/dati}
export DATI_URL

# scarica <percorso nel bucket> <file locale>: l'ultima versione pubblicata (per completare la riserva).
scarica() {
  curl -sS --fail -o "$2" "$DATI_URL/$1"
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
