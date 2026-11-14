#!/usr/bin/env python3
"""Carte dei set asiatici che TCGdex ha vuoti, dal sito ufficiale asia.pokemon-card.com (cinese tradizionale,
indonesiano, thailandese): nessun set deve restare vuoto nell'app, né oggi né per i set futuri.

Per ogni lingua guarda l'elenco dei set di TCGdex; di ogni set che su TCGdex non ha nessuna carta (o meno della metà
di quelle ufficiali), o che ha le carte ma senza foto, cerca le carte sul sito ufficiale con lo stesso codice del set (`expansionCodes=<id>`): numero,
nome, illustratore e foto. Le foto del sito pesano fino a 600 KB l'una e il sito non le dà ai browser di altri siti:
se ne salva una copia piccola (WebP largo 460 px) nello spazio file di Supabase, `immagini/asia/<lingua>/<file>.webp`.

Uscita (carte/v1/asia-ufficiale.json), letta da prezzi/src/asia-vuoti.js che la unisce al catalogo asiatico:
  { v, updated, base, sets: { lingua: { idSet: [[numero, nome, file della foto, illustratore], ...] } },
    senza: { lingua: [idSet, ...] } }   # set vuoti che nemmeno il sito ufficiale ha
I set già letti (stesso numero di carte sul sito) non si rileggono: il file pubblicato fa da memoria.

Uso: python3 prezzi/immagini/asia-ufficiale.py <uscita.json> [--prima <file già pubblicato>] [--catalogo asia.json] [--minuti N]
       [--solo lingua:ID,lingua:ID] [--senza-caricare]
Chiave di Supabase: variabile SUPABASE_SECRET_KEY (GitHub) o file ~/CollectorOne-chiave/supabase-secret-key.txt (Mac).
"""
import argparse
import concurrent.futures as cf
import datetime
import io
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SITE = "https://asia.pokemon-card.com"
TCGDEX = "https://api.tcgdex.net/v2"
SUPA = "https://lafgthxgasunkxrgwqng.supabase.co"
BASE = f"{SUPA}/storage/v1/object/public/dati/immagini/asia/"
# Lingua di TCGdex -> cartella del sito ufficiale.
LANGS = {"zh-tw": "tw", "id": "id", "th": "th"}
UA = {"User-Agent": "Mozilla/5.0 (CollectorOne; https://collectorone.app/)"}
WIDTH = 460
PER_PAGE = 20
# Set di TCG Pocket (solo digitali) e doppioni di «Triplet Beat» che TCGdex mette per errore nelle lingue asiatiche.
POCKET = re.compile(r"^(P-[A-Z]|[AB][0-9]+[a-z]?)$")
COPIES = re.compile(r"^CS", re.I)


def fetch(url, tries=4, binary=False):
    err = None
    for n in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                data = r.read()
                return data if binary else data.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            err = e
        except Exception as e:  # rete
            err = e
        time.sleep(2 * (n + 1))
    raise RuntimeError(f"{url}: {err}")


def clean(text):
    """Testo di una pagina senza etichette, spazi doppi e a capo."""
    text = re.sub(r"<[^>]+>", " ", text or "")
    for a, b in (("&amp;", "&"), ("&quot;", '"'), ("&#039;", "'"), ("&lt;", "<"), ("&gt;", ">"), ("&nbsp;", " ")):
        text = text.replace(a, b)
    return re.sub(r"\s+", " ", text).strip()


def list_page(html):
    """Carte di una pagina dei risultati: [(id della scheda, indirizzo della foto)], e quante pagine sono."""
    cards = re.findall(r'card-search/detail/(\d+)/"[^>]*>.*?data-original="([^"]+)"', html, re.S)
    m = re.search(r'resultTotalPages">[^0-9]*(\d+)', html)
    return cards, int(m.group(1)) if m else 0


def detail(html):
    """Scheda di una carta: nome, numero stampato ("001/159"), illustratore, codici dei set in cui si trova."""
    def one(pattern):
        m = re.search(pattern, html, re.S)
        return clean(m.group(1)) if m else ""
    return {
        "name": one(r'<li class="current">(.*?)</li>'),
        "number": one(r'class="collectorNumber">(.*?)</span>'),
        "illustrator": one(r'illustratorName=[^"]*">(.*?)</a>'),
        "sets": [urllib.parse.unquote(x) for x in re.findall(r'expansionCodes=([^"&]+)"', html)],
    }


