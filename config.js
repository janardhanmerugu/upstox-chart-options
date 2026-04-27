// ─────────────────────────────────────────────────────────────────────────────
// CONFIG & CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  IST_OFFSET_S:   19800,
  IST_OFFSET_MS:  19800000,
  MAX_BUBBLES:    2000,
  DEBOUNCE_MS:    50,
  WEBSOCKET_URL:  'ws://localhost:8765',
  TPS_INTERVAL_MS: 1000,
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
const debounce = (fn, ms) => {
  let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
};

const safeCall = (fn, ctx = null, fallback = null) => {
  try { return fn.call(ctx); } catch (e) { console.error('Error:', e); return fallback; }
};

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────────────────────────────────────
const IST_OFFSET_S  = CONFIG.IST_OFFSET_S;
const IST_OFFSET_MS = CONFIG.IST_OFFSET_MS;

let ws=null, wsCE=null, wsPE=null, lwChart=null, cSeries=null, vSeries=null;
let cData=[], vData=[], cMap={};
let selSym=null, selIv=60, tokSaved=false;
let aggBucket = null;

let tickCnt=0, tpsTmr=null, bubOn=true;
let _atRealTime = true;
let LOT_SIZE = 65;

// 5s accumulator buckets for CE, PE, Spot
let ce5Bucket   = { cur: null, _last: null };
let pe5Bucket   = { cur: null, _last: null };
let spot5Bucket = { cur: null, _last: null };

// Dual selected option strike state
let selCEKey=null, selPEKey=null, selCEBtn=null, selPEBtn=null;

// Spot instrument key tracking
let spotInstrKey = 'NSE_INDEX|Nifty 50';
const lastSpotLtp = {};

// Option chain state
let optUL       = 'NIFTY';
let optExpiries = [];
let optChain    = null;

// Bubble display config (controlled by sliders/inputs in UI)
let bubScale        = 1.0;
let bubSizeMult     = 1.0;
let bubMaxSize      = 60;
let bubMinRatioCE   = 0;
let bubMinRatioPE   = 0;
let bubOpacity      = 0.60;
let bubSpotDeltaMin = 0.7;

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────
const fN = v => Number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const fV = v => { if(!v) return '—'; if(v>=1e7) return (v/1e7).toFixed(2)+' Cr'; if(v>=1e5) return (v/1e5).toFixed(2)+' L'; return Number(v).toLocaleString('en-IN'); };
const fT = ms => {
  const d = new Date(ms + IST_OFFSET_MS);
  return String(d.getUTCHours()).padStart(2,'0') + ':' +
         String(d.getUTCMinutes()).padStart(2,'0') + ':' +
         String(d.getUTCSeconds()).padStart(2,'0') + ' IST';
};

const ivLabel = v => { if(v>=3600) return (v/3600)+'h'; if(v>=60) return (v/60)+'m'; return v+'s'; };

// Options index mapping
const OPT_INDEX_KEY = {
  'NIFTY':     'NSE_INDEX|Nifty 50',
  'BANKNIFTY': 'NSE_INDEX|Nifty Bank',
  'FINNIFTY':  'NSE_INDEX|Nifty Fin Service',
};
