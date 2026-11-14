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
#   bash scripts/job-notte.sh [prezzi|yugioh|cardmarket|asia|immagini|tutto|storico]
#
# Le parti sono indipendenti (su GitHub girano in parallelo); senza argomento si fanno tutte in fila.
# "storico" si lancia solo a mano: lo storico Cardmarket da solo, con tutti i giorni passati che mancano.
# Ripresa: le risposte CardTrader del giorno restano in ~/.collectorone/ct-cache/<data>: un job interrotto
# e ripartito lo stesso giorno continua da dove era arrivato. Le richieste riprovano da sole se manca la rete.
# Tempo: GitHub annulla una parte dopo 350 minuti senza pubblicare nulla. La parte "prezzi" ha una scadenza interna
# (PREZZI_MINUTI dall'inizio, 290; 0 = senza): oltre, le offerte CardTrader non ancora lette si prendono dall'ultima
# lettura dei giorni prima e i file si pubblicano comunque. Yu-Gi-Oh! ha la sua (YG_MINUTI), le carte TCGdex SCAN_MINUTI.
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
INIZIO_S=$(date +%s)
DATI="$HOME/.collectorone"
mkdir -p "$DATI/ct-cache"
# Copia dei file dello storico già pubblicati (resta nella memoria di Actions insieme al resto di ~/.collectorone):
# storico.js li legge da qui quando sono identici a quelli pubblicati, invece di riscaricarli tutti ogni notte
# (140 MB a notte = quasi tutto il traffico "non in cache" del piano gratuito di Supabase, 12 novembre 2026).
export STORICO_COPIA="$DATI/storico-copia"
# copia_storico <cartella di uscita di storico.js> <registro di storico.js>: dopo i caricamenti. Un file non caricato
# la notte dopo risulta diverso da quello pubblicato (etag) e si riscarica.
copia_storico() {
  mkdir -p "$STORICO_COPIA" && cp -R "$1/." "$STORICO_COPIA/" 2>/dev/null
  grep -E "^file dello storico: " "$2" 2>/dev/null
  true
}
# Cache CardTrader del giorno; quelle dei giorni prima restano per qualche giorno, poi si buttano. Yu-Gi-Oh! legge le
# offerte a rotazione (CT_REUSE_DAYS, vedi la parte yugioh): 8 giorni. La parte "prezzi" le legge tutte ogni notte, ma
# oltre la scadenza (PREZZI_MINUTI) prende quelle non ancora lette dall'ultima lettura dei giorni prima: 2 giorni.
# Si decide dal nome della cartella (la data), non dall'ora di modifica, che la cache di GitHub può cambiare.
export CT_CACHE="$DATI/ct-cache/$(date +%F)"
GIORNI_CACHE=2
if [ "$PARTE" = yugioh ] || [ "$PARTE" = tutto ]; then GIORNI_CACHE=8; fi
LIMITE_CACHE=$(python3 -c "import datetime, sys; print((datetime.date.today() - datetime.timedelta(days=int(sys.argv[1]))).isoformat())" "$GIORNI_CACHE")
for d in "$DATI"/ct-cache/*/; do
  [ -d "$d" ] && [ "$d" != "$CT_CACHE/" ] || continue
  g=$(basename "$d")
  # Tenute: le cartelle con una data da LIMITE_CACHE in poi (confronto di testo: AAAA-MM-GG).
  if [[ "$g" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && [[ ! "$g" < "$LIMITE_CACHE" ]]; then continue; fi
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

# Storico delle tendenze Cardmarket (grafico nella scheda di ogni prodotto e variazione delle 24 ore): il giorno di oggi
# dal listino ufficiale per tutti i prodotti (carte e sigillati Pokémon, sigillati degli altri giochi dal listino del loro
# gioco, oggetti col prezzo eBay), un file per espansione e, per i prodotti senza espansione, uno ogni 5.000 id; più, al
# massimo $1 per volta, i giorni passati che mancano dalle copie del listino nell'archivio di Internet (web.archive.org).
# Storico dei prezzi TCGplayer (grafico nella scheda di ogni prodotto): gli archivi giornalieri di tcgcsv.com che mancano
# (i lunedì dal 2024 e gli ultimi due mesi giorno per giorno), al massimo $1 per volta, un file per gruppo.
storico_tcgplayer() {
  local max=$1 n=0 f
  [ "${SENZA_CARICARE:-}" = 1 ] && max=1
  if node prezzi/src/storico.js tp "$OUT/storico" "$max" > "$OUT/storico-tp.log" 2>&1; then
    for f in "$OUT"/storico/tp/*.json; do carica "$f" "storico/v1/tp/$(basename "$f")" | grep -q caricato && n=$((n+1)); done
    carica "$OUT/storico/variazioni-tp.json" storico/v1/variazioni-tp.json > /dev/null
    copia_storico "$OUT/storico" "$OUT/storico-tp.log"
    echo "$(tail -1 "$OUT/storico-tp.log"), $n file caricati"
  else
    echo "storico TCGplayer non aggiornato: $(tail -3 "$OUT/storico-tp.log" | tr '\n' ' ')"
  fi
}

storico_cardmarket() {
  local max=$1 n=0 f
  [ "${SENZA_CARICARE:-}" = 1 ] && [ "$max" -gt 2 ] && max=2
  if node prezzi/src/storico.js cm "$OUT/storico" "$max" > "$OUT/storico-cm.log" 2>&1; then
    carica "$OUT/storico/variazioni-cm.json" storico/v1/variazioni-cm.json > /dev/null
    for f in "$OUT"/storico/cm/*.json; do carica "$f" "storico/v1/cm/$(basename "$f")" | grep -q caricato && n=$((n+1)); done
    copia_storico "$OUT/storico" "$OUT/storico-cm.log"
    grep -E "^storico (Cardmarket, |degli oggetti)|archivio di Internet interrotto" "$OUT/storico-cm.log"
    echo "$(tail -1 "$OUT/storico-cm.log"), $n file caricati"
  else
    echo "storico Cardmarket non aggiornato: $(tail -3 "$OUT/storico-cm.log" | tr '\n' ' ')"
  fi
}
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
  storico_tcgplayer "${STORICO_MAX:-40}"
  # Yu-Gi-Oh! gira nella parte "yugioh" (job parallelo su GitHub): qui i suoi file così come sono pubblicati (di stanotte
  # o della notte prima, secondo chi finisce prima), per le date dei set e le foto eBay dei suoi sigillati (il file dei
  # sigillati che ne esce non si carica: lo carica l'altra parte). Lo storico e le variazioni 24h di Yu-Gi-Oh! li fa la
  # sua parte, col catalogo appena costruito.
  export CT_GAMES_SKIP=yugioh
  # Scadenza della notte (9 novembre 2026: la parte durava 287 minuti su 350, e oltre il limite GitHub la annulla senza
  # pubblicare nulla): dopo PREZZI_MINUTI minuti dall'inizio della parte build.js non chiede più offerte a CardTrader,
  # prende quelle non ancora lette dall'ultima lettura dei giorni prima (cartelle ct-cache/<data>) e scrive comunque i
  # file. Dopo restano i blueprint dei giochi rimasti, i caricamenti, lo storico e la riserva: 15-20 minuti.
  PREZZI_MINUTI=${PREZZI_MINUTI:-290}
  if [ "$PREZZI_MINUTI" -gt 0 ] 2>/dev/null; then export CT_SCADENZA=$(( (INIZIO_S + PREZZI_MINUTI * 60) * 1000 )); fi
  node prezzi/src/build.js "$OUT/prezzi" || exit 1
  unset CT_SCADENZA
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
  # Storico delle stime CardTrader di One Piece, Lorcana e Dragon Ball (grafico e variazione 24h nell'app), dai cataloghi
  # appena costruiti. Non Yu-Gi-Oh! (10 novembre 2026): qui c'era il suo catalogo pubblicato in quel momento, e quando la
  # parte "yugioh" finiva dopo era quello di ieri, confrontato con se stesso: 0% per tutte le sue 46.413 carte.
  # Il file delle variazioni è uno solo per le due parti: storico.js tiene le voci dell'altra come sono pubblicate e le
  # legge subito prima di scrivere, quindi si carica per primo (i file dei set, che sono minuti di caricamenti, dopo).
  if node prezzi/src/storico.js ct "$OUT/storico" "$OUT/prezzi/v1/onepiece.json" "$OUT/prezzi/v1/lorcana.json" "$OUT/prezzi/v1/dragonball.json" > "$OUT/storico-ct.log" 2>&1; then
    carica "$OUT/storico/variazioni-ct.json" storico/v1/variazioni-ct.json > /dev/null
    n=0; for f in "$OUT"/storico/ct/*.json; do carica "$f" "storico/v1/ct/$(basename "$f")" | grep -q caricato && n=$((n+1)); done
    copia_storico "$OUT/storico" "$OUT/storico-ct.log"
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
  # In fondo al registro (stato/prezzi.json tiene le ultime righe): durata e chiamate a CardTrader e, se la scadenza della
  # notte è scattata, quante letture di offerte vengono dai giorni prima e quante sono rimandate.
  echo "offerte CardTrader: $(tail -1 "$OUT/prezzi/log.txt" 2>/dev/null)"
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
    # Storico e variazioni 24h di Yu-Gi-Oh! (grafico e badge nell'app), col catalogo appena costruito: un punto al giorno,
    # sempre da questa parte. Le variazioni degli altri giochi nel file restano come le ha pubblicate la parte "prezzi";
    # il file delle variazioni si carica per primo (vedi la parte "prezzi").
    if node prezzi/src/storico.js ct "$OUT/yugioh/storico" "yg=$OUT/yugioh/yugioh.json" > "$OUT/yugioh/storico-ct.log" 2>&1; then
      carica "$OUT/yugioh/storico/variazioni-ct.json" storico/v1/variazioni-ct.json > /dev/null
      n=0; for f in "$OUT"/yugioh/storico/ct/*.json; do carica "$f" "storico/v1/ct/$(basename "$f")" | grep -q caricato && n=$((n+1)); done
      copia_storico "$OUT/yugioh/storico" "$OUT/yugioh/storico-ct.log"
      echo "$(tail -1 "$OUT/yugioh/storico-ct.log"), $n file caricati"
    else
      echo "storico Yu-Gi-Oh! non aggiornato: $(tail -3 "$OUT/yugioh/storico-ct.log" | tr '\n' ' ')"
    fi
  else
    echo "Yu-Gi-Oh! non aggiornato: $(tail -3 "$OUT/yugioh/log.txt" 2>/dev/null | tr '\n' ' ')"
  fi
fi

if [ "$PARTE" = cardmarket ] || [ "$PARTE" = tutto ]; then
  # Prodotti Cardmarket sbagliati di TCGdex, con i prezzi giusti dal listino Cardmarket (prezzi/src/cardmarket.js).
  # Le carte TCGdex (catalogo inglese e giapponese) restano in cache: ogni notte si rileggono quelle con prezzi TCGplayer
  # (finiscono nel file dei prezzi, vedi cm-prezzi.js) e quelle senza prodotto; il lunedì tutte (RILEGGI: quelle che
  # non rispondono tengono i dati di prima, invece di sparire dal file come quando la cache si buttava).
  CARTE="$DATI/tcgdex-carte.json"
  CARTE_JA="$DATI/tcgdex-carte-ja.json"
  if [ "$(date +%u)" = 1 ]; then export RILEGGI=1; fi
  node prezzi/src/tcgdex-scan.js "$CARTE" > "$OUT/cardmarket.log" &&
    node prezzi/src/cardmarket.js "$CARTE" "$OUT/cardmarket.json" >> "$OUT/cardmarket.log" &&
    carica "$OUT/cardmarket.json" prezzi/v1/cardmarket.json && carica "$OUT/cardmarket.log" prezzi/cardmarket-log.txt text/plain &&
    echo "correzioni Cardmarket: $(tail -1 "$OUT/cardmarket.log")" || echo "correzioni Cardmarket non aggiornate"
  # Prezzi Cardmarket e TCGplayer di tutte le carte TCGdex in un file solo (prezzi/src/cm-prezzi.js): l'app aggiorna i
  # prezzi della collezione da qui, senza chiedere a TCGdex una carta alla volta.
  node prezzi/src/tcgdex-scan.js "$CARTE_JA" ja > "$OUT/cm-prezzi.log" &&
    node prezzi/src/cm-prezzi.js "$CARTE" "$OUT/cm-prezzi.json" "$CARTE_JA" >> "$OUT/cm-prezzi.log" &&
    carica "$OUT/cm-prezzi.json" prezzi/v1/cm-prezzi.json &&
    echo "$(tail -1 "$OUT/cm-prezzi.log")" || echo "prezzi Cardmarket delle carte non aggiornati"
  # Carte TCGdex non lette o rimandate (TCGdex lento): nel registro, così si vede dallo stato della parte.
  grep -hE "carte non lette|tempo finito" "$OUT/cardmarket.log" "$OUT/cm-prezzi.log" 2>/dev/null | sed 's/^ */TCGdex: /'
  unset RILEGGI
  # Giochi sui prezzi dell'app (prezzi/src/giochi.js, 0.9.175): un campione di carte di ogni gioco col prezzo, che cambia
  # ogni notte, e le domande della sfida del giorno e di quella della settimana, uguali per tutti (quelle già pubblicate
  # restano come sono). I cataloghi degli altri giochi sono quelli pubblicati in questo momento.
  GI="$OUT/giochi"; mkdir -p "$GI"
  for f in onepiece.json lorcana.json dragonball.json yugioh.json sealed.json onepiece-sealed.json lorcana-sealed.json dragonball-sealed.json yugioh-sealed.json; do scarica "prezzi/v1/$f" "$GI/$f" > /dev/null || true; done
  node prezzi/src/giochi.js "$CARTE" "$GI" "$OUT/giochi.json" > "$OUT/giochi.log" 2>&1 &&
    carica "$OUT/giochi.json" giochi/v1/giochi.json > /dev/null && echo "$(tail -1 "$OUT/giochi.log")" ||
    echo "giochi non aggiornati: $(tail -2 "$OUT/giochi.log" | tr '\n' ' ')"
  # Illustratore di ogni carta (prezzi/src/illustratori.js, 0.9.184), per sfogliare le carte per illustratore: Pokémon da
  # TCGdex (inglese e lingue asiatiche, una richiesta per illustratore: meno di un minuto), Lorcana da LorcanaJSON sul
  # catalogo pubblicato. Una lingua che TCGdex non dà resta com'è nel file pubblicato.
  node prezzi/src/illustratori.js "$CARTE" "$GI/lorcana.json" "$OUT/illustratori.json" > "$OUT/illustratori.log" 2>&1 &&
    carica "$OUT/illustratori.json" carte/v1/illustratori.json > /dev/null && echo "$(tail -1 "$OUT/illustratori.log")" ||
    echo "illustratori non aggiornati: $(tail -2 "$OUT/illustratori.log" | tr '\n' ' ')"
  # Storico Cardmarket di tutti i prodotti: oggi, e qualche giorno passato che manca (il recupero intero: parte "storico").
  storico_cardmarket "${STORICO_CM_ARCHIVIO:-10}"
  # Prezzi chiesti su eBay per lingua, variante e voto (prezzi/src/ebay-prezzi.js): tutti i prodotti a rotazione, i più
  # cari più spesso, al massimo EBAY_BUDGET ricerche a notte. Il file si accumula: si parte da quello di ieri.
  # Nelle prove (SENZA_CARICARE=1) niente ricerche: consumerebbero la quota eBay della notte senza salvare nulla.
  if [ -n "${EBAY_APP_ID:-}" ] && [ "${SENZA_CARICARE:-}" != 1 ]; then
    EB="$OUT/ebay"; mkdir -p "$EB"
    for f in onepiece.json lorcana.json dragonball.json yugioh.json sealed.json onepiece-sealed.json lorcana-sealed.json dragonball-sealed.json yugioh-sealed.json tcgplayer.json; do scarica "prezzi/v1/$f" "$EB/$f" > /dev/null || true; done
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
if [ "$PARTE" = storico ]; then
  # A mano (workflow "Dati notturni", parte "storico"): solo lo storico, coi giorni passati che mancano tutti in una volta:
  # Cardmarket dall'archivio di Internet e TCGplayer da tcgcsv.com (che dopo una settantina di archivi di fila limita le
  # richieste: una pausa tra l'uno e l'altro). STORICO_SOLO=cm o tp per farne uno solo.
  SOLO=${STORICO_SOLO:-}
  if [ -z "$SOLO" ] || [ "$SOLO" = cm ]; then storico_cardmarket "${STORICO_CM_ARCHIVIO:-80}"; fi
  if [ -z "$SOLO" ] || [ "$SOLO" = tp ]; then export STORICO_PAUSA_MS=${STORICO_PAUSA_MS:-2000}; storico_tcgplayer "${STORICO_MAX:-70}"; fi
