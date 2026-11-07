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
# Yu-Gi-Oh! tiene le risposte degli ultimi giorni: le offerte si leggono a rotazione (CT_REUSE_DAYS, vedi la parte yugioh).
for d in "$DATI"/ct-cache/*/; do
  [ -d "$d" ] && [ "$d" != "$CT_CACHE/" ] || continue
  if [ "$PARTE" = yugioh ] && [ -z "$(find "$d" -maxdepth 0 -mtime +8)" ]; then continue; fi
  rm -rf "${d:?}"
done; true
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
(cd prezzi && npm test --silent >/dev/null 2>&1) || { (cd prezzi && npm test 2>&1 | grep -E "✖|Error" | head -10) || true; echo "test del job falliti: niente pubblicazione"; exit 1; }

if [ "$PARTE" = prezzi ] || [ "$PARTE" = tutto ]; then
  # Catalogo TCGplayer completo (ultima fonte per le righe di Collectr che mancano altrove, e foto dei sigillati
  # che CardTrader non fotografa): ogni notte, prima dei prezzi.
  node prezzi/src/tcgplayer-all.js "$OUT/tcgplayer.json" > "$OUT/tcgplayer.log" &&
    carica "$OUT/tcgplayer.json" prezzi/v1/tcgplayer.json && echo "catalogo TCGplayer: $(tail -1 "$OUT/tcgplayer.log")" &&
    export TCGPLAYER_JSON="$OUT/tcgplayer.json" ||
    echo "catalogo TCGplayer non aggiornato"
  # Storico dei prezzi TCGplayer (grafico nella scheda delle carte): gli archivi di tcgcsv.com che mancano, al massimo
  # STORICO_MAX per notte (il passato dal 2024 si riempie in qualche notte), un file per gruppo (prezzi/src/storico.js).
  MAXS=${STORICO_MAX:-40}; [ "${SENZA_CARICARE:-}" = 1 ] && MAXS=1
  if node prezzi/src/storico.js tp "$OUT/storico" "$MAXS" > "$OUT/storico-tp.log" 2>&1; then
    n=0; for f in "$OUT"/storico/tp/*.json; do carica "$f" "storico/v1/tp/$(basename "$f")" | grep -q caricato && n=$((n+1)); done
    carica "$OUT/storico/variazioni-tp.json" storico/v1/variazioni-tp.json > /dev/null
    echo "$(tail -1 "$OUT/storico-tp.log"), $n file caricati"
  else
    echo "storico TCGplayer non aggiornato: $(tail -3 "$OUT/storico-tp.log" | tr '\n' ' ')"
  fi
  # Yu-Gi-Oh! gira nella parte "yugioh" (job parallelo su GitHub): qui i suoi file pubblicati dalla notte prima, per lo
  # storico CardTrader e le foto eBay dei suoi sigillati (il file dei sigillati che ne esce non si carica: lo carica l'altra parte).
  export CT_GAMES_SKIP=yugioh
  node prezzi/src/build.js "$OUT/prezzi" || exit 1
  mkdir -p "$OUT/yg"
  scarica prezzi/v1/yugioh.json "$OUT/yg/yugioh.json" > /dev/null 2>&1 || echo "yugioh.json non ancora pubblicato"
  scarica prezzi/v1/yugioh-sealed.json "$OUT/yg/yugioh-sealed.json" > /dev/null 2>&1 || true
  # Oggetti da collezione (medaglie Poste Italiane/Zecca...), elenco a mano in prezzi/dati/oggetti.json.
  node prezzi/src/oggetti.js prezzi/dati/oggetti.json "$OUT/prezzi/v1/sealed.json" || echo "oggetti non aggiunti"
  # Foto dei sigillati che né CardTrader né TCGplayer fotografano (Gem Pack cinesi, prodotti giapponesi, case...): la foto
  # di un'inserzione eBay dello stesso prodotto (prezzi/src/foto-ebay.js), al massimo FOTO_EBAY_MAX ricerche a notte;
  # la cache tiene le foto trovate e i tentativi a vuoto (si riprovano dopo 30 giorni).
  scarica prezzi/foto-ebay.json "$OUT/foto-ebay.json" > /dev/null 2>&1 || true
  # Nelle prove (SENZA_CARICARE=1) nessuna ricerca nuova: si usano solo le foto già in cache.
  MAXF=${FOTO_EBAY_MAX:-300}; [ "${SENZA_CARICARE:-}" = 1 ] && MAXF=0
  if node prezzi/src/foto-ebay.js "$OUT/foto-ebay.json" "$MAXF" "$OUT/prezzi/v1/sealed.json" \
      "$OUT/prezzi/v1/onepiece-sealed.json" "$OUT/prezzi/v1/lorcana-sealed.json" "$OUT/prezzi/v1/dragonball-sealed.json" "$OUT/yg/yugioh-sealed.json" > "$OUT/foto-ebay.log" 2>&1; then
    carica "$OUT/foto-ebay.json" prezzi/foto-ebay.json > /dev/null
    echo "$(grep '^Foto eBay dei sigillati' "$OUT/foto-ebay.log")"
  else
    echo "foto eBay dei sigillati non aggiornate: $(tail -2 "$OUT/foto-ebay.log" | tr '\n' ' ')"
  fi
  for f in "$OUT"/prezzi/v1/*.json; do carica "$f" "prezzi/v1/$(basename "$f")"; done
  carica "$OUT/prezzi/log.txt" prezzi/log.txt text/plain
  # Storico delle stime CardTrader di One Piece e Lorcana (grafico e variazione 24h nell'app), dai cataloghi appena costruiti.
  if node prezzi/src/storico.js ct "$OUT/storico" "$OUT/prezzi/v1/onepiece.json" "$OUT/prezzi/v1/lorcana.json" "$OUT/prezzi/v1/dragonball.json" "$OUT/yg/yugioh.json" > "$OUT/storico-ct.log" 2>&1; then
    n=0; for f in "$OUT"/storico/ct/*.json; do carica "$f" "storico/v1/ct/$(basename "$f")" | grep -q caricato && n=$((n+1)); done
    carica "$OUT/storico/variazioni-ct.json" storico/v1/variazioni-ct.json > /dev/null
    echo "$(tail -1 "$OUT/storico-ct.log"), $n file caricati"
  else
    echo "storico CardTrader non aggiornato: $(tail -3 "$OUT/storico-ct.log" | tr '\n' ' ')"
  fi

  # Date di uscita dei set (ordine dei set in collezione): solo le schede TCGdex nuove, il resto ogni notte.
  # Anche i set dei giochi CardTrader (dal gruppo TCGplayer delle loro carte) e le espansioni dei loro sigillati.
  node prezzi/src/set-dates.js "$DATI/date-set.json" "$OUT/prezzi/v1/sealed.json" "$OUT/date-set.json" \
    "$OUT"/prezzi/v1/onepiece.json "$OUT"/prezzi/v1/lorcana.json "$OUT"/prezzi/v1/dragonball.json "$OUT"/yg/yugioh.json \
    "$OUT"/prezzi/v1/onepiece-sealed.json "$OUT"/prezzi/v1/lorcana-sealed.json "$OUT"/prezzi/v1/dragonball-sealed.json "$OUT"/yg/yugioh-sealed.json \
    > "$OUT/date-set.log" &&
    carica "$OUT/date-set.json" carte/v1/date-set.json && echo "date dei set: $(tail -1 "$OUT/date-set.log")" ||
    echo "date dei set non aggiornate"

  # Prezzi TCGplayer delle carte giapponesi (terza fonte, da tcgcsv.com): ogni notte.
  node prezzi/src/tcgplayer-ja.js "$OUT/tcgplayer-ja.json" > "$OUT/tcgplayer-ja.log" &&
    carica "$OUT/tcgplayer-ja.json" prezzi/v1/tcgplayer-ja.json && echo "prezzi TCGplayer giapponesi: $(tail -1 "$OUT/tcgplayer-ja.log")" ||
    echo "prezzi TCGplayer giapponesi non aggiornati"

  # Riserva su GitHub (branch "prezzi"): tutti i file di prezzi/v1, compresi quelli delle altre parti.
  cp "$OUT/tcgplayer.json" "$OUT/tcgplayer-ja.json" "$OUT/prezzi/v1/" 2>/dev/null
  scarica prezzi/v1/cardmarket.json "$OUT/prezzi/v1/cardmarket.json" || echo "riserva: cardmarket.json non scaricato"
  scarica prezzi/v1/cm-prezzi.json "$OUT/prezzi/v1/cm-prezzi.json" || echo "riserva: cm-prezzi.json non scaricato"
  riserva "$OUT/prezzi" prezzi
fi

if [ "$PARTE" = yugioh ] || [ "$PARTE" = tutto ]; then
  # Yu-Gi-Oh! (CardTrader gioco 4: 691 espansioni × 7 lingue, ore di chiamate): catalogo e sigillati in una parte propria,
  # in parallelo con "prezzi" su GitHub, così non allunga la notte degli altri giochi. Stesso codice di ct-giochi.js;
  # le foto eBay dei sigillati le cerca la parte "prezzi" (cache prezzi/foto-ebay.json), qui si applicano solo quelle già trovate.
  mkdir -p "$OUT/yugioh"
  # YG_DIR prima di node (dopo lo script era un argomento, non una variabile: il 4 novembre 2026 il catalogo non si salvava).
  if YG_DIR="$OUT/yugioh" CT_CACHE="${CT_CACHE:-}" node --input-type=module -e "
      import { CardTrader } from './prezzi/src/cardtrader.js';
      import { buildCtGameFiles } from './prezzi/src/ct-giochi.js';
      // Offerte a rotazione: quelle lette negli ultimi 3 giorni restano buone; dopo YG_MINUTI minuti (270, GitHub ferma il
      // job a 350) non si chiede più nulla e si usa l'ultima lettura dei giorni prima: il catalogo si pubblica ogni notte
      // (il 4 novembre 2026 il primo giro intero ha superato le 6 ore e non ha pubblicato niente).
      const started = Date.now();
      const ct = new CardTrader({
        token: process.env.CARDTRADER_TOKEN, cacheDir: process.env.CT_CACHE || null,
        reuseDays: Number(process.env.CT_REUSE_DAYS || 3), deadline: started + Number(process.env.YG_MINUTI || 270) * 60000,
      });
      const log = await buildCtGameFiles({ ct, dir: process.env.YG_DIR, only: ['yugioh'], maxExpansions: Number(process.env.MAX_EXPANSIONS || Infinity) });
      log.push('Fatto in ' + Math.round((Date.now() - started) / 60000) + ' minuti, ' + ct.calls + ' chiamate a CardTrader' + (ct.cached ? ', ' + ct.cached + ' dalla cache di oggi' : '') +
        (ct.reused ? ', ' + ct.reused + ' letture dei giorni prima' : '') + (ct.skipped ? ', ' + ct.skipped + ' rimandate alla prossima notte' : '') + '.');
      console.log(log.join('\n'));
    " > "$OUT/yugioh/log.txt" 2>&1 && [ -s "$OUT/yugioh/yugioh.json" ]; then
    scarica prezzi/foto-ebay.json "$OUT/yugioh/foto-ebay.json" > /dev/null 2>&1 || true
    node prezzi/src/foto-ebay.js "$OUT/yugioh/foto-ebay.json" 0 "$OUT/yugioh/yugioh-sealed.json" >> "$OUT/yugioh/log.txt" 2>&1 || true
    carica "$OUT/yugioh/yugioh.json" prezzi/v1/yugioh.json
    carica "$OUT/yugioh/yugioh-sealed.json" prezzi/v1/yugioh-sealed.json
    carica "$OUT/yugioh/log.txt" prezzi/yugioh-log.txt text/plain
    echo "Yu-Gi-Oh!: $(grep -E '^Yu-Gi-Oh!: [0-9]+ espansioni' "$OUT/yugioh/log.txt" | head -1) · $(tail -1 "$OUT/yugioh/log.txt")"
  else
    echo "Yu-Gi-Oh! non aggiornato: $(tail -3 "$OUT/yugioh/log.txt" 2>/dev/null | tr '\n' ' ')"
  fi
fi

if [ "$PARTE" = cardmarket ] || [ "$PARTE" = tutto ]; then
  # Prodotti Cardmarket sbagliati di TCGdex, con i prezzi giusti dal listino Cardmarket (prezzi/src/cardmarket.js).
  # Le carte TCGdex (catalogo inglese e giapponese) restano in cache: il lunedì si riscaricano tutte.
  CARTE="$DATI/tcgdex-carte.json"
  CARTE_JA="$DATI/tcgdex-carte-ja.json"
  [ "$(date +%u)" = 1 ] && rm -f "$CARTE" "$CARTE_JA"
  node prezzi/src/tcgdex-scan.js "$CARTE" > "$OUT/cardmarket.log" &&
    node prezzi/src/cardmarket.js "$CARTE" "$OUT/cardmarket.json" >> "$OUT/cardmarket.log" &&
    carica "$OUT/cardmarket.json" prezzi/v1/cardmarket.json && carica "$OUT/cardmarket.log" prezzi/cardmarket-log.txt text/plain &&
    echo "correzioni Cardmarket: $(tail -1 "$OUT/cardmarket.log")" || echo "correzioni Cardmarket non aggiornate"
  # Prezzi Cardmarket di tutte le carte TCGdex in un file solo (prezzi/src/cm-prezzi.js): l'app aggiorna i prezzi
  # della collezione da qui, senza chiedere a TCGdex una carta alla volta.
  node prezzi/src/tcgdex-scan.js "$CARTE_JA" ja > "$OUT/cm-prezzi.log" &&
    node prezzi/src/cm-prezzi.js "$CARTE" "$OUT/cm-prezzi.json" "$CARTE_JA" >> "$OUT/cm-prezzi.log" &&
    carica "$OUT/cm-prezzi.json" prezzi/v1/cm-prezzi.json &&
    echo "$(tail -1 "$OUT/cm-prezzi.log")" || echo "prezzi Cardmarket delle carte non aggiornati"
  # Storico delle tendenze Cardmarket (grafico nella scheda delle carte): oggi, un file per espansione.
  if node prezzi/src/storico.js cm "$OUT/storico" > "$OUT/storico-cm.log" 2>&1; then
    n=0; for f in "$OUT"/storico/cm/*.json; do carica "$f" "storico/v1/cm/$(basename "$f")" | grep -q caricato && n=$((n+1)); done
    carica "$OUT/storico/variazioni-cm.json" storico/v1/variazioni-cm.json > /dev/null
    echo "$(tail -1 "$OUT/storico-cm.log"), $n file caricati"
  else
    echo "storico Cardmarket non aggiornato: $(tail -3 "$OUT/storico-cm.log" | tr '\n' ' ')"
  fi
  # Prezzi chiesti su eBay per lingua, variante e voto (prezzi/src/ebay-prezzi.js): tutti i prodotti a rotazione, i più
  # cari più spesso, al massimo EBAY_BUDGET ricerche a notte. Il file si accumula: si parte da quello di ieri.
  if [ -n "${EBAY_APP_ID:-}" ]; then
    EB="$OUT/ebay"; mkdir -p "$EB"
    for f in onepiece.json lorcana.json dragonball.json yugioh.json sealed.json; do scarica "prezzi/v1/$f" "$EB/$f" > /dev/null || true; done
    scarica carte/v1/asia.json "$EB/asia.json" > /dev/null || true
    scarica prezzi/v1/ebay.json "$EB/ebay.json" > /dev/null || echo '{"v":1,"p":{}}' > "$EB/ebay.json"
    if node prezzi/src/ebay-universo.js "$CARTE" "$CARTE_JA" "$EB" "$EB/universo.json" > "$OUT/ebay.log" 2>&1 &&
      node prezzi/src/ebay-prezzi.js "$EB/universo.json" "$EB/ebay.json" >> "$OUT/ebay.log" 2>&1; then
      carica "$EB/ebay.json" prezzi/v1/ebay.json > /dev/null
      carica "$OUT/ebay.log" prezzi/ebay-log.txt text/plain > /dev/null
      echo "$(tail -1 "$OUT/ebay.log")"
    else
      echo "prezzi eBay non aggiornati: $(tail -3 "$OUT/ebay.log" | tr '\n' ' ')"
    fi
  fi
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
  # Impronte di tutte le carte per il "confronto foto" dell'app (prezzi/immagini/impronte.py, serve Pillow+numpy):
  # le impronte già calcolate si riusano, si scaricano solo le immagini delle carte nuove.
  scarica carte/v1/impronte.json "$OUT/impronte-prima.json" || echo "impronte: nessun file precedente"
  scarica prezzi/v1/onepiece.json "$OUT/onepiece-impronte.json" || echo "impronte: onepiece.json non scaricato"
  scarica prezzi/v1/lorcana.json "$OUT/lorcana-impronte.json" || echo "impronte: lorcana.json non scaricato"
  scarica prezzi/v1/dragonball.json "$OUT/dragonball-impronte.json" || echo "impronte: dragonball.json non scaricato"
  scarica prezzi/v1/yugioh.json "$OUT/yugioh-impronte.json" || echo "impronte: yugioh.json non scaricato"
  python3 prezzi/immagini/impronte.py "$OUT/impronte.json" --prima "$OUT/impronte-prima.json" --onepiece "$OUT/onepiece-impronte.json" --lorcana "$OUT/lorcana-impronte.json" --dragonball "$OUT/dragonball-impronte.json" --yugioh "$OUT/yugioh-impronte.json" > "$OUT/impronte.log" 2>&1 &&
    [ -s "$OUT/impronte.json" ] &&
    carica "$OUT/impronte.json" carte/v1/impronte.json && carica "$OUT/impronte.log" carte/impronte-log.txt text/plain &&
    echo "impronte: $(tail -1 "$OUT/impronte.log")" || echo "impronte non aggiornate (vedi $(tail -1 "$OUT/impronte.log" 2>/dev/null))"
fi
echo "=== fatto $(date '+%H:%M')"
