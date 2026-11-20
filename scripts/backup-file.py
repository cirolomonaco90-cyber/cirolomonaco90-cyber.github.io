#!/usr/bin/env python3
"""
Copia di sicurezza dei file di Cloudflare R2 che non si possono rifare (19 novembre 2026, richiesta dall'utente dopo lo
spostamento su R2: "si, fallo ... perché settimanale? non possiamo farla giornaliera?"). Ogni notte, nel workflow "Backup
del database", dopo il backup del database.

Dallo spazio pubblico (bucket collectorone-dati, https://dati.collectorone.app) allo spazio privato dei backup (bucket
collectorone-backup):
  - lo storico dei prezzi e i file che si accumulano notte dopo notte (CARTELLE_STORICO, FILE_STORICO) in una copia per
    giorno, file/<giorno>/<percorso>: restano gli ultimi GIORNI (3) giorni (scelto dall'utente: due-tre giorni per
    accorgersi di un errore che non si vede subito; ogni copia è tutto lo storico, circa 160 MB);
  - foto e loghi (CARTELLE_FOTO) in file/foto/<percorso>, una copia sola che si aggiorna: si carica solo una foto nuova o
    cambiata, e una foto tolta da collectorone-dati resta qui (protegge dalle cancellazioni sbagliate).
Protegge dagli errori nostri (il job che sovrascrive o cancella file); R2 non tiene le versioni precedenti. Non protegge da
una chiusura dell'account Cloudflare.

Chiavi (mai stampate): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY (solo per l'elenco di collectorone-dati),
R2_BACKUP_ACCESS_KEY_ID/R2_BACKUP_SECRET_ACCESS_KEY (scrittura nei backup). Dall'ambiente (GitHub) o dai file
~/CollectorOne-chiave/r2-keys.txt e backup-keys.txt (Mac). I file si scaricano dall'indirizzo pubblico.
Per riprendere un file: dal pannello di Cloudflare (R2 -> collectorone-backup -> file/...).
  python3 scripts/backup-file.py [--prova]
"""
import concurrent.futures as cf
import datetime
import hashlib
import hmac
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from xml.sax.saxutils import unescape

PUBBLICO = "https://dati.collectorone.app"
BUCKET_DATI = "collectorone-dati"
BUCKET_BACKUP = "collectorone-backup"
CARTELLE_STORICO = ["storico/"]
FILE_STORICO = ["prezzi/v1/ebay.json", "prezzi/foto-ebay.json", "carte/v1/asia-ufficiale.json"]
CARTELLE_FOTO = ["loghi/", "immagini/sealed/", "immagini/asia/", "immagini/oggetti/"]
GIORNI = 3
PARALLELI = 8


def chiavi():
    env = dict(os.environ)
    for nome in ("r2-keys.txt", "backup-keys.txt"):
        f = pathlib.Path.home() / "CollectorOne-chiave" / nome
        if f.exists():
            for riga in f.read_text().splitlines():
                k, _, v = riga.partition("=")
                if v and not env.get(k.strip()):
                    env[k.strip()] = v.strip().strip('"')
    servono = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BACKUP_ACCESS_KEY_ID", "R2_BACKUP_SECRET_ACCESS_KEY"]
    manca = [k for k in servono if not env.get(k)]
    if manca:
        sys.exit("copia dei file: mancano le chiavi " + ", ".join(manca))
    return env


class R2:
    """Le poche chiamate S3 che servono (elenco, scrittura, cancellazione), firmate con AWS Signature V4."""

    def __init__(self, account, key_id, secret, bucket):
        self.host = f"{account}.r2.cloudflarestorage.com"
        self.key_id, self.secret, self.bucket = key_id, secret, bucket

    def _sign(self, method, path, query, payload_hash):
        now = datetime.datetime.now(datetime.timezone.utc)
        amz = now.strftime("%Y%m%dT%H%M%SZ")
        day = now.strftime("%Y%m%d")
        canon_query = "&".join(f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
                               for k, v in sorted(query.items()))
        headers = {"host": self.host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz}
        signed = ";".join(sorted(headers))
        canon = "\n".join([method, urllib.parse.quote(path, safe="/-_.~"), canon_query,
                           "".join(f"{k}:{headers[k]}\n" for k in sorted(headers)), signed, payload_hash])
        scope = f"{day}/auto/s3/aws4_request"
        to_sign = "\n".join(["AWS4-HMAC-SHA256", amz, scope, hashlib.sha256(canon.encode()).hexdigest()])
        k = ("AWS4" + self.secret).encode()
        for part in (day, "auto", "s3", "aws4_request"):
            k = hmac.new(k, part.encode(), hashlib.sha256).digest()
        sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
        headers["Authorization"] = (f"AWS4-HMAC-SHA256 Credential={self.key_id}/{scope}, "
                                    f"SignedHeaders={signed}, Signature={sig}")
        del headers["host"]
        return headers, canon_query

    def call(self, method, key="", query=None, data=b"", extra=None):
        path = f"/{self.bucket}/{key}" if key else f"/{self.bucket}"
        url_path = urllib.parse.quote(path, safe="/-_.~")
        for n in range(4):
            headers, q = self._sign(method, path, query or {}, hashlib.sha256(data).hexdigest())
            headers.update(extra or {})
            url = f"https://{self.host}{url_path}" + (f"?{q}" if q else "")
            try:
                req = urllib.request.Request(url, data=data if method == "PUT" else None, method=method, headers=headers)
                with urllib.request.urlopen(req, timeout=120) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                if e.code < 500 and e.code != 429:
                    raise
            except Exception:
                pass
            time.sleep(5 * (n + 1))
        raise RuntimeError(f"{method} {key}: non riuscito")

    def elenco(self, prefix):
        """{percorso: etag} di tutti i file sotto prefix."""
        out, token = {}, None
        while True:
            q = {"list-type": "2", "prefix": prefix}
            if token:
                q["continuation-token"] = token
            xml = self.call("GET", query=q).decode()
            for c in re.findall(r"<Contents>(.*?)</Contents>", xml, re.S):
                k = re.search(r"<Key>(.*?)</Key>", c, re.S).group(1)
                e = re.search(r"<ETag>(.*?)</ETag>", c, re.S).group(1)
                out[unescape(k)] = unescape(e, {"&quot;": '"'}).strip('"')
            m = re.search(r"<NextContinuationToken>(.*?)</NextContinuationToken>", xml)
            if not m:
                return out
            token = unescape(m.group(1))


