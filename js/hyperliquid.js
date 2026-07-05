/* Cliente de la API pública de Hyperliquid.
   - REST:  POST https://api.hyperliquid.xyz/info
   - WS:    wss://api.hyperliquid.xyz/ws
   Descubre todos los perp dexs (el principal de cripto y los HIP-3 de
   acciones/índices/commodities/forex) y expone precios en vivo. */
(function () {
  "use strict";

  const API_URL = "https://api.hyperliquid.xyz/info";
  const WS_URL = "wss://api.hyperliquid.xyz/ws";

  async function info(body) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API ${res.status} para ${body.type}`);
    return res.json();
  }

  /* Lista de perp dexs. El primer elemento es null (dex principal, ""). */
  async function fetchDexs() {
    try {
      const raw = await info({ type: "perpDexs" });
      const dexs = [{ name: "", fullName: "Hyperliquid" }];
      for (const d of raw || []) {
        if (d && d.name) dexs.push({ name: d.name, fullName: d.full_name || d.fullName || d.name });
      }
      return dexs;
    } catch (err) {
      console.warn("perpDexs falló, uso solo el dex principal", err);
      return [{ name: "", fullName: "Hyperliquid" }];
    }
  }

  /* Universo + contexto (markPx, prevDayPx, dayNtlVlm…) de un dex. */
  async function fetchAssets(dex) {
    const body = { type: "metaAndAssetCtxs" };
    if (dex.name) body.dex = dex.name;
    const [meta, ctxs] = await info(body);
    const out = [];
    (meta.universe || []).forEach((u, i) => {
      const ctx = ctxs[i];
      if (!u || !ctx || u.isDelisted) return;
      const mark = parseFloat(ctx.markPx);
      const mid = parseFloat(ctx.midPx);
      out.push({
        key: dex.name ? `${dex.name}:${u.name}` : u.name,
        symbol: u.name,
        dex: dex.name,
        dexName: dex.fullName,
        price: Number.isFinite(mid) ? mid : mark,
        markPx: mark,
        prevDayPx: parseFloat(ctx.prevDayPx),
        volume24h: parseFloat(ctx.dayNtlVlm) || 0,
      });
    });
    return out;
  }

  async function fetchAllAssets() {
    const dexs = await fetchDexs();
    const results = await Promise.allSettled(dexs.map(fetchAssets));
    const assets = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") assets.push(...r.value);
      else console.warn(`metaAndAssetCtxs falló para dex "${dexs[i].name}"`, r.reason);
    });
    return { dexs, assets };
  }

  /* Velas OHLC. Para activos de dexs HIP-3 el coin va prefijado ("dex:TICKER");
     si el snapshot llega vacío se reintenta sin prefijo por compatibilidad. */
  async function fetchCandles(asset, interval, lookbackMs) {
    const end = Date.now();
    const req = (coin) =>
      info({
        type: "candleSnapshot",
        req: { coin, interval, startTime: end - lookbackMs, endTime: end },
      });
    let rows = await req(asset.key);
    if ((!rows || !rows.length) && asset.key !== asset.symbol) {
      rows = await req(asset.symbol).catch(() => []);
    }
    return (rows || []).map((c) => ({
      t: c.t,
      o: parseFloat(c.o),
      h: parseFloat(c.h),
      l: parseFloat(c.l),
      c: parseFloat(c.c),
      v: parseFloat(c.v),
    }));
  }

  /* ---- WebSocket: mids en vivo de todos los dexs, con reconexión ---- */
  function createLiveFeed(onMids, onStatus) {
    let ws = null;
    let dexNames = [""];
    let retryMs = 1000;
    let pingTimer = null;
    let lastMsg = 0;
    let closedByUs = false;

    function subscribeAll() {
      for (const dex of dexNames) {
        const sub = { type: "allMids" };
        if (dex) sub.dex = dex;
        try {
          ws.send(JSON.stringify({ method: "subscribe", subscription: sub }));
        } catch (_) { /* se reintenta al reconectar */ }
      }
    }

    function connect() {
      if (closedByUs) return;
      try {
        ws = new WebSocket(WS_URL);
      } catch (err) {
        onStatus("offline");
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30000);
        return;
      }

      ws.onopen = () => {
        retryMs = 1000;
        lastMsg = Date.now();
        onStatus("live");
        subscribeAll();
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(JSON.stringify({ method: "ping" }));
          // si no llega nada en 45s, forzar reconexión
          if (Date.now() - lastMsg > 45000) ws.close();
        }, 20000);
      };

      ws.onmessage = (ev) => {
        lastMsg = Date.now();
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }
        if (msg.channel === "allMids" && msg.data) {
          const mids = msg.data.mids || msg.data;
          if (mids && typeof mids === "object") onMids(mids, msg.data.dex || "");
        }
      };

      ws.onclose = () => {
        clearInterval(pingTimer);
        if (closedByUs) return;
        onStatus("offline");
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30000);
      };

      ws.onerror = () => { try { ws.close(); } catch (_) {} };
    }

    connect();

    return {
      setDexs(names) {
        dexNames = names;
        if (ws && ws.readyState === WebSocket.OPEN) subscribeAll();
      },
      isLive() {
        return !!ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMsg < 20000;
      },
      close() {
        closedByUs = true;
        clearInterval(pingTimer);
        try { ws && ws.close(); } catch (_) {}
      },
    };
  }

  window.HL_API = { fetchAllAssets, fetchCandles, createLiveFeed };
})();
