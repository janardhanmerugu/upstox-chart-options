// ─────────────────────────────────────────────────────────────────────────────
// CHART INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────
function initCharts() {
  if (typeof LightweightCharts === 'undefined') { showAlert('err','Chart library not loaded.'); return false; }
  document.getElementById('placeholder').style.display = 'none';
  if (lwChart) { try { lwChart.remove(); } catch(_) {} lwChart = null; }
  cData=[]; vData=[]; cMap={};
  _atRealTime = true;

  const theme = {
    layout:          { background: { color: '#111826' }, textColor: '#5a7a9a' },
    grid:            { vertLines: { color: '#1a2535' }, horzLines: { color: '#1a2535' } },
    timeScale:       { borderColor: '#1e2d42', timeVisible: true, secondsVisible: true,
                       shiftVisibleRangeOnNewBar: false, lockVisibleTimeRangeOnResize: true },
    rightPriceScale: { borderColor: '#1e2d42' },
    crosshair:       { mode: crosshairMagnet ? 1 : 0 },
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

  const cc  = document.getElementById('lw-chart');
  const con = document.getElementById('chart-con');
  const mainW = Math.max(con.clientWidth,  200);
  const mainH = Math.max(con.clientHeight, 200);

  lwChart = LightweightCharts.createChart(cc, { ...theme, width: mainW, height: mainH });
  cSeries = lwChart.addCandlestickSeries({
    upColor:        '#26a69a', downColor:        '#7b5ea7',
    borderUpColor:  '#26a69a', borderDownColor:  '#7b5ea7',
    wickUpColor:    '#26a69a', wickDownColor:    '#7b5ea7',
    priceScaleId: 'right',
  });

  vSeries = lwChart.addHistogramSeries({
    color: '#00d4ff44',
    priceFormat: { type: 'volume' },
    priceScaleId: 'vol',
  });
  lwChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.88, bottom: 0 }, visible: false });
  cSeries.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.20 } });

  lwChart.timeScale().subscribeVisibleLogicalRangeChange(() => { BUB.draw(); });
  lwChart.subscribeCrosshairMove(() => BUB.draw());

  BUB.mount();

  _atRealTime = true;
  cc.addEventListener('mousedown',  () => { setLiveMode(false); });
  cc.addEventListener('touchstart', () => { setLiveMode(false); }, { passive: true });

  const wrap = document.getElementById('chart-wrap');
  if (!wrap._ro) {
    wrap._ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const el = entry.target;
        if (el.id === 'chart-con' && lwChart) {
          lwChart.resize(Math.max(el.clientWidth, 200), Math.max(el.clientHeight, 200));
        }
      }
      BUB.sync(); BUB.draw();
    });
    wrap._ro.observe(con);
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT-SIDE CANDLE AGGREGATOR
// When selIv=60/300/900: groups 1s raw candles into minute buckets for display.
// ─────────────────────────────────────────────────────────────────────────────
function aggCandle(raw) {
  if (selIv !== 60 && selIv !== 300 && selIv !== 900) return raw;

  const bucketTime = Math.floor(raw.time / selIv) * selIv;

  if (!aggBucket || aggBucket.time !== bucketTime) {
    aggBucket = {
      time:   bucketTime,
      open:   raw.open,
      high:   raw.high,
      low:    raw.low,
      close:  raw.close,
      volume: raw.volume || 0,
    };
  } else {
    aggBucket.high   = Math.max(aggBucket.high, raw.high);
    aggBucket.low    = Math.min(aggBucket.low,  raw.low);
    aggBucket.close  = raw.close;
    aggBucket.volume = (aggBucket.volume || 0) + (raw.volume || 0);
  }
  return aggBucket;
}

// ─────────────────────────────────────────────────────────────────────────────
// UPSERT CANDLE
// bulk=true → accumulate into arrays only (caller must call _flushBulk after)
// bulk=false → live tick → update() only, then redraw bubbles
// ─────────────────────────────────────────────────────────────────────────────
function upsertCandle(c, bulk) {
  if (!cSeries) return;
  const t  = c.time + IST_OFFSET_S;
  const cd = { time: t, open: c.open, high: c.high, low: c.low, close: c.close };
  const vd = { time: t, value: c.volume, color: c.close >= c.open ? '#26a69a44' : '#7b5ea744' };
  if (cMap[t] !== undefined) { cData[cMap[t]] = cd; vData[cMap[t]] = vd; }
  else { cMap[t] = cData.length; cData.push(cd); vData.push(vd); }
  if (!bulk) {
    // Live tick — patch single candle, no viewport reset
    cSeries.update(cd);
    vSeries.update(vd);
    document.getElementById('s-bars').textContent = cData.length;
    requestAnimationFrame(() => BUB.draw());
  }
  // bulk=true: arrays updated in-place; caller calls _flushBulk() once after the loop
}

// Call once after a bulk-load loop to push all candles to the chart in one shot
function _flushBulk() {
  if (!cSeries) return;
  cSeries.setData(cData);
  vSeries.setData(vData);
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
