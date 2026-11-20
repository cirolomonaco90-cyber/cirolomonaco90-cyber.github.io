#!/usr/bin/env python3
"""
Foto dei "set di rarità" di Lorcana (Cardmarket: "Hyperia City: Enchanted Set", "The First Chapter: Legendary Set"...): sono
serie di carte singole, non confezioni, e nessun negozio ha una foto del prodotto. Al loro posto tre carte di quella rarità del
set (le più care), a ventaglio, così si capisce che è una serie di carte. 0.9.160, richiesto dall'utente il 7 novembre 2026:
"tutti i prodotti devono avere un'immagine", eBay solo per ultimo.

Le foto delle carte sono quelle di TCGplayer (CardTrader blocca il Mac); serve Pillow.

Regole (7 novembre 2026, dopo il controllo delle foto Lorcana):
- solo le carte normali del set: fuori le stampe speciali che CardTrader mette con la stessa rarità ("Starter Deck Exclusive
  Foil" 156s di Whispers in the Well, "Reprint | Fixed text" di The First Chapter, Half Hexwell Crown 223/204 di Illumineer's
  Quest tra le rare di Shimmering Skies): campo "v" vuoto o uguale alla rarità ("Enchanted");
- "Full Set" (tutte le carte del set, 1-204): la carta più cara fra Legendary, Super Rare e Rare ("full" non è una rarità);
- si rifanno anche i prodotti con la foto di un'inserzione eBay (mucchi di carte, retro delle carte, una carta sola) e quelli
  con una foto di questo script, così rifacendolo valgono le regole nuove per tutti.

Uso: python3 prezzi/immagini/set-rarita.py <lorcana-sealed.json> <lorcana.json> <cartella di uscita> <mappa.json>
Scrive un WebP per prodotto (trasparente, ~40 KB) nella cartella e in <mappa.json> {"lorcana-sealed:<id>": "<file>"}; i file si caricano poi nello
spazio file (immagini/sealed/lorcana-set/) e gli indirizzi vanno in prezzi/dati/foto-sealed-lorcana.json.
"""
import io
import json
import re
import sys
import urllib.request

from PIL import Image, ImageFilter

SIZE = 640
CARD_W, CARD_H = 300, 419


def card_image(tp_id):
    url = f"https://tcgplayer-cdn.tcgplayer.com/product/{tp_id}_400w.jpg"
    req = urllib.request.Request(url, headers={"User-Agent": "CollectorOne/1.0 (https://collectorone.app)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        img = Image.open(io.BytesIO(r.read())).convert("RGBA")
    return img.resize((CARD_W, CARD_H), Image.LANCZOS)


def rounded(img, radius=14):
    mask = Image.new("L", img.size, 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius, fill=255)
    out = img.copy()
    out.putalpha(mask)
    return out


def fan(cards):
    """Le carte a ventaglio su sfondo trasparente: la più cara al centro, davanti."""
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    n = len(cards)
    angles = {1: [0], 2: [-8, 8], 3: [-14, 14, 0]}[n]
    shifts = {1: [0], 2: [-70, 70], 3: [-115, 115, 0]}[n]
    order = list(range(n))
    if n == 3:
        order = [1, 2, 0]  # le due laterali prima, la prima (la più cara) davanti al centro
    for slot, i in enumerate(order):
        card = rounded(cards[i])
        rot = card.rotate(-angles[slot], resample=Image.BICUBIC, expand=True)
        shadow = Image.new("RGBA", rot.size, (0, 0, 0, 0))
        shadow.putalpha(rot.getchannel("A").point(lambda a: int(a * 0.35)))
        shadow = shadow.filter(ImageFilter.GaussianBlur(8))
        x = (SIZE - rot.size[0]) // 2 + shifts[slot]
        y = (SIZE - rot.size[1]) // 2 + (10 if n == 3 and slot < 2 else 0)
        canvas.alpha_composite(shadow, (x + 4, y + 8))
        canvas.alpha_composite(rot, (x, y))
    return canvas


FULL_SET = ["legendary", "super rare", "rare"]


def by_price(cards, rarity):
    """Carte normali della rarità con la foto TCGplayer, dalla più cara (prezzo inglese CardTrader)."""
    out = [c for c in cards if str(c.get("r") or "").lower() == rarity and c.get("tp")
           and (c.get("v") is None or str(c["v"]).lower() == rarity)]
    return sorted(out, key=lambda c: -((c.get("en") or [0])[0] or 0))


def pick_cards(cards, rarity):
    """Le tre carte della foto: le più care della rarità, o per il Full Set la più cara di ogni rarità alta."""
    if rarity == "full":
        return [best[0] for best in (by_price(cards, r) for r in FULL_SET) if best]
    return by_price(cards, rarity)[:3]


def to_redo(img):
    """Prodotto da fare: senza foto, con la foto di un'inserzione eBay o con una foto di questo script."""
    return not img or str(img).startswith("https://i.ebayimg.com/") or "/immagini/sealed/lorcana-set/" in str(img)


def main():
    sealed_file, cards_file, out_dir, map_file = sys.argv[1:5]
    sealed = json.load(open(sealed_file))
    catalog = json.load(open(cards_file))
    sets = {s["name"].lower(): s["id"] for s in catalog["sets"]}
    by_set = {}
    for c in catalog["cards"]:
        by_set.setdefault(c.get("s"), []).append(c)
    out = {}
    for p in sealed["p"]:
        if not to_redo(p.get("img")):
            continue
        m = re.match(r"^(.*):\s*([\w ]+?) Set$", p["n"])
        if not m:
            continue
        set_name, rarity = m.group(1).strip().lower(), m.group(2).strip().lower()
        sid = sets.get(set_name)
        if sid is None:
            print(f"set non trovato: {p['n']}")
            continue
        cards = pick_cards(by_set.get(sid, []), rarity)
        if not cards:
            print(f"nessuna carta {rarity} con foto in {set_name}: {p['n']}")
            continue
        try:
            images = [card_image(c["tp"][0]) for c in cards[:3]]
        except Exception as e:  # rete: si salta il prodotto, si riprova un'altra volta
            print(f"foto non scaricate per {p['n']}: {e}")
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", p["n"].lower()).strip("-")
        name = f"{slug}.webp"
        fan(images).save(f"{out_dir}/{name}", "WEBP", quality=82, method=6)
        out[f"lorcana-sealed:{p['id']}"] = name
        print(f"{p['n']}: {', '.join(c['n'] for c in cards[:3])}")
    json.dump(out, open(map_file, "w"), indent=1)
    print(f"Set di rarità: {len(out)} foto")


if __name__ == "__main__":
    main()
