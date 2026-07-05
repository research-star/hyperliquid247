/* Nombres legibles y clasificación de activos.
   La lista de activos se descubre dinámicamente desde la API; esto solo
   mejora la presentación de los tickers conocidos. */
(function () {
  "use strict";

  const DISPLAY_NAMES = {
    // acciones / equities (mercados HIP-3)
    AAPL: "Apple", MSFT: "Microsoft", NVDA: "NVIDIA", AMZN: "Amazon",
    GOOGL: "Alphabet", GOOG: "Alphabet", META: "Meta", TSLA: "Tesla",
    AMD: "AMD", INTC: "Intel", MU: "Micron", AVGO: "Broadcom",
    QCOM: "Qualcomm", TSM: "TSMC", SMCI: "Supermicro", DELL: "Dell",
    ORCL: "Oracle", IBM: "IBM", CRM: "Salesforce", NFLX: "Netflix",
    COIN: "Coinbase", HOOD: "Robinhood", MSTR: "MicroStrategy",
    PLTR: "Palantir", UBER: "Uber", ABNB: "Airbnb", SHOP: "Shopify",
    SNOW: "Snowflake", NBIS: "Nebius", CRWV: "CoreWeave", SNDK: "SanDisk",
    WDC: "Western Digital", STX: "Seagate", KIOXIA: "Kioxia",
    SKHX: "SK Hynix", SMSN: "Samsung", BRK: "Berkshire", JPM: "JPMorgan",
    BAC: "Bank of America", GS: "Goldman Sachs", V: "Visa", MA: "Mastercard",
    DIS: "Disney", NKE: "Nike", KO: "Coca-Cola", PEP: "PepsiCo",
    WMT: "Walmart", MCD: "McDonald's", BA: "Boeing", GE: "GE",
    XOM: "Exxon", CVX: "Chevron", PFE: "Pfizer", JNJ: "J&J",
    LLY: "Eli Lilly", NVO: "Novo Nordisk", UNH: "UnitedHealth",
    SPCX: "SpaceX", OPENAI: "OpenAI", ANTHROPIC: "Anthropic",
    DRAM: "DRAM", RKLB: "Rocket Lab", ASML: "ASML", ARM: "Arm",
    RIVN: "Rivian", LCID: "Lucid", F: "Ford", GM: "GM",
    // índices / ETFs
    SP500: "S&P 500", SPX: "S&P 500", US500: "S&P 500", SPY: "S&P 500 ETF",
    NDX: "Nasdaq 100", NAS100: "Nasdaq 100", US100: "Nasdaq 100", QQQ: "Nasdaq 100 ETF",
    DJ30: "Dow Jones", US30: "Dow Jones", DIA: "Dow Jones ETF",
    RUT: "Russell 2000", IWM: "Russell 2000 ETF", VIX: "VIX",
    DAX: "DAX 40", FTSE: "FTSE 100", N225: "Nikkei 225", NIKKEI: "Nikkei 225",
    // commodities
    GOLD: "Oro", XAU: "Oro", SILVER: "Plata", XAG: "Plata",
    CL: "Petróleo WTI", WTI: "Petróleo WTI", OIL: "Petróleo WTI",
    BRENT: "Petróleo Brent", NG: "Gas natural", NATGAS: "Gas natural",
    HG: "Cobre", COPPER: "Cobre", PLATINUM: "Platino", PALLADIUM: "Paladio",
    URANIUM: "Uranio", COCOA: "Cacao", COFFEE: "Café", WHEAT: "Trigo",
    CORN: "Maíz", SUGAR: "Azúcar",
    // forex
    EUR: "Euro / USD", EURUSD: "Euro / USD", GBP: "Libra / USD",
    GBPUSD: "Libra / USD", JPY: "USD / Yen", USDJPY: "USD / Yen",
    CHF: "USD / Franco", AUD: "Dólar australiano", CAD: "USD / Dólar canadiense",
    NZD: "Dólar neozelandés", CNH: "USD / Yuan", MXN: "USD / Peso mexicano",
    DXY: "Índice dólar",
    // cripto (principales)
    BTC: "Bitcoin", ETH: "Ethereum", SOL: "Solana", HYPE: "Hyperliquid",
    XRP: "XRP", DOGE: "Dogecoin", ADA: "Cardano", AVAX: "Avalanche",
    LINK: "Chainlink", BNB: "BNB", LTC: "Litecoin", SUI: "Sui",
    TON: "Toncoin", TRX: "Tron", DOT: "Polkadot", NEAR: "Near",
    APT: "Aptos", ARB: "Arbitrum", OP: "Optimism", WLD: "Worldcoin",
    PEPE: "Pepe", WIF: "dogwifhat", FARTCOIN: "Fartcoin", ENA: "Ethena",
    AAVE: "Aave", UNI: "Uniswap", TAO: "Bittensor", SEI: "Sei",
    TIA: "Celestia", JUP: "Jupiter", ONDO: "Ondo", PAXG: "Oro tokenizado",
  };

  const INDICES = new Set([
    "SP500", "SPX", "US500", "SPY", "NDX", "NAS100", "US100", "QQQ",
    "DJ30", "US30", "DIA", "RUT", "IWM", "VIX", "DAX", "FTSE",
    "N225", "NIKKEI", "ES", "NQ", "YM",
  ]);

  const COMMODITIES = new Set([
    "GOLD", "XAU", "SILVER", "XAG", "CL", "WTI", "OIL", "BRENT",
    "NG", "NATGAS", "HG", "COPPER", "PLATINUM", "PALLADIUM", "URANIUM",
    "COCOA", "COFFEE", "WHEAT", "CORN", "SUGAR", "PAXG",
  ]);

  const FOREX = new Set([
    "EUR", "EURUSD", "GBP", "GBPUSD", "JPY", "USDJPY", "CHF", "USDCHF",
    "AUD", "AUDUSD", "CAD", "USDCAD", "NZD", "NZDUSD", "CNH", "USDCNH",
    "MXN", "USDMXN", "BRL", "USDBRL", "DXY",
  ]);

  // symbol: ticker sin prefijo de dex; dex: "" = perps principales (cripto)
  function classify(symbol, dex) {
    const s = symbol.toUpperCase();
    if (INDICES.has(s)) return "indices";
    if (COMMODITIES.has(s)) return "commodities";
    if (FOREX.has(s)) return "forex";
    if (!dex) return "crypto";
    return "stocks";
  }

  function displayName(symbol) {
    const s = symbol.toUpperCase();
    // tickers con sufijos tipo "NVDA-USD" o variantes con números
    if (DISPLAY_NAMES[s]) return DISPLAY_NAMES[s];
    // "kPEPE" (unidades x1000) → PEPE
    if (/^k[A-Z]/.test(symbol) && DISPLAY_NAMES[s.slice(1)]) {
      return DISPLAY_NAMES[s.slice(1)] + " (x1000)";
    }
    const base = s.replace(/[-_/].*$/, "");
    if (DISPLAY_NAMES[base]) return DISPLAY_NAMES[base];
    return symbol;
  }

  window.HL_NAMES = { classify, displayName };
})();
