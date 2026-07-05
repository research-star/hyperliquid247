/* Mercado 24/7 — dashboard de precios en vivo sobre la API de Hyperliquid. */
(function () {
  "use strict";

  const { fetchAllAssets, fetchCandles, createLiveFeed } = window.HL_API;
  const { classify, displayName } = window.HL_NAMES;
  const CHART = window.HL_CHART;

  const CANDLE_INTERVAL = "30m";
  const CANDLE_MS = 30 * 60 * 1000;
  const CANDLE_LOOKBACK = 24 * 60 * 60 * 1000;
  const MAX_CANDLES = 48;
  const CTX_REFRESH_MS = 30000;
  const CANDLE_TTL_MS = 2 * 60 * 1000;
  const LS = { favs: "hl247.favs", tab: "hl247.tab", sort: "hl247.sort" };

  /* ---------- estado ---------- */
  const assets = new Map();      // key → asset
  const symbolIndex = new Map(); // symbol → [keys]
  const cardEls = new Map();     // key → elemento .card
  const visibleKeys = new Set();
  let favs = new Set(JSON.parse(localStorage.getItem(LS.favs) || "[]"));
  let tab = localStorage.getItem(LS.tab) || "fav";
  let sortMode = localStorage.getItem(LS.sort) || "volume";
  let search = "";
  let lastUpdate = 0;
  let feedStatus = "offline";
  let loaded = false;
  let feed = null;

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const tooltip = $("chart-tooltip");
  const els = {
    tabs: $("tabs"), search: $("search"), sortGroup: $("sort-group"),
    summary: $("summary"), summaryText: $("summary-text"),
    meterUp: $("meter-up"), meterDown: $("meter-down"),
    errorBanner: $("error-banner"), errorText: $("error-text"), retry: $("retry-btn"),
    empty: $("empty-state"), updated: $("updated-label"), liveDot: $("live-dot"),
    nyse: $("nyse-state"), nysePill: $("pill-nyse"),
  };

  /* ---------- formato (es-AR: miles con punto, decimales con coma) ---------- */
  const fmtCache = new Map();
  function fmtPrice(v) {
    if (!Number.isFinite(v)) return "—";
    const dec = v >= 1000 ? 2 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6;
    let f = fmtCache.get(dec);
    if (!f) {
      f = new Intl.NumberFormat("es-AR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
      fmtCache.set(dec, f);
    }
    return "US$ " + f.format(v);
  }
  function fmtPct(v) {
    if (!Number.isFinite(v)) return "—";
    const s = v.toFixed(2).replace(".", ",");
    return (v > 0 ? "+" : "") + s + "%";
  }
  function fmtVol(v) {
    if (!Number.isFinite(v) || v <= 0) return "—";
    if (v >= 1e9) return "US$ " + (v / 1e9).toFixed(1).replace(".", ",") + " B";
    if (v >= 1e6) return "US$ " + Math.round(v / 1e6) + " M";
    if (v >= 1e3) return "US$ " + Math.round(v / 1e3) + " K";
    return "US$ " + Math.round(v);
  }

  function chgPct(a) {
    if (!Number.isFinite(a.prevDayPx) || a.prevDayPx <= 0) return NaN;
    return (a.price - a.prevDayPx) / a.prevDayPx * 100;
  }

  /* ---------- carga de universo ---------- */
  async function loadUniverse() {
    const { dexs, assets: rows } = await fetchAllAssets();
    for (const row of rows) {
      const prev = assets.get(row.key);
      if (prev) {
        prev.prevDayPx = row.prevDayPx;
        prev.volume24h = row.volume24h;
        prev.markPx = row.markPx;
        // el WS pisa el precio enseguida; si no está vivo, usar el del snapshot
        if (!feed || !feed.isLive()) prev.price = row.price;
      } else {
        row.category = classify(row.symbol, row.dex);
        row.name = row.dex ? displayName(row.symbol) : displayName(row.symbol);
        row.candles = [];
        row.candlesAt = 0;
        assets.set(row.key, row);
        if (!symbolIndex.has(row.symbol)) symbolIndex.set(row.symbol, []);
        symbolIndex.get(row.symbol).push(row.key);
      }
    }
    lastUpdate = Date.now();
    if (feed) feed.setDexs(dexs.map((d) => d.name));
    return dexs;
  }

  /* ---------- mids en vivo ---------- */
  const dirty = new Set();
  let rafPending = false;

  function resolveKey(k, dex) {
    if (assets.has(k)) return k;
    if (dex && assets.has(`${dex}:${k}`)) return `${dex}:${k}`;
    const cands = symbolIndex.get(k);
    return cands && cands.length === 1 ? cands[0] : null;
  }

  function onMids(mids, dex) {
    const now = Date.now();
    for (const k in mids) {
      if (k.startsWith("@")) continue; // pares spot, no los mostramos
      const key = resolveKey(k, dex);
      if (!key) continue;
      const px = parseFloat(mids[k]);
      if (!Number.isFinite(px)) continue;
      const a = assets.get(key);
      if (px === a.price) continue;
      a.lastDir = px > a.price ? 1 : -1;
      a.price = px;
      updateLastCandle(a, px, now);
      dirty.add(key);
    }
    lastUpdate = now;
    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(flushDirty);
    }
  }

  function flushDirty() {
    rafPending = false;
    for (const key of dirty) {
      const el = cardEls.get(key);
      if (el) updateCardData(el, assets.get(key), true);
    }
    dirty.clear();
    updateSummary();
  }

  function updateLastCandle(a, px, now) {
    if (!a.candles.length) return;
    const last = a.candles[a.candles.length - 1];
    if (now < last.t + CANDLE_MS) {
      last.c = px;
      if (px > last.h) last.h = px;
      if (px < last.l) last.l = px;
    } else {
      const t = last.t + Math.floor((now - last.t) / CANDLE_MS) * CANDLE_MS;
      a.candles.push({ t, o: px, h: px, l: px, c: px, v: 0 });
      while (a.candles.length > MAX_CANDLES) a.candles.shift();
    }
  }

  /* ---------- velas (carga perezosa, solo tarjetas visibles) ---------- */
  const candleQueue = [];
  const queued = new Set();
  let inflight = 0;
  const CANDLE_CONCURRENCY = 5;

  function requestCandles(key, force) {
    const a = assets.get(key);
    if (!a || queued.has(key)) return;
    if (!force && Date.now() - a.candlesAt < CANDLE_TTL_MS) return;
    queued.add(key);
    candleQueue.push(key);
    pumpCandles();
  }

  function pumpCandles() {
    while (inflight < CANDLE_CONCURRENCY && candleQueue.length) {
      const key = candleQueue.shift();
      inflight++;
      const a = assets.get(key);
      fetchCandles(a, CANDLE_INTERVAL, CANDLE_LOOKBACK)
        .then((rows) => {
          a.candles = rows.slice(-MAX_CANDLES);
          a.candlesAt = Date.now();
          const el = cardEls.get(key);
          if (el) drawCard(el, a);
        })
        .catch((err) => console.warn("velas", key, err))
        .finally(() => {
          inflight--;
          queued.delete(key);
          pumpCandles();
        });
    }
  }

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const key = e.target.dataset.key;
      if (e.isIntersecting) {
        visibleKeys.add(key);
        requestCandles(key, false);
      } else {
        visibleKeys.delete(key);
      }
    }
  }, { rootMargin: "200px" });

  /* ---------- tarjetas ---------- */
  function buildCard(a) {
    const el = document.createElement("article");
    el.className = "card";
    el.dataset.key = a.key;
    el.innerHTML =
      '<div class="card-top">' +
        '<div class="card-left">' +
          `<button class="star-btn" aria-label="Favorito" title="Agregar a favoritos">★</button>` +
          `<span class="sym"></span>` +
        "</div>" +
        '<span class="price"></span>' +
      "</div>" +
      '<div class="card-sub"><span class="asset-name"></span><span class="chg"></span></div>' +
      '<div class="chart-wrap"><canvas></canvas><div class="chart-loading">cargando…</div></div>' +
      '<div class="card-foot"><span class="vol"></span><span class="dexname"></span></div>';

    el.querySelector(".sym").textContent = a.symbol;
    el.querySelector(".asset-name").textContent = a.name;
    el.querySelector(".asset-name").title = a.dexName ? `${a.name} · dex ${a.dexName}` : a.name;
    el.querySelector(".dexname").textContent = a.dex ? a.dexName : "Perp";

    const starBtn = el.querySelector(".star-btn");
    starBtn.addEventListener("click", () => toggleFav(a.key));

    const canvas = el.querySelector("canvas");
    CHART.attachHover(canvas, tooltip, () => ({
      candles: a.candles, prevDayPx: a.prevDayPx, fmtPrice,
    }));

    updateCardData(el, a, false);
    return el;
  }

  function updateCardData(el, a, flash) {
    const priceEl = el.querySelector(".price");
    const prevText = priceEl.textContent;
    const nextText = fmtPrice(a.price);
    priceEl.textContent = nextText;

    if (flash && prevText !== nextText) {
      priceEl.classList.remove("flash-up", "flash-down");
      void priceEl.offsetWidth; // reinicia la transición
      priceEl.classList.add(a.lastDir >= 0 ? "flash-up" : "flash-down");
      setTimeout(() => priceEl.classList.remove("flash-up", "flash-down"), 350);
    }

    const pct = chgPct(a);
    const chgEl = el.querySelector(".chg");
    chgEl.textContent = fmtPct(pct);
    chgEl.className = "chg " + (pct > 0 ? "up" : pct < 0 ? "down" : "flat");

    el.querySelector(".vol").textContent = "Vol 24h " + fmtVol(a.volume24h);
    el.querySelector(".star-btn").classList.toggle("is-fav", favs.has(a.key));

    if (a.candles.length && visibleKeys.has(a.key)) drawCard(el, a);
  }

  function drawCard(el, a) {
    const loading = el.querySelector(".chart-loading");
    if (loading && a.candlesAt) {
      if (a.candles.length) loading.remove();
      else loading.textContent = "sin datos de velas";
    }
    CHART.draw(el.querySelector("canvas"), a.candles, a.prevDayPx, null);
  }

  function toggleFav(key) {
    if (favs.has(key)) favs.delete(key);
    else favs.add(key);
    localStorage.setItem(LS.favs, JSON.stringify([...favs]));
    const el = cardEls.get(key);
    if (el) el.querySelector(".star-btn").classList.toggle("is-fav", favs.has(key));
    if (tab === "fav") renderGrid();
    else updateSummary();
  }

  /* ---------- filtrado + grilla ---------- */
  function visibleAssets() {
    const q = search.trim().toLowerCase();
    const list = [];
    for (const a of assets.values()) {
      if (tab === "fav" ? !favs.has(a.key) : a.category !== tab) continue;
      if (q && !(a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))) continue;
      if (!(a.volume24h > 0) && !Number.isFinite(a.price)) continue;
      list.push(a);
    }
    if (sortMode === "gainers") list.sort((x, y) => (chgPct(y) || -Infinity) - (chgPct(x) || -Infinity));
    else if (sortMode === "losers") list.sort((x, y) => (chgPct(x) || Infinity) - (chgPct(y) || Infinity));
    else list.sort((x, y) => y.volume24h - x.volume24h);
    return list;
  }

  function renderGrid() {
    const list = visibleAssets();

    const wanted = new Set(list.map((a) => a.key));
    for (const [key, el] of cardEls) {
      if (!wanted.has(key)) {
        observer.unobserve(el);
        el.remove();
        cardEls.delete(key);
        visibleKeys.delete(key);
      }
    }

    let anchor = null;
    for (const a of list) {
      let el = cardEls.get(a.key);
      if (!el) {
        el = buildCard(a);
        cardEls.set(a.key, el);
        observer.observe(el);
      } else {
        updateCardData(el, a, false);
      }
      if (anchor) anchor.after(el);
      else grid.prepend(el);
      anchor = el;
    }

    els.empty.hidden = list.length > 0 || !loaded;
    if (loaded && !list.length) {
      els.empty.textContent = tab === "fav" && !search
        ? "Todavía no tenés favoritos: tocá la ★ de cualquier activo para fijarlo acá."
        : "No hay activos que coincidan con la búsqueda en esta pestaña.";
    }
    updateSummary();
  }

  function updateSummary() {
    const list = visibleAssets();
    els.summary.hidden = !loaded || !list.length;
    if (els.summary.hidden) return;

    let ups = 0, downs = 0, best = null, worst = null;
    for (const a of list) {
      const p = chgPct(a);
      if (!Number.isFinite(p)) continue;
      if (p > 0) ups++;
      else if (p < 0) downs++;
      if (!best || p > chgPct(best)) best = a;
      if (!worst || p < chgPct(worst)) worst = a;
    }
    let html = `<span><b>${ups}</b> suben · <b>${downs}</b> bajan</span>`;
    if (best && chgPct(best) > 0) {
      html += `<span>Mayor suba <b>${best.symbol}</b> <span class="up">${fmtPct(chgPct(best))}</span></span>`;
    }
    if (worst && chgPct(worst) < 0) {
      html += `<span>Mayor baja <b>${worst.symbol}</b> <span class="down">${fmtPct(chgPct(worst))}</span></span>`;
    }
    els.summaryText.innerHTML = html;

    const total = ups + downs || 1;
    els.meterUp.style.width = (ups / total * 100).toFixed(1) + "%";
    els.meterDown.style.width = (downs / total * 100).toFixed(1) + "%";
  }

  /* ---------- barra de estado ---------- */
  function tickStatus() {
    const secs = lastUpdate ? Math.max(0, Math.round((Date.now() - lastUpdate) / 1000)) : null;
    const ago = secs == null ? "" : secs < 60 ? `hace ${secs}s` : `hace ${Math.floor(secs / 60)}m`;
    const dot = els.liveDot;
    dot.className = "dot";
    if (feedStatus === "live") {
      dot.classList.add("is-live");
      els.updated.textContent = `En vivo · actualizado ${ago}`;
    } else if (loaded) {
      dot.classList.add("is-poll");
      els.updated.textContent = `Sondeo (WS reconectando) · ${ago}`;
    } else {
      dot.classList.add("is-off");
      els.updated.textContent = "conectando…";
    }

    // NYSE/Nasdaq: lun–vie 9:30–16:00 hora de Nueva York (sin feriados)
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", weekday: "short", hour: "numeric",
        minute: "numeric", hour12: false,
      }).formatToParts(new Date());
      const get = (t) => parts.find((p) => p.type === t).value;
      const wd = get("weekday");
      const mins = parseInt(get("hour"), 10) % 24 * 60 + parseInt(get("minute"), 10);
      const open = !["Sat", "Sun"].includes(wd) && mins >= 570 && mins < 960;
      els.nyse.textContent = open ? "Abierto" : "Cerrado";
      els.nysePill.querySelector(".dot").className = "dot " + (open ? "is-live" : "is-off");
    } catch (_) { els.nyse.textContent = "—"; }
  }

  /* ---------- esqueleto y errores ---------- */
  function renderSkeletons(n) {
    grid.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const el = document.createElement("article");
      el.className = "card skeleton";
      el.innerHTML =
        '<div class="card-top"><span class="sk" style="width:90px">.</span><span class="sk" style="width:70px">.</span></div>' +
        '<div class="card-sub"><span class="sk" style="width:60px">.</span></div>' +
        '<div class="chart-wrap sk"></div>' +
        '<div class="card-foot"><span class="sk" style="width:100px">.</span></div>';
      grid.appendChild(el);
    }
  }

  function showError(msg) {
    els.errorText.textContent = msg;
    els.errorBanner.hidden = false;
  }

  /* ---------- controles ---------- */
  function syncControls() {
    els.tabs.querySelectorAll(".tab").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.tab === tab));
    els.sortGroup.querySelectorAll(".sort-btn").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.sort === sortMode));
  }

  els.tabs.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".tab");
    if (!btn) return;
    tab = btn.dataset.tab;
    localStorage.setItem(LS.tab, tab);
    syncControls();
    renderGrid();
  });

  els.sortGroup.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".sort-btn");
    if (!btn) return;
    sortMode = btn.dataset.sort;
    localStorage.setItem(LS.sort, sortMode);
    syncControls();
    renderGrid();
  });

  let searchTimer = null;
  els.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search = els.search.value;
      renderGrid();
    }, 120);
  });

  els.retry.addEventListener("click", () => {
    els.errorBanner.hidden = true;
    boot();
  });

  window.addEventListener("resize", () => {
    for (const key of visibleKeys) {
      const a = assets.get(key);
      const el = cardEls.get(key);
      if (a && el && a.candles.length) drawCard(el, a);
    }
  });

  /* ---------- arranque ---------- */
  let booting = false;
  async function boot() {
    if (booting) return;
    booting = true;
    renderSkeletons(15);
    try {
      await loadUniverse();
      loaded = true;

      // si no hay favoritos guardados, arrancar en una pestaña con contenido
      if (tab === "fav" && !favs.size) {
        const cats = new Set([...assets.values()].map((a) => a.category));
        tab = cats.has("stocks") ? "stocks" : "crypto";
      }
      grid.innerHTML = "";
      syncControls();
      renderGrid();

      if (!feed) {
        feed = createLiveFeed(onMids, (st) => { feedStatus = st; tickStatus(); });
        feed.setDexs([...new Set([...assets.values()].map((a) => a.dex))]);
      }
    } catch (err) {
      console.error(err);
      showError("No se pudo conectar a la API de Hyperliquid (" + err.message + "). " +
        "Revisá tu conexión o si un bloqueador está frenando api.hyperliquid.xyz.");
    } finally {
      booting = false;
    }
  }

  setInterval(() => {
    if (loaded) loadUniverse().then(updateSummary).catch((e) => console.warn("refresh", e));
  }, CTX_REFRESH_MS);

  setInterval(() => {
    for (const key of visibleKeys) requestCandles(key, false);
  }, 60000);

  setInterval(tickStatus, 1000);
  tickStatus();
  boot();
})();