fi

# Nessun set vuoto nell'app (richiesto dall'utente l'11 novembre 2026: "né ora né tra 10 anni"): ogni notte i set delle
# lingue asiatiche che TCGdex elenca senza carte, e che il catalogo asiatico non copre già con CardTrader, si riempiono
# da soli: i giapponesi da TCGplayer, cinese tradizionale / indonesiano / thailandese dal sito ufficiale
# asia.pokemon-card.com (prezzi/immagini/asia-ufficiale.py: legge solo i set nuovi, il file pubblicato fa da memoria, e
# salva le foto in piccolo nello spazio file). prezzi/src/asia-vuoti.js li unisce al catalogo pubblicato, senza
# CardTrader (il catalogo intero lo rifà asia.js il lunedì, che alla fine chiama la stessa funzione). Se un set resta
# vuoto la parte finisce in errore: GitHub manda l'email e stato/asia.json dice quale.
if [ "$PARTE" = asia ] || [ "$PARTE" = tutto ]; then
  echo "=== asia"
  ASIA_ESITO=0
  if scarica carte/v1/asia.json "$OUT/asia-prima.json"; then
    scarica carte/v1/asia-ufficiale.json "$OUT/uff-prima.json" 2>/dev/null || echo "sito ufficiale asiatico: nessun file precedente"
    UFF_OPZ=""; [ "${SENZA_CARICARE:-}" = 1 ] && UFF_OPZ="--senza-caricare"
    python3 prezzi/immagini/asia-ufficiale.py "$OUT/asia-ufficiale.json" --prima "$OUT/uff-prima.json" --catalogo "$OUT/asia-prima.json" --minuti "${ASIA_MINUTI:-120}" $UFF_OPZ > "$OUT/uff.log" 2>&1 &&
      [ -s "$OUT/asia-ufficiale.json" ] && carica "$OUT/asia-ufficiale.json" carte/v1/asia-ufficiale.json > /dev/null &&
      { grep -E "^!|rimandato" "$OUT/uff.log" | head -20; tail -1 "$OUT/uff.log"; } ||
      echo "sito ufficiale asiatico non letto: $(tail -2 "$OUT/uff.log" | tr '\n' ' ')"
    if node prezzi/src/asia-vuoti.js "$OUT/asia-prima.json" "$OUT/asia-pieno.json" > "$OUT/vuoti.log" 2>&1; then
      cat "$OUT/vuoti.log"
      carica "$OUT/asia-pieno.json" carte/v1/asia.json
      grep -q "ANCORA VUOTI" "$OUT/vuoti.log" && ASIA_ESITO=3
    else
      echo "set vuoti non controllati: $(tail -3 "$OUT/vuoti.log" | tr '\n' ' ')"; ASIA_ESITO=2
    fi
  else
    echo "catalogo asiatico non scaricato"; ASIA_ESITO=2
  fi
  [ "$PARTE" = asia ] && [ "$ASIA_ESITO" != 0 ] && exit "$ASIA_ESITO"
fi

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
  # Al massimo 150 minuti per giro (dentro le 4 ore della parte): quello che resta si fa il lunedì dopo.
  python3 prezzi/immagini/impronte.py "$OUT/impronte.json" --minuti "${IMPRONTE_MINUTI:-150}" --prima "$OUT/impronte-prima.json" --onepiece "$OUT/onepiece-impronte.json" --lorcana "$OUT/lorcana-impronte.json" --dragonball "$OUT/dragonball-impronte.json" --yugioh "$OUT/yugioh-impronte.json" > "$OUT/impronte.log" 2>&1 &&
    [ -s "$OUT/impronte.json" ] &&
    carica "$OUT/impronte.json" carte/v1/impronte.json && carica "$OUT/impronte.log" carte/impronte-log.txt text/plain &&
    echo "impronte: $(tail -1 "$OUT/impronte.log")" || echo "impronte non aggiornate (vedi $(tail -1 "$OUT/impronte.log" 2>/dev/null))"
fi
echo "=== fatto $(date '+%H:%M')"
