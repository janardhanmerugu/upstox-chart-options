# Code Analysis Report - Upstox Chart Options

## Project Overview
This is a **real-time options trading chart application** that displays candle data with bubble overlays representing option premium movements.

**Tech Stack:** Vanilla JavaScript, WebSocket (backend connection), LightweightCharts library

---

## 🔴 UNUSED CODE IDENTIFIED

### 1. **LOT_SIZE Variable** (config.js:37)
```javascript
let LOT_SIZE = 65;  // ❌ UNUSED - Never referenced anywhere
```
**Location:** [config.js](config.js#L37)  
**Status:** Dead code - safe to remove  
**Purpose (intended):** Likely meant for contract size calculations but never implemented

---

### 2. **lastSpotLtp Object** (config.js:49 + ws.js:104)
```javascript
// In config.js
const lastSpotLtp = {};  // ❌ UNUSED - Values written but never read

// In ws.js - Line 104
if (spotInstrKey) lastSpotLtp[spotInstrKey] = msg.ltp;  // ❌ Write-only, never read
```
**Location:** [config.js](config.js#L49) and [ws.js](ws.js#L104)  
**Status:** Dead code - values stored but never used anywhere  
**Purpose (intended):** Possibly for comparing LTP history, but feature never implemented

---

### 3. **spotInstrKey Variable** (config.js:48)
```javascript
let spotInstrKey = 'NSE_INDEX|Nifty 50';  // ⚠️ PARTIALLY USED
```
**Location:** [config.js](config.js#L48)  
**Status:** Set once but values never read (only used for `lastSpotLtp` storage)  
**Note:** Initialized but actual spot instrument key comes from `OPT_INDEX_KEY[optUL]`

---

## 📊 CODE STRUCTURE ANALYSIS

### Files Breakdown:

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| **config.js** | ~65 | Constants, global state, formatters | ✅ Core |
| **chart.js** | ~160+ | Chart initialization & candle management | ✅ Core |
| **ui.js** | ~300+ | UI controls, token management, options chain | ✅ Core |
| **ws.js** | ~400+ | WebSocket connections & message handlers | ✅ Core |
| **bubbles.js** | ~450+ | Bubble visualization overlay system | ✅ Core |
| **init.js** | ~30 | Event listeners & initialization | ✅ Core |
| **index.html** | ~500+ | HTML structure & UI elements | ✅ Core |
| **style.css** | ~500+ | Styling & layout | ✅ Core |

---

## 🎯 Key Data Flows

### 1. **Real-time Chart Subscription**
```
Connect → Auth → Load Symbol → WebSocket Feed → upsertCandle → Chart Update
```

### 2. **Option Chain Analysis**
```
Pick Underlying → Fetch Expiries → Select Strike → Connect CE/PE feeds → Show Bubbles
```

### 3. **Bubble Generation**
```
CE Feed (5s) + PE Feed (5s) + Spot Feed (5s) → Accumulate → Calculate Ratio → Draw on Canvas
```

---

## 💡 Learning Notes for Developers

### Important Concepts:

1. **IST Offset Handling** (config.js)
   - Converts Unix timestamps to IST (UTC+5:30)
   - Used throughout for time formatting

2. **Candle Aggregation** (chart.js)
   - 1s data can be aggregated into 1m/5m/15m buckets
   - Happens client-side for display efficiency

3. **Bubble Ratio Calculation** (bubbles.js)
   - Ratio = (Option Delta) / (Spot Delta)
   - Positive ratio = Premium moved with spot (bullish for CE, bearish for PE)
   - Rendered as colored circles with size proportional to ratio magnitude

4. **WebSocket State Management**
   - Three connections: Main (spot data), CE feed, PE feed
   - Each requires separate auth and subscription

---

## 🧹 Recommendations

### Remove Unused Code:
- [ ] Delete `LOT_SIZE = 65` from config.js
- [ ] Delete `lastSpotLtp` object and line 104 assignment in ws.js
- [ ] Simplify `spotInstrKey` (only initialize once)

### Consider Cleanup:
- Consolidate WebSocket error handlers (many empty `catch` blocks)
- Consider error logging system instead of scattered console.error calls

---

## 🚀 Performance Notes

- **Max Bubbles:** 2000 (CONFIG.MAX_BUBBLES) - cached array that shifts old items
- **Debounce Delay:** 50ms (CONFIG.DEBOUNCE_MS) - for mouse/scroll events
- **Canvas Redraw:** On every new candle + user scroll/zoom
- **Memory Impact:** ~50-100KB for 2000 bubbles at typical ratios

