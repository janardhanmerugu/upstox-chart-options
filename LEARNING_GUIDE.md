# 🎓 Complete Learning Guide - Upstox Chart Application

## Project Overview

This is a **real-time options trading visualization tool** built with vanilla JavaScript. It displays candlestick charts with a custom "bubble" overlay that visualizes the relationship between options premium movement and spot index movement.

### Key Features:
- ✅ Real-time candlestick charts (1s to 15m timeframes)
- ✅ Live WebSocket data feeds (Upstox API)
- ✅ Options chain viewer (NIFTY, BANKNIFTY, FINNIFTY)
- ✅ Bubble visualization (premium movement analysis)
- ✅ Historical data loading
- ✅ Manual drawing tools on chart

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      HTML INTERFACE                         │
│              (index.html + style.css)                       │
├─────────────────────────────────────────────────────────────┤
│  
│  ┌──────────────────┐  ┌──────────────────┐ ┌────────────┐
│  │   UI LAYER       │  │  EVENT HANDLERS  │ │   CHART    │
│  │   (ui.js)        │  │   (init.js)      │ │ (chart.js) │
│  └──────────────────┘  └──────────────────┘ └────────────┘
│           │                    │                    │
│           └────────────────────┼────────────────────┘
│                                │
│  ┌─────────────────────────────▼─────────────────────────────┐
│  │              GLOBAL STATE (config.js)                     │
│  │  - WebSocket connections                                  │
│  │  - Chart data (candles, volumes)                          │
│  │  - User selections (symbol, IV, token)                    │
│  │  - Bubble state (CE/PE/Spot buckets)                     │
│  └─────────────────────────────▲─────────────────────────────┘
│                                │
│           ┌────────────────────┼────────────────────┐
│           │                    │                    │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌───────▼───────┐
│  │  WEBSOCKET      │  │   BUBBLES       │  │ LIGHTWEIGHT   │
│  │   (ws.js)       │  │  (bubbles.js)   │  │  CHARTS lib   │
│  │                 │  │                 │  │   (library)   │
│  │ - Auth          │  │ - Ratio calc    │  │ - Rendering   │
│  │ - Subscriptions │  │ - Canvas draw   │  │ - Interaction │
│  │ - Message parse │  │ - Hit testing   │  │ - Resize      │
│  └─────────────────┘  └─────────────────┘  └───────────────┘
│           │                    │                    │
│           └────────────────────┼────────────────────┘
│                                │
└────────────────────────────────▼──────────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  UPSTOX BACKEND SERVER  │
                    │  (WebSocket @ :8765)    │
                    └─────────────────────────┘
```

---

## File-by-File Breakdown

### 📄 **config.js** - Central Configuration
```
Size: ~100 lines
Purpose: All constants, state, and utility functions
Key Items:
  - CONFIG object (IST offset, max bubbles, debounce, WebSocket URL)
  - Global state variables (ws, lwChart, cData, etc.)
  - Formatters (fN, fV, fT, ivLabel)
  - Option index mapping
```

**Key Learning:**
- Centralize configuration for easy changes
- Use formatters to keep data handling clean
- All global state in one place for debuggability

---

### 📄 **chart.js** - Chart Management
```
Size: ~200+ lines
Purpose: LightweightCharts library integration
Functions:
  - initCharts() - Create and configure chart
  - aggCandle() - Convert 1s → 1m/5m/15m candles
  - upsertCandle() - Add/update candle in chart
  - _flushBulk() - Batch data insertion
```

**Key Learning:**
- Lazy initialization: check if library exists
- Batch operations are faster than individual updates
- Use data structures (cMap) for O(1) lookups
- Clean up old instances to prevent memory leaks

---

### 📄 **ws.js** - WebSocket Communication
```
Size: ~400+ lines
Purpose: Real-time data connections and message handling
Functions:
  - connectWS() - Main connection with all handlers
  - disconnectWS() - Clean shutdown
  - _makeOptWS() - Helper for CE/PE feeds
  - connectCEWS() / connectPEWS() - Option feeds
  - loadLocalBubbles() - CSV import
  - CSV loaders and handlers
