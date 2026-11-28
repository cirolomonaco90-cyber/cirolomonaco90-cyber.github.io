#!/usr/bin/env python3
"""
Impronte (pHash) di tutte le carte, per il "confronto foto" nell'app (CardFingerprints.kt):
la stessa impronta la calcola il telefono sulla foto scattata (CardHash.kt), e si cercano le carte
più vicine. Identica in Kotlin e qui: cambiando una, cambiare l'altra (test CardHashTest).

Fonti: carte Pokémon di TCGdex (inglese, più i set giapponesi) e carte One Piece (immagini CardTrader,
dal file onepiece.json del job). Le impronte già calcolate si riusano (file precedente): ogni settimana
si scaricano solo le immagini delle carte nuove.

Uso: impronte.py <uscita.json> [--prima <impronte precedenti.json>] [--onepiece <onepiece.json>] [--lorcana <lorcana.json>] [--dragonball <dragonball.json>] [--yugioh <yugioh.json>] [--max N] [--minuti M]
Serve Pillow (con WebP) e numpy; senza, esce con un avviso e non scrive nulla.
"""
import concurrent.futures, io, json, sys, time, urllib.request

try:
    import numpy as np
    from PIL import Image
except ImportError as e:  # pragma: no cover
    print(f"impronte: manca {e.name} (pip install pillow numpy): salto")
    sys.exit(0)

API = 'https://api.tcgdex.net/v2'
SIZE, N, ART_TOP = 64, 32, 6
_COS = np.array([[np.cos(np.pi * (2 * n + 1) * k / (2.0 * N)) for n in range(N)] for k in range(N)])
_SCALE = np.array([np.sqrt(1.0 / N)] + [np.sqrt(2.0 / N)] * (N - 1))


def phash(block):
    """pHash di un blocco 32×32 (float): DCT-II, 8×8 di basse frequenze, soglia alla mediana (come CardHash.phash)."""
    block = np.ascontiguousarray(block, dtype=np.float64)
    with np.errstate(all='ignore'):  # avvisi spuri di numpy/Accelerate su macOS
        rows = block @ _COS[:8].T                   # (32 righe, 8 frequenze u)
        low = (_COS[:8] @ rows) * _SCALE[:8][:, None] * _SCALE[:8][None, :]  # (v, u)
    low = low.reshape(64)
    values = np.sort(low[1:])
    median = (values[30] + values[31]) / 2.0
    bits = 0
    for i in range(1, 64):
        if low[i] > median:
            bits |= 1 << (63 - i)
    return bits


def hashes(gray):
    """Impronta intera e dell'illustrazione da una matrice 64×64 di grigi (0..255), come CardHash.hashes."""
    g = np.asarray(gray, dtype=np.float64).reshape(SIZE, SIZE)
    full = (g[0::2, 0::2] + g[0::2, 1::2] + g[1::2, 0::2] + g[1::2, 1::2]) / 4.0
    a = g[ART_TOP:ART_TOP + N, :]
    art = (a[:, 0::2] + a[:, 1::2]) / 2.0
    return phash(full), phash(art)


def gray64(data):
    """La carta (immagine intera) in grigi 64×64, con media delle aree (come il telefono)."""
    im = Image.open(io.BytesIO(data)).convert('L')
    im = im.resize((SIZE, SIZE), Image.BOX)
    return list(im.getdata())


def hex16(h):
    return f'{h:016x}'


def get(url, retries=3):
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return r.read()
        except Exception:
            if i == retries - 1:
                return None
            time.sleep(2 * (i + 1))


def get_json(url):
    b = get(url)
    return json.loads(b) if b else None


def tcgdex_cards(lang):
    """[(id, nome, numero, percorso immagine)] di tutte le carte con immagine in [lang]."""
    out = []
    sets = get_json(f'{API}/{lang}/sets') or []
    for s in sets:
        d = get_json(f'{API}/{lang}/sets/{urllib.request.quote(s["id"], safe="")}')
        for c in (d or {}).get('cards', []):
            img = c.get('image')
            if not img:
                continue
            out.append((c['id'], c.get('name') or '', c.get('localId') or '', img.replace('https://assets.tcgdex.net/', '')))
    return out


