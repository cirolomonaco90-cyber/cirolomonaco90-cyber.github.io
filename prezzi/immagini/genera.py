#!/usr/bin/env python3
"""
Immagini di riserva per le carte che su TCGdex non hanno l'immagine.

Abbina ogni carta di TCGdex (dal repo tcgdex/cards-database) alla stessa carta del
dataset di pokemontcg.io (repo PokemonTCG/pokemon-tcg-data), che ha l'immagine di tutte
le carte inglesi, e scrive  {id carta TCGdex: "set/numero"}  ->  https://images.pokemontcg.io/<set>/<numero>.png

Uso: genera.py <cards-database/data> <pokemon-tcg-data> <uscita.json>
Solo libreria standard.
"""
import collections, json, os, re, sys

ACC = str.maketrans('àáâäãèéêëìíîïòóôöõùúûüñçé', 'aaaaaeeeeiiiiooooouuuunce')


def norm(s):
    s = s.lower().translate(ACC).replace('&', ' and ').replace('—', ' ')
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def num(s):
    f = s.lstrip('#').split('/')[0].strip().lower()
    m = re.match(r'^([a-z]*)0*(\d+)([a-z]*)$', f)
    return m.group(1) + m.group(2) + m.group(3) if m else f


def en_name(txt):
    m = re.search(r'name\s*:\s*\{(.*?)\}', txt, re.S)
    if not m:
        return None
    e = re.search(r'\ben\s*:\s*(["\'])(.*?)(?<!\\)\1', m.group(1), re.S)
    return e.group(2).replace("\\'", "'").replace('\\"', '"') if e else None


def tcgdex_sets(root):
    out = []
    for serie in sorted(os.listdir(root)):
        sd = os.path.join(root, serie)
        if not os.path.isdir(sd) or serie.startswith('Pokémon TCG Pocket'):
            continue
        for f in sorted(os.listdir(sd)):
            if not f.endswith('.ts'):
                continue
            txt = open(os.path.join(sd, f), encoding='utf-8').read()
            m = re.search(r'\bid\s*:\s*["\']([^"\']+)["\']', txt)
            if not m:
                continue
            cards = []
            cdir = os.path.join(sd, f[:-3])
            if os.path.isdir(cdir):
                for c in os.listdir(cdir):
                    if c.endswith('.ts'):
                        ct = open(os.path.join(cdir, c), encoding='utf-8').read()
                        tp = re.search(r'tcgplayer\s*:\s*(\d+)', ct)
                        cm = re.search(r'cardmarket\s*:\s*(\d+)', ct)
                        ill = re.search(r'illustrator\s*:\s*(["\'])(.*?)(?<!\\)\1', ct)
                        cards.append({'localId': c[:-3], 'name': en_name(ct), 'tcgplayer': tp.group(1) if tp else None,
                                      'cardmarket': cm.group(1) if cm else None,
                                      'illustrator': ill.group(2) if ill else None})
            rd = re.search(r'releaseDate\s*:\s*["\'](\d{4}-\d{2}-\d{2})', txt)
            out.append({'id': m.group(1), 'name': en_name(txt) or '', 'cards': cards, 'date': rd.group(1) if rd else ''})
    return out


# id TCGdex -> id pokemontcg.io quando la regola automatica non basta
SET_ALIASES = {
    'hgssp': 'hsp', 'bog': 'bp', 'lc': 'base6', 'sm3.5': 'sm35', 'sm7.5': 'sm75',
    'swsh3.5': 'swsh35', 'swsh4.5': 'swsh45', 'swsh4.5sv': 'swsh45sv', 'cel25cc': 'cel25c',
    'swsh10.5': 'pgo', 'fut2020': 'fut20', 'sv10.5b': 'zsv10pt5', 'sv10.5w': 'rsv10pt5',
    '30th': 'me55', '30th-c': 'me55c', 'tk-ex-latia': 'tk1a', 'tk-ex-latio': 'tk1b',
    'tk-ex-p': 'tk2a', 'tk-ex-m': 'tk2b', 'mep': 'mep',
    '2011bw': 'mcd11', '2012bw': 'mcd12', '2014xy': 'mcd14', '2015xy': 'mcd15', '2016xy': 'mcd16',
    '2017sm': 'mcd17', '2018sm': 'mcd18', '2019sm': 'mcd19', '2021swsh': 'mcd21', '2022swsh': 'mcd22',
}


