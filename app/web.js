// CollectorOne nel browser: le poche cose che l'app chiede al browser (salvataggio dei dati in IndexedDB,
// foto della carta, file CSV, download e condivisione). Chiamate dal codice Kotlin (wasmJsMain/web/Web.kt).
(function () {
  const DB = "collectorone", STORE = "files";
  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  const CARD_RATIO = 63 / 88;

  /**
   * Rettangolo della carta in una foto con lo sfondo uniforme: colore dello sfondo = mediana del bordo,
   * righe e colonne in cui più del 35% dei punti se ne discosta; null se non si trova una carta credibile.
   */
  function findCard(bmp) {
    const scale = Math.min(1, 256 / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const edge = [[], [], []];
    const take = (x, y) => { const i = (y * w + x) * 4; edge[0].push(d[i]); edge[1].push(d[i + 1]); edge[2].push(d[i + 2]); };
    for (let x = 0; x < w; x++) { take(x, 0); take(x, h - 1); }
    for (let y = 0; y < h; y++) { take(0, y); take(w - 1, y); }
    const med = edge.map((a) => a.sort((p, q) => p - q)[a.length >> 1]);
    const on = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const dr = d[i * 4] - med[0], dg = d[i * 4 + 1] - med[1], db = d[i * 4 + 2] - med[2];
      on[i] = dr * dr + dg * dg + db * db > 45 * 45 ? 1 : 0;
    }
    const rows = [], cols = [];
    for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) n += on[y * w + x]; rows.push(n / w); }
    for (let x = 0; x < w; x++) { let n = 0; for (let y = 0; y < h; y++) n += on[y * w + x]; cols.push(n / h); }
    const first = (a) => a.findIndex((v) => v > 0.35), last = (a) => a.length - 1 - [...a].reverse().findIndex((v) => v > 0.35);
    const y0 = first(rows), y1 = last(rows), x0 = first(cols), x1 = last(cols);
    if (y0 < 0 || x0 < 0 || y1 <= y0 || x1 <= x0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const ratio = bw / bh;
    // Una carta (dritta o un po' storta) occupa almeno un quinto della foto e ha più o meno le sue proporzioni.
    if (bw * bh < 0.2 * w * h || ratio < 0.55 || ratio > 0.95) return null;
    if (bw > 0.97 * w && bh > 0.97 * h) return null;
    return { x: x0 / scale, y: y0 / scale, w: bw / scale, h: bh / scale };
  }
  let loaded = [];

  function pickFile(accept, capture) {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      if (capture) input.setAttribute("capture", "environment");
      input.style.display = "none";
      let done = false;
      const finish = (v) => { if (!done) { done = true; input.remove(); resolve(v); } };
      input.addEventListener("change", () => finish(input.files && input.files[0] ? input.files[0] : null));
      input.addEventListener("cancel", () => finish(null));
      document.body.appendChild(input);
      input.click();
    });
  }

  window.CO = {
    // ---- file dell'app (IndexedDB): tutti caricati all'avvio, poi scritti in sottofondo
    loadAll: async function () {
      loaded = [];
      try {
        const d = await db();
        await new Promise((resolve) => {
          const tx = d.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).openCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (c) { loaded.push([String(c.key), c.value.t, c.value.m]); c.continue(); } else resolve();
          };
          req.onerror = () => resolve();
        });
      } catch (e) { console.warn("IndexedDB non disponibile", e); }
      return loaded.length;
    },
    loadedName: (i) => loaded[i][0],
    loadedText: (i) => loaded[i][1],
    loadedTime: (i) => loaded[i][2],
    clearLoaded: () => { loaded = []; },
    put: function (name, text, mtime) {
      db().then((d) => d.transaction(STORE, "readwrite").objectStore(STORE).put({ t: text, m: mtime }, name))
        .catch((e) => console.warn("salvataggio non riuscito", name, e));
    },

    // ---- foto della carta: ritaglio al centro con le proporzioni di una carta, JPEG e grigi 64x64
    pickCardPhoto: async function () {
      const file = await pickFile("image/*", true);
      if (!file) return null;
      return window.CO.cardPhoto(file);
    },
    cardPhoto: async function (file) {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
        // La carta dentro la foto (sfondo uniforme: tavolo, scanner), altrimenti la foto intera.
        const box = findCard(bmp) || { x: 0, y: 0, w: bmp.width, h: bmp.height };
        let cw = box.w, ch = box.h;
        if (cw / ch > CARD_RATIO) cw = Math.round(ch * CARD_RATIO); else ch = Math.round(cw / CARD_RATIO);
        const sx = Math.floor(box.x + (box.w - cw) / 2), sy = Math.floor(box.y + (box.h - ch) / 2);
        const scale = Math.min(1, 1024 / Math.max(cw, ch));
        const big = document.createElement("canvas");
        big.width = Math.round(cw * scale); big.height = Math.round(ch * scale);
        const bctx = big.getContext("2d");
        bctx.imageSmoothingQuality = "high";
        bctx.drawImage(bmp, sx, sy, cw, ch, 0, 0, big.width, big.height);
        const jpeg = big.toDataURL("image/jpeg", 0.85).split(",")[1];
        const small = document.createElement("canvas");
        small.width = 64; small.height = 64;
        const sctx = small.getContext("2d", { willReadFrequently: true });
        sctx.imageSmoothingQuality = "high";
        sctx.drawImage(big, 0, 0, 64, 64);
        const px = sctx.getImageData(0, 0, 64, 64).data;
        const gray = new Array(4096);
        for (let i = 0; i < 4096; i++) {
          gray[i] = Math.min(255, Math.max(0, Math.floor((299 * px[i * 4] + 587 * px[i * 4 + 1] + 114 * px[i * 4 + 2]) / 1000)));
        }
        bmp.close();
        return jpeg + "|" + gray.join(",");
      } catch (e) {
        console.warn("foto non letta", e);
        return "";
      }
    },

    // ---- file di testo (CSV di Collectr)
    pickTextFile: async function () {
      const file = await pickFile(".csv,.txt,text/csv,text/plain", false);
      if (!file) return null;
      try { return await file.text(); } catch (e) { return ""; }
    },

    // ---- download e condivisione
    download: function (fileName, mime, text) {
      const url = URL.createObjectURL(new Blob([text], { type: mime + ";charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
    share: function (text) {
      if (navigator.share) { navigator.share({ text }).catch(() => {}); return true; }
      if (navigator.clipboard) { navigator.clipboard.writeText(text).catch(() => {}); }
      return false;
    },

    // ---- indirizzo della pagina (per il ritorno dal login) e prove in locale
    pageUrl: () => location.origin + location.pathname,
    hostname: () => location.hostname,
    // Numero della pubblicazione (web.js?v=..., messo da pubblica-sito-e-job.sh): va anche negli indirizzi dei caratteri,
    // così una pubblicazione nuova non prende quelli vecchi dalla cache di Cloudflare (4 ore).
    buildId: () => {
      const s = document.querySelector('script[src*="web.js"]');
      return s ? (new URL(s.src, location.href).searchParams.get("v") || "") : "";
    },
  };
})();