def scarica(path):
    req = urllib.request.Request(f"{PUBBLICO}/{urllib.parse.quote(path)}", headers={"User-Agent": "CollectorOne-backup"})
    for n in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception:
            time.sleep(5 * (n + 1))
    raise RuntimeError(f"scaricamento di {path} non riuscito")


def main():
    prova = "--prova" in sys.argv
    env = chiavi()
    dati = R2(env["R2_ACCOUNT_ID"], env["R2_ACCESS_KEY_ID"], env["R2_SECRET_ACCESS_KEY"], BUCKET_DATI)
    backup = R2(env["R2_ACCOUNT_ID"], env["R2_BACKUP_ACCESS_KEY_ID"], env["R2_BACKUP_SECRET_ACCESS_KEY"], BUCKET_BACKUP)
    oggi = datetime.datetime.now(datetime.timezone.utc).date()
    errori = []

    def copia(path, dest):
        try:
            corpo = scarica(path)
            if not prova:
                backup.call("PUT", dest, data=corpo, extra={"Content-Type": "application/octet-stream"})
            return len(corpo)
        except Exception as e:
            errori.append(f"{path}: {str(e)[:80]}")
            return 0

    # 1. Storico: copia del giorno.
    storico = {}
    for p in CARTELLE_STORICO:
        storico.update(dati.elenco(p))
    for f in FILE_STORICO:
        storico.update({k: v for k, v in dati.elenco(f).items() if k == f})
    if len(storico) < 100:
        sys.exit(f"copia dei file: elenco dello storico troppo corto ({len(storico)} file), niente copia")
    with cf.ThreadPoolExecutor(PARALLELI) as ex:
        byte = sum(ex.map(lambda p: copia(p, f"file/{oggi}/{p}"), sorted(storico)))
    print(f"storico: {len(storico)} file, {byte // 1_000_000} MB nella copia del {oggi}")

    # 2. Foto e loghi: solo quelli nuovi o cambiati (stesso md5 = già copiato).
    foto, gia = {}, {}
    for p in CARTELLE_FOTO:
        foto.update(dati.elenco(p))
        gia.update({k[len("file/foto/"):]: v for k, v in backup.elenco("file/foto/" + p).items()})
    nuove = sorted(p for p, e in foto.items() if gia.get(p) != e)
    with cf.ThreadPoolExecutor(PARALLELI) as ex:
        byte = sum(ex.map(lambda p: copia(p, f"file/foto/{p}"), nuove))
    print(f"foto e loghi: {len(foto)} su R2, {len(nuove)} copiati ({byte // 1_000_000} MB)")

    # 3. Copie dello storico più vecchie: restano gli ultimi GIORNI giorni.
    tieni = {oggi - datetime.timedelta(days=i) for i in range(GIORNI)}
    giorni = set()
    for k in backup.elenco("file/2"):
        m = re.match(r"file/(\d{4}-\d{2}-\d{2})/", k)
        if m:
            giorni.add(m.group(1))
    vecchi = sorted(g for g in giorni if datetime.date.fromisoformat(g) not in tieni)
    tolti = 0
    for g in vecchi:
        for k in backup.elenco(f"file/{g}/"):
            if not prova:
                try:
                    backup.call("DELETE", k)
                    tolti += 1
                except Exception as e:
                    errori.append(f"{k}: {str(e)[:80]}")
    print(f"copie dello storico: {len(giorni - set(vecchi))} giorni tenuti, {len(vecchi)} tolti ({tolti} file)")
    if errori:
        print(f"errori: {len(errori)} (primi: {'; '.join(errori[:3])})")
        sys.exit(1)
    print("copia dei file fatta" + (" (prova: nulla caricato)" if prova else ""))


main()
