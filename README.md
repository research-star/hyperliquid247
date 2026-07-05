# Mercado 24/7 — Hyperliquid

Dashboard de precios en vivo estilo "mercado 24/7": acciones, índices,
commodities, forex y cripto usando la **API pública de Hyperliquid**
(perpetuos, incluidos los mercados HIP-3 que cotizan activos tradicionales
las 24 horas, los 7 días). HTML + CSS + JS vanilla, sin dependencias ni build.

## Qué hace

- **Descubrimiento automático de mercados**: consulta `perpDexs` y
  `metaAndAssetCtxs` para el dex principal (cripto) y todos los dexs
  HIP-3 (acciones, índices, commodities, forex). No hay listas de
  activos hardcodeadas: si aparece un mercado nuevo, se muestra solo.
- **Precios en vivo por WebSocket** (`allMids` de cada dex), con
  reconexión automática con backoff y fallback a sondeo REST cada 30 s.
- **Velas de 30 min (últimas 24 h)** por tarjeta vía `candleSnapshot`,
  cargadas de forma perezosa (solo tarjetas visibles) y actualizadas en
  vivo con cada tick de precio. Tooltip OHLC al pasar el mouse.
- **Pestañas**: Favoritos (★ persistidos en `localStorage`), Stocks,
  Índices, Commodities, Forex y Cripto.
- **Buscador**, orden por **Volumen / Subas / Bajas**, y barra resumen
  (cuántos suben/bajan, mayor suba y mayor baja de la vista actual).
- Indicador de estado **NYSE/Nasdaq abierto o cerrado** (lun–vie
  9:30–16:00 hora de Nueva York) junto al "Mercado HL 24/7".
- Formato de números `es-AR` (`US$ 1.687,68`, `+13,88%`, `US$ 59 M`).

## Cómo correrlo

Es un sitio estático; el navegador se conecta directo a
`api.hyperliquid.xyz`, no hace falta backend ni claves.

```bash
# opción 1
npx serve .

# opción 2
python3 -m http.server 8000
```

y abrir `http://localhost:8000`. También funciona publicado en GitHub
Pages / Netlify / Vercel tal cual.

## Embeber como pestaña en otra página (ej.: finanzasbo.com)

`dist/mercado247-tab.js` es un bundle autocontenido (estilos namespaceados
bajo `.m247` + markup + lógica) pensado para el patrón de tabs con
lazy-render de FinanzasBo (`window.renderXxx`). No pisa ni hereda estilos
del sitio anfitrión.

```html
<!-- 1. el contenedor de la tab -->
<div id="tab-mercado247" data-mercado247></div>

<!-- 2. el script (una sola vez, al final del body) -->
<script src="mercado247-tab.js" defer></script>

<!-- 3. al activar la tab (idempotente; la 1ª llamada monta y conecta) -->
<script>/* dentro de activateTab('mercado247'): */ window.renderMercado247();</script>
```

Si la página no usa tabs, alcanza con `<div data-mercado247-auto></div>` y
el script: se monta solo al cargar.

## Estructura

```
index.html         maquetado y layout
css/styles.css     tema oscuro
js/hyperliquid.js  cliente REST + WebSocket de Hyperliquid
js/chart.js        velas en <canvas> + tooltip
js/names.js        nombres legibles y clasificación por categoría
js/app.js          estado, grilla, pestañas, buscador, favoritos
```

## Notas sobre los datos

- Los precios son **mark price de perpetuos de Hyperliquid**, no el
  último precio del exchange tradicional: por eso existen 24/7, pero
  pueden diferir levemente del cierre oficial.
- La variación % se calcula contra `prevDayPx` (precio de hace 24 h).
- El volumen es el nocional en USD de las últimas 24 h (`dayNtlVlm`).
- No es asesoramiento financiero.
