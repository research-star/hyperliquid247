/* Mini gráfico de velas en <canvas>, con línea punteada en el cierre
   del día anterior y tooltip OHLC al pasar el mouse. */
(function () {
  "use strict";

  const UP = "#10b981";
  const DOWN = "#ef4444";
  const REF = "#4b5563";
  const PAD_Y = 8;

  function draw(canvas, candles, prevDayPx, hoverIdx) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!candles.length) return;

    let lo = Infinity;
    let hi = -Infinity;
    for (const c of candles) {
      if (c.l < lo) lo = c.l;
      if (c.h > hi) hi = c.h;
    }
    if (Number.isFinite(prevDayPx)) {
      lo = Math.min(lo, prevDayPx);
      hi = Math.max(hi, prevDayPx);
    }
    if (hi === lo) { hi += 1; lo -= 1; }
    const y = (px) => PAD_Y + (hi - px) / (hi - lo) * (h - PAD_Y * 2);

    const step = w / candles.length;
    const bodyW = Math.max(2, Math.min(9, step * 0.62));

    // referencia: cierre del día anterior
    if (Number.isFinite(prevDayPx)) {
      ctx.strokeStyle = REF;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y(prevDayPx));
      ctx.lineTo(w, y(prevDayPx));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    candles.forEach((c, i) => {
      const cx = step * i + step / 2;
      const up = c.c >= c.o;
      const color = up ? UP : DOWN;
      const dim = hoverIdx != null && hoverIdx !== i;
      ctx.globalAlpha = dim ? 0.45 : 1;

      // mecha
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, y(c.h));
      ctx.lineTo(cx, y(c.l));
      ctx.stroke();

      // cuerpo
      const top = y(Math.max(c.o, c.c));
      const bot = y(Math.min(c.o, c.c));
      ctx.fillStyle = color;
      ctx.fillRect(cx - bodyW / 2, top, bodyW, Math.max(1, bot - top));
    });
    ctx.globalAlpha = 1;

    if (hoverIdx != null && candles[hoverIdx]) {
      const cx = step * hoverIdx + step / 2;
      ctx.strokeStyle = "rgba(232,234,237,0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* Conecta el hover del canvas con el tooltip global.
     getData() → { candles, prevDayPx, fmtPrice } */
  function attachHover(canvas, tooltipEl, getData) {
    let hoverIdx = null;

    function onMove(ev) {
      const { candles, prevDayPx, fmtPrice } = getData();
      if (!candles.length) return;
      const rect = canvas.getBoundingClientRect();
      const idx = Math.max(0, Math.min(candles.length - 1,
        Math.floor((ev.clientX - rect.left) / (rect.width / candles.length))));
      if (idx !== hoverIdx) {
        hoverIdx = idx;
        draw(canvas, candles, prevDayPx, hoverIdx);
      }
      const c = candles[idx];
      const up = c.c >= c.o;
      const when = new Date(c.t).toLocaleString("es-AR", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      });
      tooltipEl.innerHTML =
        `<span class="tt-time">${when}</span>` +
        `A <b>${fmtPrice(c.o)}</b> · Máx <b>${fmtPrice(c.h)}</b><br>` +
        `Mín <b>${fmtPrice(c.l)}</b> · C <b class="${up ? "up" : "down"}">${fmtPrice(c.c)}</b>`;
      tooltipEl.hidden = false;
      const ttw = tooltipEl.offsetWidth;
      let x = ev.clientX + 14;
      if (x + ttw > window.innerWidth - 8) x = ev.clientX - ttw - 14;
      tooltipEl.style.left = `${x}px`;
      tooltipEl.style.top = `${ev.clientY + 14}px`;
    }

    function onLeave() {
      hoverIdx = null;
      tooltipEl.hidden = true;
      const { candles, prevDayPx } = getData();
      draw(canvas, candles, prevDayPx, null);
    }

    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
  }

  window.HL_CHART = { draw, attachHover };
})();
