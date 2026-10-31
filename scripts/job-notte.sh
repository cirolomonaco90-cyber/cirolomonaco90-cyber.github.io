#!/bin/bash
# Job notturno di CollectorOne: prezzi per lingua, cataloghi, date dei set, correzioni Cardmarket,
# immagini di riserva il lunedì. Carica i file nello spazio "dati" di Supabase, da cui l'app li scarica,
# e aggiorna i branch di riserva "prezzi" e "immagini" del repo pubblico (usati dall'app se Supabase non risponde).
#
# Gira su GitHub Actions (repo pubblico, workflow prezzi.yml, ogni notte: non dipende dal Mac) e,
# volendo, anche sul Mac (launchd, scripts/installa-job-notte.sh). I segreti arrivano dalle variabili
# CARDTRADER_TOKEN, SUPABASE_SECRET_KEY, EBAY_APP_ID/EBAY_CERT_ID (secret del repo) o, sul Mac, dai file
# in ~/CollectorOne-chiave (cardtrader-token.txt, supabase-secret-key.txt, ebay-keys.txt "APPID:CERTID").
#
#   bash scripts/job-notte.sh [prezzi|cardmarket|immagini|tutto]
#
# Le parti sono indipendenti (su GitHub girano in parallelo); senza argomento si fanno tutte in fila.
# Ripresa: le risposte CardTrader del giorno restano in ~/.collectorone/ct-cache/<data>: un job interrotto
# e ripartito lo stesso giorno continua da dove era arrivato. Le richieste riprovano da sole se manca la rete.
# Esito: alla fine (anche in caso di errore) si carica stato/<parte>.json con data, esito e le ultime righe
# del registro: https://lafgthxgasunkxrgwqng.supabase.co/storage/v1/object/public/dati/stato/prezzi.json
set -uo pipefail
cd "$(dirname "$0")/.."
source scripts/dati-supabase.sh
export PATH=/opt/homebrew/bin:$PATH
CHIAVI="$HOME/CollectorOne-chiave"
[ -n "${CARDTRADER_TOKEN:-}" ] || export CARDTRADER_TOKEN=$(tr -d '[:space:]' < "$CHIAVI/cardtrader-token.txt")
if [ -z "${EBAY_APP_ID:-}" ] && [ -f "$CHIAVI/ebay-keys.txt" ]; then
  K=$(tr -d '[:space:]' < "$CHIAVI/ebay-keys.txt"); export EBAY_APP_ID="${K%%:*}" EBAY_CERT_ID="${K#*:}"