def auto_id(tid):
    # sv03.5 -> sv3pt5, me01 -> me1, swsh12.5gg -> swsh12pt5gg
    m = re.match(r'^([a-z]+)0*(\d+)(?:\.(\d))?([a-z]*)$', tid)
    if not m:
        return tid
    return m.group(1) + m.group(2) + ('pt' + m.group(3) if m.group(3) else '') + m.group(4)


def main(tcg_root, ptcg_root, out_path, ct_path=None):
    ctimg = json.load(open(ct_path, encoding='utf-8')) if ct_path and os.path.exists(ct_path) else {'cm': {}, 'tp': {}}
    psets = json.load(open(os.path.join(ptcg_root, 'sets', 'en.json'), encoding='utf-8'))
    pby_id = {s['id']: s for s in psets}
    pby_name = {}
    for s in psets:
        pby_name.setdefault(norm(s['name']), s)
    pcards = {}

    def image_value(p):
        img = p.get('images', {}).get('small', '')
        m = re.match(r'^https://images\.pokemontcg\.io/(.+)\.png$', img)
        x = re.match(r'^https://images\.scrydex\.com/pokemon/([^/]+)/small$', img)
        return m.group(1) if m else ('sx:' + x.group(1) if x else None)

    # Stessa illustrazione: stesso nome e stesso illustratore (le ristampe dei trainer kit
    # e di molti promo riusano il disegno di una carta normale).
    by_art = {}
    energies = {}  # nome -> [(data di uscita, immagine)]: le energie base non hanno illustratore
    for ps_ in psets:
        path = os.path.join(ptcg_root, 'cards', 'en', ps_['id'] + '.json')
        if not os.path.exists(path):
            continue
        for p in json.load(open(path, encoding='utf-8')):
            v = image_value(p)
            if v and p.get('artist'):
                by_art.setdefault((norm(p['name']), norm(p['artist'])), v)
            if v and p.get('supertype') == 'Energy' and 'Basic' in (p.get('subtypes') or []):
                energies.setdefault(norm(p['name']), []).append((ps_.get('releaseDate', '').replace('/', '-'), v))

    def energy_image(name, date):
        # Energia base: la stessa energia del set uscito più vicino nel tempo (disegno dell'epoca).
        opts = energies.get(name)
        if not opts or not date:
            return opts[0][1] if opts else None
        y = int(date[:4]) * 12 + int(date[5:7])
        return min(opts, key=lambda o: abs(int(o[0][:4]) * 12 + int(o[0][5:7]) - y) if len(o[0]) >= 7 else 9999)[1]


    def cards_of(pid):
        if pid not in pcards:
            path = os.path.join(ptcg_root, 'cards', 'en', pid + '.json')
            pcards[pid] = json.load(open(path, encoding='utf-8')) if os.path.exists(path) else []
        return pcards[pid]

    all_ids = []
    images, alt, stats, unmatched_sets = {}, {}, {'carte': 0, 'abbinate': 0, 'tcgplayer': 0, 'cardtrader': 0, 'illustrazione': 0}, []
    for t in tcgdex_sets(tcg_root):
        ps = pby_id.get(SET_ALIASES.get(t['id'], '')) or pby_id.get(t['id']) or pby_id.get(auto_id(t['id'])) \
            or pby_name.get(norm(t['name']))
        stats['carte'] += len(t['cards'])
        if not ps:
            if t['cards']:
                unmatched_sets.append(f"{t['id']} ({t['name']}, {len(t['cards'])})")
            ps = {'id': None}
        pc = cards_of(ps['id']) if ps['id'] else []
        by_num = {}
        for c in pc:
            by_num.setdefault(num(c['number']), []).append(c)
        # Carte con lo stesso nome nel set, in ordine di numero (es. le due metà di una LEGEND)
        def by_number(items, key):
            return sorted(items, key=lambda x: (len(num(key(x))), num(key(x))))
        t_same = {}
        for c in by_number(t['cards'], lambda c: c['localId']):
            t_same.setdefault(norm(c['name'] or ''), []).append(c['localId'])
        for c in t['cards']:
            all_ids.append(f"{t['id']}-{c['localId']}")
            cands = by_num.get(num(c['localId']), [])
            name = norm(c['name'] or '')
            # Il numero deve coincidere; il nome conferma (se ci sono più candidati o il nome è diverso)
            good = [p for p in cands if not name or norm(p['name']) == name or name in norm(p['name']) or norm(p['name']) in name]
            if not good and name:
                # Ristampe con numerazione diversa (es. Classic Collection): stesso nome nel set.
                same = by_number([p for p in pc if norm(p['name']) == name], lambda p: p['number'])
                mine = t_same.get(name, [])
                if len(same) == 1:
                    good = same
                elif len(same) > 1 and len(same) == len(mine):
                    good = [same[mine.index(c['localId'])]]  # stesse carte, stesso ordine
                else:
                    # "Palkia" su TCGdex, "Palkia LV.X" su pokemontcg.io: un solo nome che lo contiene
                    near = [p for p in pc if re.search(r'\b' + re.escape(name) + r'\b', norm(p['name']))]
                    good = near if len(near) == 1 else []
            if good:
                img = good[0].get('images', {}).get('small', '')
                # Due archivi di immagini: pokemontcg.io ("set/numero") e, per i set più recenti,
                # scrydex ("sx:" + id della carta).
                m = re.match(r'^https://images\.pokemontcg\.io/(.+)\.png$', img)
                x = re.match(r'^https://images\.scrydex\.com/pokemon/([^/]+)/small$', img)
                if m or x:
                    images[f"{t['id']}-{c['localId']}"] = m.group(1) if m else 'sx:' + x.group(1)
                    stats['abbinate'] += 1
                    continue
            # Non c'è su pokemontcg.io (McDonald's recenti, trainer kit, promo...): immagine del
            # prodotto TCGplayer, il cui id è già nel database di TCGdex; in alternativa la stessa
            # illustrazione su un'altra carta (verifica.py la usa se la foto TCGplayer non esiste).
            # Fonti in ordine: TCGplayer, foto CardTrader, stessa illustrazione su un'altra carta.
            # verifica.py tiene la prima che si scarica davvero.
            key = f"{t['id']}-{c['localId']}"
            art = by_art.get((name, norm(c['illustrator'] or ''))) if name and c.get('illustrator') else None
            if not art and name.endswith(' energy'):
                art = energy_image(name, t['date'])
            ctu = ctimg['cm'].get(c.get('cardmarket') or '') or ctimg['tp'].get(c.get('tcgplayer') or '')
            cands = ([f"tp:{c['tcgplayer']}"] if c.get('tcgplayer') else []) + ([f"u:{ctu}"] if ctu else []) + ([art] if art else [])
            if cands:
                images[key] = cands[0]
                if len(cands) > 1:
                    alt[key] = cands[1:]
                kind = 'tcgplayer' if cands[0].startswith('tp:') else 'cardtrader' if cands[0].startswith('u:') else 'illustrazione'
                stats[kind] += 1
    # Set solo giapponesi (non sono nel cartella "data" di TCGdex): foto CardTrader per numero.
    # Gli id delle carte su TCGdex sono a tre cifre ("web1-042").
    for set_id, by_n in ctimg.get('sets', {}).items():
        for n, url in by_n.items():
            images.setdefault(f"{set_id}-{int(n):03d}", f"u:{url}")
            stats['cardtrader'] += 1
    json.dump({'v': 1, 'base': 'https://images.pokemontcg.io/', 'images': images, 'alt': alt},
              open(out_path, 'w', encoding='utf-8'), separators=(',', ':'), sort_keys=True)
    total = stats['abbinate'] + stats['tcgplayer'] + stats['cardtrader'] + stats['illustrazione']
    print(f"Immagini di riserva: {total} carte su {stats['carte']} (pokemontcg.io {stats['abbinate']}, "
          f"TCGplayer {stats['tcgplayer']}, CardTrader {stats['cardtrader']}, stessa illustrazione {stats['illustrazione']}; "
          f"con alternative {len(alt)})")
    missing = collections.Counter(k.rsplit('-', 1)[0] for k in all_ids if k not in images)
    print('Ancora senza immagine di riserva:', ', '.join(f'{k} ({v})' for k, v in missing.most_common()) or 'nessuna')
    print('Set senza corrispondenza:', ', '.join(unmatched_sets) or 'nessuno')


if __name__ == '__main__':
    main(*sys.argv[1:5])
