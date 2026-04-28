// ─────────────────────────────────────────────────────────────────────────────
// CHART INITIALIZATION
// Creates and configures the LightweightCharts library with custom theme and events
// ─────────────────────────────────────────────────────────────────────────────
function initCharts() {
  // SAFETY: Check if charting library is loaded in HTML
  if (typeof LightweightCharts === 'undefined') { 
    showAlert('err','Chart library not loaded.'); 
    return false; 
  }
  
  // Hide the "loading placeholder" element when chart is ready
  document.getElementById('placeholder').style.display = 'none';
  
  // ── CLEANUP: Remove old chart instance if exists ────────────────────────
  // Prevents memory leaks when reinitializing chart
  if (lwChart) { 
    try { lwChart.remove(); } catch(_) {} 
    lwChart = null; 
  }
  
  // ── RESET: Clear all stored candle and volume data ──────────────────────
  cData=[]; vData=[]; cMap={};
  _atRealTime = true;

  // ── THEME: Dark mode styling for the chart ────────────────────────────
  // Colors chosen for low eye strain in trading environments
  const theme = {
    // Background and text colors
    layout: { 
      background: { color: '#111826' },      // Very dark navy
      textColor: '#5a7a9a'                   // Muted blue-gray
    },
    
    // Grid lines (market structure guides)
    grid: { 
      vertLines: { color: '#1a2535' },       // Vertical price gridlines
      horzLines: { color: '#1a2535' }        // Horizontal time gridlines
    },
    
    // Time scale customization (bottom ruler showing dates/times)
    timeScale: { 
      borderColor: '#1e2d42', 
      timeVisible: true,                     // Show time (HH:MM:SS)
      secondsVisible: true,                  // Show seconds precision
      shiftVisibleRangeOnNewBar: false,      // Don't auto-scroll on new candle
      lockVisibleTimeRangeOnResize: true     // Keep viewport during resize
    },
    
    // Right price scale (price axis)
    rightPriceScale: { borderColor: '#1e2d42' },
    
    // Crosshair behavior - magnet mode snaps to price levels
    crosshair: { mode: crosshairMagnet ? 1 : 0 },
    
    // Custom time formatting (shows exact timestamp on chart)
    localization: {
      timeFormatter: (ts) => {
        const d  = new Date(ts * 1000);
        const hh = String(d.getUTCHours()).padStart(2,'0');
        const mm = String(d.getUTCMinutes()).padStart(2,'0');
        const ss = String(d.getUTCSeconds()).padStart(2,'0');
        const dd = d.getUTCDate(), mo = d.getUTCMonth()+1, yy = d.getUTCFullYear();
        return `${dd}/${mo}/${yy} ${hh}:${mm}:${ss} IST`;
      },
    },
  };

  // ── CREATE CHART CONTAINER ────────────────────────────────────────────
  const cc  = document.getElementById('lw-chart');
  const con = document.getElementById('chart-con');
  const mainW = Math.max(con.clientWidth,  200);
  const mainH = Math.max(con.clientHeight, 200);

  // Initialize the chart with theme and dimensions
  lwChart = LightweightCharts.createChart(cc, { ...theme, width: mainW, height: mainH });
  
  // ── CANDLESTICK SERIES (Main OHLC data) ────────────────────────────────
  cSeries = lwChart.addCandlestickSeries({
    upColor:        '#26a69a',               // Green when close > open (bullish)
    downColor:      '#7b5ea7',               // Purple when close < open (bearish)
    borderUpColor:  '#26a69a',
    borderDownColor:'#7b5ea7',
    wickUpColor:    '#26a69a',               // High-low range indicator
    wickDownColor:  '#7b5ea7',
    priceScaleId: 'right',                   // Use right-side price axis
  });

  // ── VOLUME HISTOGRAM (Below candlesticks) ──────────────────────────────
  vSeries = lwChart.addHistogramSeries({
    color: '#00d4ff44',                      // Cyan with transparency
    priceFormat: { type: 'volume' },         // Format as volume (no decimals)
    priceScaleId: 'vol',                     // Separate volume scale
  });
  
  // Configure volume scale (small area at bottom, invisible label)
  lwChart.priceScale('vol').applyOptions({ 
    scaleMargins: { top: 0.88, bottom: 0 },  // 88% top margin = 12% height
    visible: false 
  });
  
  // Configure price scale with margins for candles and volume
  cSeries.priceScale().applyOptions({ 
    scaleMargins: { top: 0.05, bottom: 0.20 }  // 5% top, 20% bottom for volume
  });

  // ── EVENT LISTENERS ────────────────────────────────────────────────────
  // Redraw bubbles when viewport changes (scroll, zoom)
  lwChart.timeScale().subscribeVisibleLogicalRangeChange(() => { BUB.draw(); });
  
  // Redraw bubbles when crosshair moves (follows mouse)
  lwChart.subscribeCrosshairMove(() => BUB.draw());

  // Initialize bubble overlay on the chart
  BUB.mount();

  _atRealTime = true;
  
  // Exit "live mode" when user interacts with chart (enables manual exploration)
  cc.addEventListener('mousedown',  () => { setLiveMode(false); });
  cc.addEventListener('touchstart', () => { setLiveMode(false); }, { passive: true });

  // ── RESPONSIVE RESIZE ──────────────────────────────────────────────────
  // Detect window resize and update chart dimensions
  const wrap = document.getElementById('chart-wrap');
  if (!wrap._ro) {
    wrap._ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const el = entry.target;
        if (el.id === 'chart-con' && lwChart) {
          lwChart.resize(Math.max(el.clientWidth, 200), Math.max(el.clientHeight, 200));
        }
      }
      BUB.sync(); BUB.draw();  // Redraw bubbles after resize
    });
    wrap._ro.observe(con);
  }
  
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT-SIDE CANDLE AGGREGATOR
// Groups 1-second raw candles into minute buckets (1m/5m/15m) for display
// This reduces visual noise while keeping backend focused on raw data
// ─────────────────────────────────────────────────────────────────────────────
function aggCandle(raw) {
  // Only aggregate if user selected a larger timeframe (60s, 300s, or 900s)
  if (selIv !== 60 && selIv !== 300 && selIv !== 900) 
    return raw;  // Return raw 1s candle unchanged

  // Calculate bucket start time (e.g., 9:30:00, 9:30:60, 9:31:00, etc.)
  // Example: raw.time=1625 with selIv=300 → bucketTime=1500 (starts 5m bucket)
  const bucketTime = Math.floor(raw.time / selIv) * selIv;

  // If new bucket detected, save old one and start fresh
  if (!aggBucket || aggBucket.time !== bucketTime) {
    aggBucket = {
      time:   bucketTime,
      open:   raw.open,      // First 1s candle's open
      high:   raw.high,      // Highest high in bucket
      low:    raw.low,       // Lowest low in bucket
      close:  raw.close,     // Current close (will update)
      volume: raw.volume || 0,
    };
  } else {
    // Still in same bucket → update aggregates
    aggBucket.high   = Math.max(aggBucket.high, raw.high);
    aggBucket.low    = Math.min(aggBucket.low,  raw.low);
    aggBucket.close  = raw.close;  // Close moves to latest value
    aggBucket.volume = (aggBucket.volume || 0) + (raw.volume || 0);
  }
  
  return aggBucket;
}