fi
PARTE=${1:-tutto}
DATI="$HOME/.collectorone"
mkdir -p "$DATI/ct-cache"
# Cache CardTrader del giorno; quelle dei giorni prima si buttano.
export CT_CACHE="$DATI/ct-cache/$(date +%F)"
for d in "$DATI"/ct-cache/*/; do [ -d "$d" ] && [ "$d" != "$CT_CACHE/" ] && rm -rf "${d:?}"; done; true
OUT=$(mktemp -d)
INIZIO=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
REGISTRO="$OUT/registro.txt"
exec > >(tee -a "$REGISTRO") 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M') $PARTE"

# Alla fine, comunque vada: file di stato su Supabase (esito, orari, ultime righe), poi pulizia.
fine() {
  local esito=$1
  [ "$esito" = 0 ] && esito=ok || esito="errore $esito"
  python3 - "$PARTE" "$INIZIO" "$esito" "$REGISTRO" "$OUT/stato.json" <<'PY'
import json, sys, datetime, os
parte, inizio, esito, registro, out = sys.argv[1:]
righe = [l.rstrip("\n") for l in open(registro, encoding="utf-8", errors="replace")]
righe = [l for l in righe if l.strip() and not l.startswith("    at ")][-40:]
json.dump({
    "parte": parte, "esito": esito, "inizio": inizio,
    "fine": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "dove": "github" if os.environ.get("GITHUB_ACTIONS") else "mac",
    "righe": righe,
}, open(out, "w"), ensure_ascii=False, indent=1)
PY
  carica "$OUT/stato.json" "stato/$PARTE.json" >/dev/null 2>&1 || true
  rm -rf "$OUT"
}
trap 'fine $?' EXIT
(cd prezzi && npm test --silent >/dev/null) || { echo "test del job falliti: niente pubblicazione"; exit 1; }

if [ "$PARTE" = prezzi ] || [ "$PARTE" = tutto ]; then
  # Catalogo TCGplayer completo (ultima fonte per le righe di Collectr che mancano altrove, e foto dei sigillati
  # che CardTrader non fotografa): ogni notte, prima dei prezzi.
  node prezzi/src/tcgplayer-all.js "$OUT/tcgplayer.json" > "$OUT/tcgplayer.log" &&
    carica "$OUT/tcgplayer.json" prezzi/v1/tcgplayer.json && echo "catalogo TCGplayer: $(tail -1 "$OUT/tcgplayer.log")" &&
    export TCGPLAYER_JSON="$OUT/tcgplayer.json" ||
    echo "catalogo TCGplayer non aggiornato"
  node prezzi/src/build.js "$OUT/prezzi" || exit 1
  # Oggetti da collezione (medaglie Poste Italiane/Zecca...), elenco a mano in prezzi/dati/oggetti.json.
  node prezzi/src/oggetti.js prezzi/dati/oggetti.json "$OUT/prezzi/v1/sealed.json" || echo "oggetti non aggiunti"
  for f in "$OUT"/prezzi/v1/*.json; do carica "$f" "prezzi/v1/$(basename "$f")"; done
  carica "$OUT/prezzi/log.txt" prezzi/log.txt text/plain

  # Date di uscita dei set (ordine dei set in collezione): solo le schede TCGdex nuove, il resto ogni notte.
  node prezzi/src/set-dates.js "$DATI/date-set.json" "$OUT/prezzi/v1/sealed.json" "$OUT/date-set.json" > "$OUT/date-set.log" &&
    carica "$OUT/date-set.json" carte/v1/date-set.json && echo "date dei set: $(tail -1 "$OUT/date-set.log")" ||
    echo "date dei set non aggiornate"

  # Prezzi TCGplayer delle carte giapponesi (terza fonte, da tcgcsv.com): ogni notte.
  node prezzi/src/tcgplayer-ja.js "$OUT/tcgplayer-ja.json" > "$OUT/tcgplayer-ja.log" &&
    carica "$OUT/tcgplayer-ja.json" prezzi/v1/tcgplayer-ja.json && echo "prezzi TCGplayer giapponesi: $(tail -1 "$OUT/tcgplayer-ja.log")" ||
    echo "prezzi TCGplayer giapponesi non aggiornati"

  # Riserva su GitHub (branch "prezzi"): tutti i file di prezzi/v1, compresi quelli delle altre parti.
  cp "$OUT/tcgplayer.json" "$OUT/tcgplayer-ja.json" "$OUT/prezzi/v1/" 2>/dev/null
  scarica prezzi/v1/cardmarket.json "$OUT/prezzi/v1/cardmarket.json" || echo "riserva: cardmarket.json non scaricato"
  riserva "$OUT/prezzi" prezzi
fi

if [ "$PARTE" = cardmarket ] || [ "$PARTE" = tutto ]; then
  # Prodotti Cardmarket sbagliati di TCGdex, con i prezzi giusti dal listino Cardmarket (prezzi/src/cardmarket.js).
  # Le carte TCGdex restano in cache: il lunedì si riscaricano tutte.
  CARTE="$DATI/tcgdex-carte.json"
  [ "$(date +%u)" = 1 ] && rm -f "$CARTE"
  node prezzi/src/tcgdex-scan.js "$CARTE" > "$OUT/cardmarket.log" &&
    node prezzi/src/cardmarket.js "$CARTE" "$OUT/cardmarket.json" >> "$OUT/cardmarket.log" &&
    carica "$OUT/cardmarket.json" prezzi/v1/cardmarket.json && carica "$OUT/cardmarket.log" prezzi/cardmarket-log.txt text/plain &&
    echo "correzioni Cardmarket: $(tail -1 "$OUT/cardmarket.log")" || echo "correzioni Cardmarket non aggiornate"
fi

# Immagini di riserva e carte dei set asiatici: una volta a settimana (lunedì), con FORZA_IMMAGINI=1 o a richiesta.
if [ "$PARTE" = immagini ] || { [ "$PARTE" = tutto ] && { [ "$(date +%u)" = 1 ] || [ "${FORZA_IMMAGINI:-}" = 1 ]; }; }; then
  echo "=== immagini"
  git clone -q --depth 1 --filter=blob:none --sparse https://github.com/tcgdex/cards-database.git "$OUT/tcgdex" &&
    git -C "$OUT/tcgdex" sparse-checkout set data &&
    git clone -q --depth 1 https://github.com/PokemonTCG/pokemon-tcg-data.git "$OUT/ptcg" &&
    node prezzi/immagini/cardtrader.js "$OUT/ct.json" > "$OUT/img.log" &&
    mkdir -p "$OUT/img/v1" &&
    python3 prezzi/immagini/genera.py "$OUT/tcgdex/data" "$OUT/ptcg" "$OUT/img/v1/images.json" "$OUT/ct.json" >> "$OUT/img.log" &&
    python3 prezzi/immagini/verifica.py "$OUT/img/v1/images.json" >> "$OUT/img.log" &&
    carica "$OUT/img/v1/images.json" immagini/v1/images.json && carica "$OUT/img.log" immagini/log.txt text/plain &&
    echo "immagini di riserva: $(tail -1 "$OUT/img.log")" && riserva "$OUT/img" immagini ||
    echo "immagini non aggiornate (vedi sopra)"
  # Carte dei set asiatici che TCGdex ha solo di nome (prezzi/src/asia.js).
  node prezzi/src/asia.js "$OUT/asia.json" && carica "$OUT/asia.json" carte/v1/asia.json &&
    echo "carte dei set asiatici aggiornate" || echo "carte dei set asiatici non aggiornate"
fi
echo "=== fatto $(date '+%H:%M')"