def printed(number, card_id):
    """Numero della carta nel set: "001/159" -> "001"; senza cifre (energie "MET") un numero suo dal sito."""
    n = number.split("/")[0].strip()
    return n if re.search(r"\d", n) else f"e{card_id}"


def covered(catalog, sid, lang):
    """Il catalogo asiatico (asia.json) ha già le carte di questo set da CardTrader: non serve leggerlo dal sito."""
    sets, cards = catalog.get("sets") or {}, catalog.get("cards") or {}
    code = sets.get(f"{sid}@{lang}") or sets.get(sid)
    return bool(code and not re.match(r"^(tp|uff)-", code) and cards.get(code))


def empty_sets(lang, catalog):
    """Set di TCGdex in questa lingua senza carte (o con meno della metà di quelle ufficiali) o con le carte senza
    foto, che il catalogo asiatico non copre già con CardTrader: [(id, ufficiali)]."""
    out = []
    sets = json.loads(fetch(f"{TCGDEX}/{lang}/sets") or "[]")
    for s in sets:
        sid = s["id"]
        if POCKET.match(sid) or COPIES.match(sid) or covered(catalog, sid, lang):
            continue
        d = json.loads(fetch(f"{TCGDEX}/{lang}/sets/{urllib.parse.quote(sid)}") or "{}")
        cards = d.get("cards") or []
        official = (s.get("cardCount") or {}).get("official") or 0
        # Anche i set che le carte le hanno ma senza foto (almeno 5 carte e una su dieci): dal sito arrivano le foto,
        # che l'app mette sulle carte con lo stesso numero.
        no_photo = sum(1 for c in cards if not c.get("image"))
        if not cards or len(cards) * 2 < official or (no_photo >= 5 and no_photo * 10 >= len(cards)):
            out.append((sid, official))
    return out


def secret():
    key = os.environ.get("SUPABASE_SECRET_KEY", "").strip()
    if not key:
        f = pathlib.Path.home() / "CollectorOne-chiave" / "supabase-secret-key.txt"
        key = f.read_text().strip() if f.exists() else ""
    return key


