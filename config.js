// ─────────────────────────────────────────────────────────────────────────────
// CONFIG & CONSTANTS
// Purpose: Centralized configuration for the application
// ─────────────────────────────────────────────────────────────────────────────
const CONFIG = {
  // IST (Indian Standard Time) is UTC+5:30, which equals 19800 seconds
  // Used to convert Unix timestamps to IST for display and calculations
  IST_OFFSET_S:   19800,
  IST_OFFSET_MS:  19800000,
  
  // Maximum number of bubbles to keep in memory at once
  // When exceeded, oldest bubbles are removed (FIFO queue pattern)
  MAX_BUBBLES:    2000,
  
  // Debounce delay for expensive operations (mouse moves, resizes)
  // Prevents performance issues from rapid event firing
  DEBOUNCE_MS:    50,
  
  // Backend WebSocket server URL for real-time data
  WEBSOCKET_URL:  'ws://localhost:8765',
  
  // Interval for measuring TPS (Ticks Per Second) - displayed in UI
  TPS_INTERVAL_MS: 1000,
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// Helper functions used throughout the application
// ─────────────────────────────────────────────────────────────────────────────

// DEBOUNCE: Delays function execution, canceling previous calls within the timeout
// Use case: Prevents firing expensive handlers multiple times during rapid events
// Example: User scrolls 100 times → only last call executes after 50ms pause
const debounce = (fn, ms) => {
  let timer; 
  return (...args) => { 
    clearTimeout(timer); 
    timer = setTimeout(() => fn(...args), ms); 
  };
};

// SAFE CALL: Wraps function in try-catch to prevent crashes from errors
// Use case: Non-critical operations that should fail silently with fallback
// Parameters: fn=function, ctx=context (this), fallback=default return value
const safeCall = (fn, ctx = null, fallback = null) => {
  try { 
    return fn.call(ctx); 
  } catch (e) { 
    console.error('Error:', e); 
    return fallback; 
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STATE
// Central state management for the entire application
// ─────────────────────────────────────────────────────────────────────────────

// TIME CONSTANTS - Reused throughout app instead of recalculating
const IST_OFFSET_S  = CONFIG.IST_OFFSET_S;
const IST_OFFSET_MS = CONFIG.IST_OFFSET_MS;

// ── WebSocket Connections ──────────────────────────────────────────────────
// ws = Main connection for authentication, spot data, option chains
// wsCE = Dedicated CE (Call) option feed
// wsPE = Dedicated PE (Put) option feed
let ws=null, wsCE=null, wsPE=null;

// ── Chart Objects ──────────────────────────────────────────────────────────
// lwChart = LightweightCharts instance (the main chart)
// cSeries = Candlestick series (OHLC data)
// vSeries = Volume histogram series
let lwChart=null, cSeries=null, vSeries=null;

// ── Chart Data Storage ─────────────────────────────────────────────────────
// cData = Array of candle data [{time, open, high, low, close}, ...]
// vData = Array of volume data [{time, value, color}, ...]
// cMap = Index map for fast lookup: cMap[timestamp] = array_index
//        Prevents duplicate entries and allows O(1) updates instead of O(n) searches
let cData=[], vData=[], cMap={};

// ── User Selection State ───────────────────────────────────────────────────
// selSym = Currently selected instrument symbol (e.g., 'NSE_INDEX|Nifty 50')
// selIv = Display interval: 1=1s, 60=1m, 300=5m, 900=15m
// tokSaved = Whether user's auth token was successfully validated
let selSym=null, selIv=60, tokSaved=false;

// ── Candle Aggregation ─────────────────────────────────────────────────────
// When selIv > 1, raw 1s candles are grouped into larger timeframes
// aggBucket = Current accumulating bucket for aggregation
// Example: 60 raw 1s candles → 1 aggregated 1m candle
let aggBucket = null;

// ── Performance Monitoring ─────────────────────────────────────────────────
// tickCnt = Count of incoming ticks (messages) - reset every second for TPS display
// tpsTmr = Timer ID for the TPS interval (used to clear it later)
// bubOn = Whether bubble visualization is enabled/disabled by user
let tickCnt=0, tpsTmr=null, bubOn=true;

// ── Real-time Mode Flag ────────────────────────────────────────────────────
// When true: chart auto-scrolls to show latest data (live mode)
// When false: user is manually exploring historical chart data
let _atRealTime = true;

// ❌ UNUSED: Legacy variable for contract size calculations - never used
// Safe to delete if not needed in future features
let LOT_SIZE = 65;

// ── 5-Second Accumulation Buckets ──────────────────────────────────────────
// For CE, PE, and Spot feeds - accumulates 1s candles into 5s buckets
// Used by bubbles.js to calculate premium movement ratios
// Structure: { cur: {current 5s bucket}, _last: {previous 5s bucket} }
let ce5Bucket   = { cur: null, _last: null };
let pe5Bucket   = { cur: null, _last: null };
let spot5Bucket = { cur: null, _last: null };

// ── Option Chain UI State ──────────────────────────────────────────────────
// For storing selected CE/PE strikes and their DOM button references
let selCEKey=null, selPEKey=null, selCEBtn=null, selPEBtn=null;

// ❌ UNUSED: Was meant to track current spot instrument, but feature incomplete
let spotInstrKey = 'NSE_INDEX|Nifty 50';

// ❌ UNUSED: Stores LTP (Last Trade Price) history but values never read
// Safe to delete - no feature depends on historical LTP values
const lastSpotLtp = {};

// ── Option Chain State ─────────────────────────────────────────────────────
// optUL = Current underlying ('NIFTY', 'BANKNIFTY', 'FINNIFTY')
// optExpiries = List of available expiry dates
// optChain = Current chain data with strikes, spot price, ATM index
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
// Display functions that convert raw data into readable UI strings
// ─────────────────────────────────────────────────────────────────────────────

// fN: Format Number - Converts raw price to 2 decimal places (Indian locale)
// Example: 100 → "100.00", 50000.567 → "50,000.57"
const fN = v => Number(v).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});

// fV: Format Volume - Shows volume in readable units (Cr = Crore, L = Lakh)
// Example: 1234567 → "12.35 L", 10000000 → "1.00 Cr"
const fV = v => { 
  if(!v) return '—'; 
  if(v>=1e7) return (v/1e7).toFixed(2)+' Cr'; 
  if(v>=1e5) return (v/1e5).toFixed(2)+' L'; 
  return Number(v).toLocaleString('en-IN'); 
};

// fT: Format Time - Converts Unix timestamp to IST time string
// Example: 1234567890 → "10:05:23 IST"
// Note: Adds IST_OFFSET_MS to convert from UTC to IST
const fT = ms => {
  const d = new Date(ms + IST_OFFSET_MS);
  return String(d.getUTCHours()).padStart(2,'0') + ':' +
         String(d.getUTCMinutes()).padStart(2,'0') + ':' +
         String(d.getUTCSeconds()).padStart(2,'0') + ' IST';
};

// ivLabel: Format Interval - Converts seconds to human-readable time unit
// Example: 3600 → "1h", 300 → "5m", 30 → "30s"
const ivLabel = v => { 
  if(v>=3600) return (v/3600)+'h'; 
  if(v>=60) return (v/60)+'m'; 
  return v+'s'; 
};

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS INDEX KEY MAPPING
// Maps underlying names to their full Upstox instrument keys
// Used when subscribing to option chain data and spot feeds
// ─────────────────────────────────────────────────────────────────────────────
const OPT_INDEX_KEY = {
  'NIFTY':     'NSE_INDEX|Nifty 50',
  'BANKNIFTY': 'NSE_INDEX|Nifty Bank',
  'FINNIFTY':  'NSE_INDEX|Nifty Fin Service',
};