// ─────────────────────────────────────────────────────────────────────────────
// UPSERT CANDLE
// Adds or updates a candle in the chart
// bulk=true → accumulate into arrays only (for batch loading - faster)
// bulk=false → live tick → update() only, then redraw bubbles
// ─────────────────────────────────────────────────────────────────────────────
function upsertCandle(c, bulk) {
  if (!cSeries) return;
  
  // Add IST offset to timestamp for display purposes
  const t  = c.time + IST_OFFSET_S;
  
  // Create candle data object
  const cd = { time: t, open: c.open, high: c.high, low: c.low, close: c.close };
  
  // Create volume data object with color-coding
  const vd = { 
    time: t, 
    value: c.volume, 
    color: c.close >= c.open ? '#26a69a44' : '#7b5ea744'  // Green if up, purple if down
  };
  
  // Check if this candle already exists (update vs insert)
  if (cMap[t] !== undefined) { 
    // EXISTING: Update both arrays
    cData[cMap[t]] = cd; 
    vData[cMap[t]] = vd; 
  } else { 
    // NEW: Add to end and update map for future lookups
    cMap[t] = cData.length;  // Remember its position
    cData.push(cd); 
    vData.push(vd); 
  }
  
  // Only push to chart if NOT in bulk mode
  if (!bulk) {
    // Live tick — patch single candle into chart (no viewport reset)
    cSeries.update(cd);
    vSeries.update(vd);
    
    // Update UI with current candle count
    document.getElementById('s-bars').textContent = cData.length;
    
    // Schedule bubble redraw on next frame (smooth animation)
    requestAnimationFrame(() => BUB.draw());
  }
  // If bulk=true: arrays updated in-place; caller must call _flushBulk() after loop
}

// Call once after a bulk-load loop to push all accumulated candles to chart
function _flushBulk() {
  if (!cSeries) return;
  
  // Single batch call to chart (faster than individual updates)
  cSeries.setData(cData);
  vSeries.setData(vData);
  
  // Update UI
  document.getElementById('s-bars').textContent = cData.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// HISTORY LOADER
// ─────────────────────────────────────────────────────────────────────────────
function renderHistory(candles, symbol, unit) {
  if (!candles || candles.length === 0) {
    showAlert('warn','⚠ No candles returned.', false);
    document.getElementById('hist-status').textContent = '0 candles';
    document.getElementById('hist-btn').disabled = false;
    return;
  }
  if (!lwChart && !initCharts()) return;

  cData=[]; vData=[]; cMap={};
  BUB.clear(); aggBucket = null;
  candles.forEach(c => upsertCandle(c, true));  // accumulate only — no setData yet
  _flushBulk();                                  // single setData call

  setTimeout(() => {
    lwChart.timeScale().fitContent();
    requestAnimationFrame(() => BUB.draw());
  }, 100);

  updateTicker(candles[candles.length-1], symbol);
  document.getElementById('s-sym').textContent    = symbol;
  document.getElementById('s-iv').textContent     = unit;
  document.getElementById('sym-disp').textContent = symbol;
  document.getElementById('hist-status').textContent = `✅ ${candles.length} candles`;
  document.getElementById('hist-btn').disabled = false;
  showAlert('ok', `✅ Loaded ${candles.length} ${unit} candles for ${symbol}`);
}