def main(argv):
    out_path = argv[1]
    prev_path = onepiece_path = lorcana_path = dragonball_path = yugioh_path = None
    limit = None
    minutes = None
    i = 2
    while i < len(argv):
        if argv[i] == '--prima':
            prev_path = argv[i + 1]; i += 2
        elif argv[i] == '--onepiece':
            onepiece_path = argv[i + 1]; i += 2
        elif argv[i] == '--lorcana':
            lorcana_path = argv[i + 1]; i += 2
        elif argv[i] == '--dragonball':
            dragonball_path = argv[i + 1]; i += 2
        elif argv[i] == '--yugioh':
            yugioh_path = argv[i + 1]; i += 2
        elif argv[i] == '--max':
            limit = int(argv[i + 1]); i += 2
        elif argv[i] == '--minuti':
            minutes = float(argv[i + 1]); i += 2
        else:
            raise SystemExit(f'argomento sconosciuto: {argv[i]}')

    prev = {}
    if prev_path:
        try:
            for row in json.load(open(prev_path, encoding='utf-8')).get('cards', []):
                prev[row[0]] = row
        except Exception as e:
            print(f'impronte precedenti non lette ({e}): ricalcolo tutto')

    # Carte da fare: Pokémon inglesi, Pokémon giapponesi (set che TCGdex ha in giapponese), One Piece, Lorcana, Dragon Ball.
    todo = []  # (id, nome, numero, immagine, lingua, url)
    for cid, name, num, img in tcgdex_cards('en'):
        todo.append((cid, name, num, img, 'en', f'https://assets.tcgdex.net/{img}/low.webp'))
    seen = {t[0] for t in todo}
    for cid, name, num, img in tcgdex_cards('ja'):
        if cid not in seen:
            todo.append((cid, name, num, img, 'ja', f'https://assets.tcgdex.net/{img}/low.webp'))
    # One Piece, Lorcana e Dragon Ball: cataloghi del job (foto CardTrader), id "op:"/"lc:"/"db:" come nell'app.
    for path, prefix in ((onepiece_path, 'op'), (lorcana_path, 'lc'), (dragonball_path, 'db'), (yugioh_path, 'yg')):
        if not path:
            continue
        for c in json.load(open(path, encoding='utf-8')).get('cards', []):
            img = c.get('img')
            if img:
                todo.append((f'{prefix}:{c["id"]}', c.get('n') or '', c.get('num') or '', f'ct:{img}', 'en',
                             f'https://cardtrader.com{img}'))
    print(f'impronte: {len(todo)} carte nel catalogo, {sum(1 for t in todo if t[0] in prev)} già calcolate')

    rows = []
    new = [t for t in todo if t[0] not in prev]
    if limit is not None:
        new = new[:limit]
    done = failed = 0

    def work(t):
        data = get(t[5])
        if not data:
            return t, None
        try:
            return t, hashes(gray64(data))
        except Exception:
            return t, None

    # Tempo massimo (--minuti): a blocchi, e quando è finito si salva quello che c'è; le carte rimaste si fanno al giro dopo, che
    # riparte dalle impronte salvate (9 novembre 2026: con le 47.000 carte Yu-Gi-Oh! il calcolo superava le 2 ore della parte
    # "immagini", GitHub lo fermava prima del salvataggio e ogni lunedì sarebbe ripartito da capo).
    results = {}
    start = time.time()
    left = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        for b in range(0, len(new), 400):
            if minutes is not None and time.time() - start > minutes * 60:
                left = len(new) - b
                break
            for t, h in ex.map(work, new[b:b + 400]):
                if h:
                    results[t[0]] = h
                    done += 1
                else:
                    failed += 1
                if (done + failed) % 2000 == 0:
                    print(f'  {done + failed}/{len(new)}')
    for t in todo:
        if t[0] in prev:
            rows.append(prev[t[0]])
        elif t[0] in results:
            f, a = results[t[0]]
            rows.append([t[0], t[1], t[2], t[3], t[4], hex16(f), hex16(a)])
    out = {'v': 1, 'updated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'cards': rows}
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    rest = f', {left} rimandate al prossimo giro (tempo finito)' if left else ''
    print(f'Impronte: {len(rows)} carte ({done} nuove, {failed} immagini non lette{rest})')


if __name__ == '__main__':
    main(sys.argv)
