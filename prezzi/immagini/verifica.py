#!/usr/bin/env python3
"""
Controlla le immagini che non vengono da pokemontcg.io (TCGplayer, CardTrader): per ogni carta
tiene la prima fonte che si scarica davvero, altrimenti la toglie dall'elenco.
Uso: verifica.py <images.json>
"""
import json, sys, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor


def url_of(v):
    if v.startswith('tp:'):
        return f"https://tcgplayer-cdn.tcgplayer.com/product/{v[3:]}_200w.jpg"
    if v.startswith('u:'):
        return v[2:]
    return None  # pokemontcg.io / scrydex: affidabili, non serve controllarle


def ok(v):
    url = url_of(v)
    if url is None:
        return True
    req = urllib.request.Request(url, headers={'User-Agent': 'okhttp/4.12.0'})
    for _ in range(2):
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status == 200 and r.headers.get('Content-Type', '').startswith('image/')
        except urllib.error.HTTPError as e:
            if e.code in (403, 404, 410):
                return False
        except Exception:
            pass
    return True  # errore di rete: nel dubbio la teniamo


def main(path):
    data = json.load(open(path, encoding='utf-8'))
    alt = data.pop('alt', {})
    keys = [k for k, v in data['images'].items() if url_of(v) is not None]
    chains = {k: [data['images'][k]] + alt.get(k, []) for k in keys}

    def pick(k):
        for v in chains[k]:
            if ok(v):
                return v
        return None

    with ThreadPoolExecutor(max_workers=16) as ex:
        picked = dict(zip(keys, ex.map(pick, keys)))
    changed = removed = 0
    for k, v in picked.items():
        if v is None:
            del data['images'][k]
            removed += 1
        elif v != data['images'][k]:
            data['images'][k] = v
            changed += 1
    json.dump(data, open(path, 'w', encoding='utf-8'), separators=(',', ':'), sort_keys=True)
    print(f"Immagini TCGplayer/CardTrader controllate: {len(keys)}; passate alla fonte successiva: {changed}; "
          f"senza nessuna immagine valida: {removed}")
    gone = sorted(k for k, v in picked.items() if v is None)
    if gone:
        print('Tolte:', ', '.join(gone[:60]) + (' …' if len(gone) > 60 else ''))


if __name__ == '__main__':
    main(sys.argv[1])