```

**Key Learning:**
- Handle multiple WebSocket connections independently
- Graceful error handling and reconnection logic
- Message routing pattern (if t === 'type')
- Clean resource cleanup on disconnect

---

### 📄 **bubbles.js** - Bubble Visualization
```
Size: ~450+ lines
Purpose: Canvas overlay for premium ratio visualization
Main Object: BUB = {
  - mount() - Create canvas
  - draw() - Render bubbles
  - _tryEmitCE() / _tryEmitPE() - Bubble calculation
  - toXY() - Coordinate transformation
  - _onMove() / _showTip() - Hover interactions
}
```

**Key Learning:**
- Canvas coordinate mapping with chart library
- 5-second bucket accumulation pattern
- Ratio calculation (premium vs spot movement)
- Hit testing for mouse interactions
- Performance: Limit to MAX bubbles, cache calculations

---

### 📄 **ui.js** - User Interface
```
Size: ~300+ lines
Purpose: Button handlers, input processing, UI state
Functions:
  - toggleBubbles() - Toggle visualization
  - toggleCrosshair() - Change crosshair mode
  - Token management (toggleTokenVis, saveToken, etc.)
  - Option chain UI (optPickUL, optSelectStrike, etc.)
  - History date pickers
  - Line drawing tools
```

**Key Learning:**
- Separate UI concerns from data concerns
- Use consistent naming patterns (toggle*, opt*, csv*)
- Update UI elements after state changes
- Disable buttons based on connection state

---

### 📄 **init.js** - Initialization
```
Size: ~30 lines
Purpose: DOMContentLoaded event and initial setup
Contains:
  - Window event listener setup
  - Chart click handler for drawing lines
  - Date picker initialization
```

**Key Learning:**
- Use DOMContentLoaded to wait for DOM
- Keep initialization focused and minimal
- Initialize plugins/libraries here

---

### 🎨 **style.css** - Styling
```
Size: ~500+ lines
Pattern: CSS variables + component classes
Key Sections:
  - :root variables (colors, spacing)
  - Layout (Flexbox for drawer + main)
  - Components (buttons, badges, panels)
  - Charts and responsive
```

**Key Learning:**
- Use CSS variables for theming
- Mobile-responsive with drawer collapse
- Dark mode optimized for trading

---

### 📄 **index.html** - Structure
```
Size: ~500+ lines
Structure:
  ├─ Head (fonts, CSS)
  ├─ Body
  │  ├─ Sidebar (token, options chain, controls)
  │  ├─ Main chart area
  │  ├─ Bubble controls
  │  ├─ History loader
  │  └─ CSV loader
  └─ Scripts (all JS files)
```

**Key Learning:**
- IDs for JavaScript targets (vs classes for CSS)
- Semantic structure makes JS easier
- Inline event handlers for simple cases

---

## Data Flow Examples

### Example 1: Real-time Chart Update
```
Backend sends candle message
    ↓
ws.onmessage() catches it
    ↓
Parse: msg.type === 'candle'
    ↓
aggCandle(msg.candle) - aggregate to current timeframe
    ↓
upsertCandle() - add to cData array
    ↓
cSeries.update() - patch chart
    ↓
BUB.pushSpot5s() - feed to bubble calculator
    ↓
BUB.draw() - redraw on canvas
```

### Example 2: Bubble Calculation
```
Spot 5s completes
    ↓
spot5Bucket._last = complete bucket
    ↓
BUB.pushSpot5s() receives it
    ↓
_tryEmitCE(ce5Bucket._last, spot5Bucket._last)
    ↓
Calculate: ratio = ceDelta / spotDelta
    ↓
_pushItem() - store bubble data
    ↓
draw() - render all bubbles on canvas
```

### Example 3: Option Chain Selection
```
User clicks CE strike button
    ↓
optSelectStrike() called
    ↓
Connect CE WebSocket (connectCEWS)
    ↓
Set selCEKey, selCEBtn
    ↓
Update UI display (oi-ce-strip)
    ↓