def exists(path):
    try:
        req = urllib.request.Request(BASE + path, method="HEAD", headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status == 200
    except Exception:
        return False


def upload(path, data, key):
    url = f"{SUPA}/storage/v1/object/dati/immagini/asia/{path}"
    for n in range(4):
        try:
            req = urllib.request.Request(url, data=data, method="POST", headers={
                "apikey": key, "Authorization": f"Bearer {key}", "x-upsert": "true",
                "Cache-Control": "max-age=31536000", "Content-Type": "image/webp"})
            with urllib.request.urlopen(req, timeout=120) as r:
                r.read()
                return True
        except Exception:
            time.sleep(5 * (n + 1))
    return False


def thumbnail(png):
    from PIL import Image
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    if im.width > WIDTH:
        im = im.resize((WIDTH, round(im.height * WIDTH / im.width)), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "WEBP", quality=78, method=4)
    return out.getvalue()


def mirror(folder, image_url, key, dry):
    """Copia piccola della foto nello spazio file; restituisce il nome del file ("id/id00005038.webp") o "" se manca."""
    name = f"{folder}/{pathlib.PurePosixPath(urllib.parse.urlparse(image_url).path).stem}.webp"
    if dry or exists(name):
        return name
    png = fetch(image_url, binary=True)
    if not png:
        return ""
    return name if upload(name, thumbnail(png), key) else ""


def read_set(folder, sid, key, dry, pool):
    """Tutte le carte del set sul sito ufficiale: [[numero, nome, foto, illustratore]], in ordine di numero."""
    q = urllib.parse.quote(sid)
    first = fetch(f"{SITE}/{folder}/card-search/list/?expansionCodes={q}") or ""
    cards, pages = list_page(first)
    for p in range(2, pages + 1):
        more, _ = list_page(fetch(f"{SITE}/{folder}/card-search/list/?pageNo={p}&expansionCodes={q}") or "")
        cards += more

    def one(item):
        card_id, image = item
        d = detail(fetch(f"{SITE}/{folder}/card-search/detail/{card_id}/") or "")
        # Il sito deve dire che la carta è di questo set: un codice che non conosce non deve portare carte d'altri.
        if not d["name"] or sid not in d["sets"]:
            return None
        ill = "" if d["illustrator"].lower() == "n/a" else d["illustrator"]
        return [printed(d["number"], card_id), d["name"], mirror(folder, image, key, dry), ill]

    rows = [r for r in pool.map(one, cards) if r]
    key_of = lambda r: (int(re.sub(r"\D", "", r[0]) or 0) if not r[0].startswith("e") else 10 ** 9, r[0])
    rows.sort(key=key_of)
    return rows, len(cards)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--prima")
    ap.add_argument("--catalogo", help="asia.json pubblicato: i set che ha già da CardTrader si saltano")
    ap.add_argument("--minuti", type=float, default=120)
    ap.add_argument("--solo", default="")
    ap.add_argument("--senza-caricare", action="store_true")
    a = ap.parse_args()
    deadline = time.time() + a.minuti * 60
    before = {}
    if a.prima and pathlib.Path(a.prima).exists():
        try:
            before = json.loads(pathlib.Path(a.prima).read_text()).get("sets") or {}
        except Exception:
            before = {}
    catalog = {}
    if a.catalogo and pathlib.Path(a.catalogo).exists():
        try:
            catalog = json.loads(pathlib.Path(a.catalogo).read_text())
        except Exception:
            catalog = {}
    key = "" if a.senza_caricare else secret()
    if not a.senza_caricare and not key:
        print("manca la chiave di Supabase: le foto non si possono salvare")
        return 1
    only = [x.split(":", 1) for x in a.solo.split(",") if ":" in x]
    sets, missing, log = {}, {}, []

    def save():
        # Dopo ogni set: un giro interrotto non perde quello che ha già letto.
        data = {"v": 1, "updated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                "base": BASE, "sets": sets, "senza": missing}
        tmp = pathlib.Path(a.out + ".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        tmp.replace(a.out)

    with cf.ThreadPoolExecutor(8) as pool:
        for lang, folder in LANGS.items():
            sets[lang] = dict(before.get(lang) or {})
            try:
                targets = [(s, 0) for l, s in only if l == lang] if only else empty_sets(lang, catalog)
            except Exception as e:
                log.append(f"! {lang}: elenco dei set non letto ({e})")
                continue
            for sid, official in targets:
                if time.time() > deadline:
                    log.append(f"{lang} {sid}: rimandato al prossimo giro")
                    continue
                try:
                    old = sets[lang].get(sid)
                    first = fetch(f"{SITE}/{folder}/card-search/list/?expansionCodes={urllib.parse.quote(sid)}") or ""
                    _, pages = list_page(first)
                    # Già letto e con le stesse pagine sul sito: resta com'è.
                    if old and all(r[2] for r in old) and -(-len(old) // PER_PAGE) >= pages > 0:
                        continue
                    if pages == 0:
                        missing.setdefault(lang, []).append(sid)
                        continue
                    rows, found = read_set(folder, sid, key, a.senza_caricare, pool)
                    if not rows:
                        missing.setdefault(lang, []).append(sid)
                        continue
                    sets[lang][sid] = rows
                    save()
                    line = (f"{lang} {sid}: {len(rows)} carte su {found} del sito (TCGdex ne dichiara {official}), "
                            f"{sum(1 for r in rows if not r[2])} senza foto")
                    log.append(line)
                    print(line, flush=True)
                except Exception as e:
                    log.append(f"! {lang} {sid}: {e}")
    save()
    total = sum(len(v) for v in sets.values())
    print("\n".join(l for l in log if l.startswith("!") or "rimandato" in l))
    print(f"Sito ufficiale asiatico: {total} set, {sum(len(r) for v in sets.values() for r in v.values())} carte; "
          f"vuoti anche lì: {json.dumps(missing, ensure_ascii=False) if missing else 'nessuno'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