Load spot chart (loadSym)
    ↓
Subscribe to spot + CE feeds
    ↓
Data starts flowing, bubbles appear
```

---

## Important Patterns Used

### 1. **Guard Clauses**
```javascript
if (!lwChart) { showAlert('err', 'Chart not loaded'); return; }
if (!tokSaved) { showAlert('err', 'Token not saved'); return; }
```
→ Early exit prevents nested conditions

### 2. **Lazy Initialization**
```javascript
if (!lwChart && !initCharts()) return;
```
→ Create resource only when needed

### 3. **Batch Operations**
```javascript
candles.forEach(c => upsertCandle(c, true));  // bulk=true
_flushBulk();  // Single chart update
```
→ Much faster than individual updates

### 4. **State Synchronization**
```javascript
if (cMap[t] !== undefined) { cData[cMap[t]] = cd; }  // Update
else { cMap[t] = cData.length; cData.push(cd); }      // Insert
```
→ Maintain parallel data structures consistently

### 5. **Event Debouncing**
```javascript
const debounce = (fn, ms) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};
```
→ Prevent performance issues from rapid events

---

## Performance Considerations

### ✅ Good Practices
1. **Canvas rendering** - 60fps capable
2. **Batch inserts** - 1000s of candles in one chart.setData() call
3. **Data mapping** - O(1) lookups with cMap instead of searching
4. **Lazy load** - Chart only created when needed
5. **Bubble limit** - MAX=2000 prevents memory growth

### ⚠️ Potential Issues
1. **Large history loads** - 10,000+ candles might slow UI
2. **All bubbles drawn** - Canvas might strain with 2000+ bubbles
3. **Continuous canvas redraws** - Every tick = redraw (mitigated by debounce)
4. **Multiple WebSocket** - 3 simultaneous connections

### 🔧 Optimization Tips
- Add requestAnimationFrame batching
- Implement canvas dirty-rect culling
- Compress bubble data after X hours
- Implement LRU cache for historical data

---

## Common Development Tasks

### Add a New UI Button
```javascript
// 1. Add HTML element
// 2. Add onclick handler in HTML
// 3. Create handler function in ui.js
// 4. Update related state
// 5. Test with different connection states
```

### Add a New Chart Feature
```javascript
// 1. Ensure lwChart is initialized
// 2. Add series with lwChart.addXxxSeries()
// 3. Store reference in global state
// 4. Feed data via series.setData() or update()
// 5. Handle resize/redraw events
```

### Debug Data Flow
```javascript
// 1. Open browser DevTools (F12)
// 2. Check WebSocket messages: Network tab → WS
// 3. Add console.log() in ws.onmessage
// 4. Inspect global state in Console: config.js variables
// 5. Check chart data: window.cData
```

---

## Testing Checklist

- [ ] Connect/disconnect WebSocket
- [ ] Authenticate with token
- [ ] Switch between underlyings (NIFTY/BANKNIFTY/FINNIFTY)
- [ ] Change timeframes (1s/1m/5m/15m)
- [ ] Load historical data
- [ ] Select CE/PE strikes
- [ ] Toggle bubbles on/off
- [ ] Zoom/scroll chart
- [ ] Hover over bubbles (tooltip)
- [ ] Resize window (responsive test)
- [ ] Draw lines on chart
- [ ] Test on slow network (DevTools throttling)

---

## 🎯 Next Learning Steps

1. **Understand Message Format** - Inspect actual backend messages
2. **Experiment with Threshold** - Change bubMinRatioCE, bubMinRatioPE
3. **Modify Colors** - Change color pickers and see effect
4. **Add New Timeframe** - Add 30m to selIv options
5. **Create Data Export** - Add CSV export for analysis
6. **Add Indicators** - Plot moving averages on chart
7. **Implement Alerts** - Pop notification when bubble > threshold

---

## Resources

- **LightweightCharts Docs:** https://tradingview.github.io/lightweight-charts/
- **Upstox API:** https://developer.upstox.com
- **WebSocket Docs:** https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- **Canvas 2D Context:** https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D

