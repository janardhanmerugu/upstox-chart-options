// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET — Main connection for auth, spot data, and option chains
// Architecture: Single main WebSocket handles multiple message types
// ─────────────────────────────────────────────────────────────────────────────

function connectWS() {
  clearAlerts();  // Remove any old alert messages
  
  // Close existing connection if present (prevent duplicate connections)
  if (ws) ws.close();
  
  setStatus('connecting','CONNECTING…');

  try {
    // Establish WebSocket to backend server
    ws = new WebSocket(CONFIG.WEBSOCKET_URL);
  } catch(e) {
    // Connection creation failed (network issue, etc.)
    showAlert('err','⚠ WebSocket creation failed: ' + e.message, false);
    setStatus('err','ERROR');
    return;
  }

  // ── CONNECTION ESTABLISHED ────────────────────────────────────────────
  ws.onopen = () => {
    setStatus('authed','● CONNECTED');
    
    // Enable buttons that require connection
    document.getElementById('connectBtn').disabled    = true;
    document.getElementById('disconnectBtn').disabled = false;
    document.getElementById('saveTokenBtn').disabled  = false;
    
    showAlert('info','✅ Connected! Paste your token and click Save Token.');
    
    // Start TPS (Ticks Per Second) monitoring
    // Measures data flow rate from server
    if (tpsTmr) clearInterval(tpsTmr);
    tpsTmr = setInterval(() => {
      const el = document.getElementById('s-tps');
      if (el) el.textContent = tickCnt;  // Display ticks received in last second
      tickCnt = 0;  // Reset counter for next second
    }, CONFIG.TPS_INTERVAL_MS);
  };

  // ── MESSAGE HANDLER ────────────────────────────────────────────────────
  ws.onmessage = e => {
    let msg; 
    try { 
      msg = JSON.parse(e.data); 
    } catch(_) { 
      return;  // Ignore malformed messages
    }
    
    tickCnt++;  // Increment tick counter for TPS monitoring
    const t = msg.type;

    // ── AUTH RESPONSE ──────────────────────────────────────────────────
    if (t === 'auth_ok') {
      setTok(true,'✅ Token accepted!');
      setStatus('live','● READY');
      showAlert('ok','✅ Token saved! Pick underlying & click ⬇ Load Chain');
      
      // Enable history button now that auth is successful
      const histBtn = document.getElementById('hist-btn');
      if (histBtn) histBtn.disabled = false;
      
      optOnAuthOk();  // Trigger option chain UI updates
    }
    else if (t === 'auth_fail') { 
      setTok(false,'❌ '+msg.message); 
      showAlert('err','⚠ '+msg.message, false); 
    }

    // ── INITIAL DATA LOAD (called when new symbol subscribed) ────────────
    else if (t === 'init') {
      if (msg.candles && msg.candles.length > 0) {
        if (!lwChart && !initCharts()) return;  // Initialize chart if needed
        aggBucket = null;
        
        // Batch-load historical candles
        msg.candles.forEach(c => upsertCandle(aggCandle(c), true));
        _flushBulk();  // Push all accumulated candles to chart in one setData() call

        // Flush all candles to chart in one operation
        setTimeout(() => {
          BUB.clear();
          lwChart.timeScale().fitContent();  // Auto-zoom to show all data
          requestAnimationFrame(() => BUB.draw());
        }, 120);
        
        // Update ticker display with latest candle
        updateTicker(msg.candles[msg.candles.length-1], msg.symbol || '');
        document.getElementById('s-iv').textContent = ivLabel(selIv);
      }
    }

    // ── SWITCHING SYMBOLS (transitioning between different instruments) ───
    else if (t === 'switching') {
      clearAlerts();
      if (!initCharts()) return;
      BUB.clear();
      aggBucket = null;
      showAlert('info',`🔄 Switching to ${msg.symbol} @ ${ivLabel(selIv)}…`);
      document.getElementById('s-sym').textContent     = msg.symbol;
      document.getElementById('s-iv').textContent      = ivLabel(selIv);
      document.getElementById('sym-disp').textContent  = msg.symbol;
    }

    // ── LIVE STATUS UPDATES ────────────────────────────────────────────
    else if (t === 'status') {
      if (msg.status === 'connected') {
        clearAlerts();
        showAlert('ok',`✅ Live: ${msg.symbol} @ ${ivLabel(selIv)}`);
        document.getElementById('s-sym').textContent = msg.symbol;
        document.getElementById('s-iv').textContent  = ivLabel(selIv);
        setStatus('live','● LIVE');
      } 
      else if (msg.status === 'error') {
        showAlert('err','⚠ Feed error: '+msg.message, false);
      } 
      else if (msg.status === 'auth_error') {
        // Token expired (usually daily expiry with Upstox)
        setStatus('err','⚠ TOKEN EXPIRED');
        setTok(false,'❌ Token expired — get a new token from developer.upstox.com');
        showAlert('err','🔑 Token rejected (403). Get a fresh token.',false);
      } 
      else if (msg.status === 'reconnecting') {
        setStatus('connecting','RECONNECTING…');
        showAlert('warn','🔄 '+msg.message, false);
      }
    }

    // ── LIVE CANDLE (new 1-second candle arriving) ─────────────────────
    else if (t === 'candle') {
      if (!lwChart && !initCharts()) return;
      
      // Aggregate raw candle if needed
      const chartCandle = aggCandle(msg.candle);
      
      // Add/update chart
      upsertCandle(chartCandle, false);
      updateTicker(chartCandle, msg.instrument);
      
      // Feed to bubbles system (for CE/PE calculations)
      BUB.pushSpot5s(msg.candle);
      
      // Auto-scroll to latest if in live mode
      if (_atRealTime) lwChart.timeScale().scrollToRealTime();
      
      requestAnimationFrame(() => BUB.draw());
    }

    // ── TICK (Last Trade Price update, between candles) ────────────────
    else if (t === 'tick') {
      if (!lwChart && !initCharts()) return;
      updateLTP(msg.ltp);  // Update single price value
      
      // Update timestamp
      const lastEl = document.getElementById('s-last');
      if (lastEl) lastEl.textContent = fT(msg.ltt);
      
      // If mid-candle data available, update display
      if (msg.current_candle) {
        const chartCandle = aggCandle(msg.current_candle);
        upsertCandle(chartCandle, false);
        updateTicker(chartCandle, msg.instrument);
      }
    }

    else if (t === 'history_loading') {
      clearAlerts();
      if (!initCharts()) return;
      BUB.clear();
      const histStatus = document.getElementById('hist-status');
      if (histStatus) histStatus.textContent = '⏳ Fetching…';
      showAlert('info',`🔄 Loading history: ${msg.symbol} @ ${msg.unit}…`);
    }
    else if (t === 'history_data')  { renderHistory(msg.candles, msg.symbol, msg.unit); }
    else if (t === 'history_error') {
      const histStatus = document.getElementById('hist-status');
      if (histStatus) histStatus.textContent = '⚠ Error';
      const histBtn = document.getElementById('hist-btn');
      if (histBtn) histBtn.disabled = false;
      showAlert('err','⚠ '+msg.message, false);
    }

    else if (t === 'option_expiries')       { onOptExpiries(msg); }
    else if (t === 'option_expiries_error') { onOptError(msg.message || 'Expiry fetch failed'); }
    else if (t === 'option_chain')          { onOptChain(msg); }
    else if (t === 'option_chain_error')    { onOptError(msg.message || 'Chain fetch failed'); }

    else if (t === 'saved_list') {
      const sel     = document.getElementById('csv-instrument');
      const selDate = document.getElementById('csv-date').value;
      sel.innerHTML = '<option value="">— select instrument —</option>';
      const filtered = (msg.datasets || []).filter(d => d.date === selDate && d.has_candles);
      if (filtered.length === 0) {
        sel.innerHTML = '<option value="">No candles for this date</option>';
      } else {
        filtered.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.instrument;
          opt.textContent = d.instrument.split('/').pop();
          sel.appendChild(opt);
        });
      }
    }

    else if (t === 'csv_data') {
      if (!msg.candles || msg.candles.length === 0) {
        document.getElementById('csv-candle-status').textContent = '⚠ No candles found'; return;
      }
      if (!lwChart && !initCharts()) return;
      cData=[]; vData=[]; cMap={};
      BUB.clear();
      aggBucket = null;
      msg.candles.forEach(c => {
        const agg = aggCandle(c);
        if (agg) upsertCandle(agg, true);
      });
      if (aggBucket) { upsertCandle(aggBucket, true); aggBucket = null; }
      _flushBulk();
      setTimeout(() => { lwChart.timeScale().fitContent(); requestAnimationFrame(() => BUB.draw()); }, 100);
      updateTicker(msg.candles[msg.candles.length-1], msg.label || '');
      document.getElementById('csv-candle-status').textContent = `✅ ${cData.length} candles (${ivLabel(selIv)})`;
    }

    else if (t === 'bubble_list') {
      const files = msg.files || [];
      const sel   = document.getElementById('offline-bub-strike');
      if (!sel) return;
      sel.innerHTML = '<option value="">— select strike —</option>';
      if (files.length === 0) {
        sel.innerHTML = '<option value="">No bubble files for this date</option>';
      } else {
        files.forEach(f => {
          const opt = document.createElement('option');
          opt.value = JSON.stringify({ opt_type: f.opt_type, strike: f.strike });
          opt.textContent = `${f.opt_type}  ${f.strike}`;
          sel.appendChild(opt);
        });
      }
      const statusEl = document.getElementById('offline-bub-status');
      if (statusEl) statusEl.textContent = files.length ? `${files.length} file(s) found` : 'No files';
    }

    else if (t === 'bubble_data') {
      const items    = msg.items || [];
      const statusEl = document.getElementById('offline-bub-status');
      const append   = document.getElementById('offline-bub-append')?.checked;

      if (!append) BUB.clear();

      items.forEach(item => {
        // Recalculate chartTime for current selIv
        item.chartTime = (selIv === 60 || selIv === 300 || selIv === 900)
          ? Math.floor(item.time / selIv) * selIv
          : item.time;
        if (BUB.items.length >= BUB.MAX) BUB.items.shift();
        BUB.items.push(item);
      });

      const el = document.getElementById('s-bubs');
      if (el) el.textContent = BUB.items.length;
      requestAnimationFrame(() => BUB.draw());

      if (statusEl) statusEl.textContent =
        `✅ ${items.length} bubbles loaded (${msg.opt_type} ${msg.strike} ${msg.date})`;
      showAlert('ok', `✅ ${items.length} offline bubbles loaded — ${msg.opt_type} ${msg.strike}`);
    }

    else if (t === 'error') { showAlert('err','⚠ '+msg.message, false); }
  };

  ws.onerror = () => {
    setStatus('err','ERROR');
    showAlert('err',`⚠ Cannot connect to ${CONFIG.WEBSOCKET_URL}\n→ Start server first, then retry.`, false);
  };

  ws.onclose = () => {
    try {
      setStatus('idle','DISCONNECTED');
      document.getElementById('connectBtn').disabled    = false;
      document.getElementById('disconnectBtn').disabled = true;
      document.getElementById('saveTokenBtn').disabled  = true;
      if (tpsTmr) { clearInterval(tpsTmr); tpsTmr = null; }
      const tpsEl = document.getElementById('s-tps');
      if (tpsEl) tpsEl.textContent = '—';
      tokSaved = false; setTok(null,'Disconnected.');
    } catch(e) { console.error('Disconnect handler error:', e); }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CE / PE WEBSOCKETS — separate connections feeding ce5Bucket and pe5Bucket
// ─────────────────────────────────────────────────────────────────────────────
function _makeOptWS(instrKey, onCandle) {
  if (!tokSaved || !instrKey) return null;
  const s = new WebSocket(CONFIG.WEBSOCKET_URL);
  s.onopen = () => {
    const tok = document.getElementById('token-input').value.trim();
    s.send(JSON.stringify({ type: 'auth', token: tok }));
  };
  s.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch(_) { return; }
    if (msg.type === 'auth_ok') {
      const backendIv = (selIv === 60 || selIv === 300 || selIv === 900) ? 1 : selIv;
      s.send(JSON.stringify({ type: 'subscribe', symbol: instrKey, interval: backendIv }));
    } else if (msg.type === 'candle') {
      onCandle(msg.candle);
    }
  };
  s.onerror = () => {};
  s.onclose = () => {};
  return s;
}

function connectCEWS(instrKey) {
  if (wsCE) { try { wsCE.close(); } catch(_){} wsCE = null; }
  wsCE = _makeOptWS(instrKey, c => BUB.pushCE5s(c));
}

function connectPEWS(instrKey) {
  if (wsPE) { try { wsPE.close(); } catch(_){} wsPE = null; }
  wsPE = _makeOptWS(instrKey, c => BUB.pushPE5s(c));
}

function sanitizeLatin1String(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2018/g, "'")
    .replace(/\u2019/g, "'")
    .replace(/\u201c/g, '"')
    .replace(/\u201d/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/[^\x00-\xFF]/g, '?');
}

// ─────────────────────────────────────────────────────────────────────────────
// BUBBLE PERSISTENCE — server-side save / load
// ─────────────────────────────────────────────────────────────────────────────

// Called from BUB._pushItem() every time a bubble is emitted during live feed.
// Sends the item to server for appending to today's JSONL file.
// No reply expected — fire and forget.
function wsSaveBubble(item) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'save_bubble', item }));
}

// Ask server for the list of saved bubble files for a given date.
// Response arrives as {type:'bubble_list', date, files:[{opt_type,strike,path_rel}]}
function wsListBubbles(dateStr) {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showAlert('err','⚠ Connect first.'); return; }
  ws.send(JSON.stringify({ type: 'list_bubbles', date: dateStr }));
}

// Load a specific bubble file from server into BUB.items[].
// opt_type = 'CE'|'PE', strike = filename stem (e.g. 'NSE_FO_52345')
function wsLoadBubbles(dateStr, optType, strike) {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showAlert('err','⚠ Connect first.'); return; }
  const statusEl = document.getElementById('offline-bub-status');
  if (statusEl) statusEl.textContent = '⏳ Loading…';
  ws.send(JSON.stringify({ type: 'load_bubbles', date: dateStr, opt_type: optType, strike }));
}

function disconnectWS() {
  // Close all three WebSocket connections
  if (ws)   { try { ws.close();   } catch(_){} ws   = null; }
  if (wsCE) { try { wsCE.close(); } catch(_){} wsCE = null; }
  if (wsPE) { try { wsPE.close(); } catch(_){} wsPE = null; }
  
  // Reset bubble accumulators
  ce5Bucket   = { cur: null, _last: null };
  pe5Bucket   = { cur: null, _last: null };
  spot5Bucket = { cur: null, _last: null };
  
  // Update UI to show disconnected state
  setStatus('idle', 'DISCONNECTED');
  document.getElementById('connectBtn').disabled    = false;
  document.getElementById('disconnectBtn').disabled = true;
  document.getElementById('saveTokenBtn').disabled  = true;
  
  // Stop TPS monitoring timer
  if (tpsTmr) { clearInterval(tpsTmr); tpsTmr = null; }
  const tpsEl = document.getElementById('s-tps');
  if (tpsEl) tpsEl.textContent = '—';
  
  // Clear auth state
  tokSaved = false;
  setTok(null, 'Disconnected.');
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV LOADERS — candles only (bubble save/load removed)
// ─────────────────────────────────────────────────────────────────────────────
function _ensureWSForCSV(onReady) {
  if (ws && ws.readyState === WebSocket.OPEN) { onReady(); return; }
  const tmpWS = new WebSocket(CONFIG.WEBSOCKET_URL);
  tmpWS.onopen = () => {
    ws = tmpWS;
    setStatus('authed','● CONNECTED');
    document.getElementById('connectBtn').disabled    = true;
    document.getElementById('disconnectBtn').disabled = false;
    document.getElementById('saveTokenBtn').disabled  = false;
    if (!tpsTmr) tpsTmr = setInterval(() => {
      const el = document.getElementById('s-tps');
      if (el) el.textContent = tickCnt; tickCnt = 0;
    }, 1000);
    onReady();
  };
  tmpWS.onerror = () => {
    showAlert('err','⚠ Cannot connect to '+CONFIG.WEBSOCKET_URL+'\n→ Start server first.', false);
  };
  tmpWS.onclose = () => {
    if (ws === tmpWS) {
      ws = null;
      setStatus('idle','DISCONNECTED');
      document.getElementById('connectBtn').disabled    = false;
      document.getElementById('disconnectBtn').disabled = true;
      document.getElementById('saveTokenBtn').disabled  = true;
      if (tpsTmr) { clearInterval(tpsTmr); tpsTmr = null; }
      tokSaved = false;
      setTok(null, 'Disconnected.');
    }
  };
  tmpWS.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch(_) { return; }
    tickCnt++;
    const t = msg.type;
    if (t === 'saved_list') {
      const sel = document.getElementById('csv-instrument');
      const selDate = document.getElementById('csv-date').value;
      sel.innerHTML = '<option value="">— select instrument —</option>';
      const filtered = (msg.datasets || []).filter(d => d.date === selDate && d.has_candles);
      if (filtered.length === 0) { sel.innerHTML = '<option value="">No candles for this date</option>'; }
      else { filtered.forEach(d => { const opt=document.createElement('option'); opt.value=d.instrument; opt.textContent=d.instrument.split('/').pop(); sel.appendChild(opt); }); }
    }
    else if (t === 'csv_data') {
      if (!msg.candles || msg.candles.length === 0) { document.getElementById('csv-candle-status').textContent='⚠ No candles found'; return; }
      if (!lwChart && !initCharts()) return;
      cData=[]; vData=[]; cMap={}; BUB.clear(); aggBucket=null;
      msg.candles.forEach(c => { const agg=aggCandle(c); if(agg) upsertCandle(agg,true); });
      if (aggBucket) { upsertCandle(aggBucket,true); aggBucket=null; }
      _flushBulk();
      setTimeout(() => { lwChart.timeScale().fitContent(); requestAnimationFrame(()=>BUB.draw()); }, 100);
      updateTicker(msg.candles[msg.candles.length-1], msg.label||'');
      document.getElementById('csv-candle-status').textContent=`✅ ${cData.length} candles (${ivLabel(selIv)})`;
    }
  };
}

function csvDateChanged() {
  const d = document.getElementById('csv-date').value;
  if (!d) return;
  const candleStatus = document.getElementById('csv-candle-status');
  if (candleStatus) candleStatus.textContent = '';
  // Reset bubble strike dropdown when date changes
  const bubSel = document.getElementById('offline-bub-strike');
  if (bubSel) bubSel.innerHTML = '<option value="">— loading… —</option>';
  const bubStatus = document.getElementById('offline-bub-status');
  if (bubStatus) bubStatus.textContent = '';
  _ensureWSForCSV(() => {
    ws.send(JSON.stringify({ type: 'list_saved', date: d }));
    ws.send(JSON.stringify({ type: 'list_bubbles', date: d }));
  });
}

function loadCandlesCSV() {
  const d = document.getElementById('csv-date').value;
  const i = document.getElementById('csv-instrument').value;
  if (!d || !i) { document.getElementById('csv-candle-status').textContent = '⚠ Pick date + instrument'; return; }
  document.getElementById('csv-candle-status').textContent = '⏳ Loading…';
  _ensureWSForCSV(() => {
    ws.send(JSON.stringify({ type: 'load_csv', date: d, instrument: i, load: 'candles' }));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTION CHAIN WS HANDLERS
// ─────────────────────────────────────────────────────────────────────────────
function optFetchExpiries() {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showAlert('err','⚠ Connect first.'); return; }
  const underlying = OPT_INDEX_KEY[optUL];
  if (!underlying) { showAlert('warn','⚠ Pick an underlying first.'); return; }
  document.getElementById('opt-chain-status').textContent = '⏳ Fetching expiries…';
  ws.send(JSON.stringify({ type: 'get_option_expiries', underlying: sanitizeLatin1String(underlying) }));
}

async function optFetchChain() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !tokSaved) {
    showAlert('err','⚠ Connect & save token first.'); return;
  }
  const exp = document.getElementById('opt-expiry').value;
  if (!exp) { showAlert('warn','⚠ Select an expiry first.'); return; }

  document.getElementById('opt-fetch-btn').disabled = true;
  document.getElementById('opt-chain-status').textContent = '⏳ Loading option chain…';
  document.getElementById('opt-strikes').innerHTML = '';
  document.getElementById('opt-strikes-row').style.display = 'none';

  // Fetch live spot from Upstox REST
  const spotKey = OPT_INDEX_KEY[optUL] || selSym;
  let spotHint  = null;
  const token   = document.getElementById('token-input').value.trim();
  if (token) {
    try {
      const resp = await fetch(
        `https://api.upstox.com/v2/market-quote/ltp?instrument_key=${encodeURIComponent(spotKey)}`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } }
      );
      const data = await resp.json();
      for (const v of Object.values(data?.data || {})) {
        const price = v?.last_price ?? v?.ltp;
        if (price && parseFloat(price) > 100) { spotHint = parseFloat(price); break; }
      }
    } catch(e) { console.warn('Browser spot fetch failed:', e); }
  }
  if (!spotHint) {
    const ltpVal = parseFloat((document.getElementById('t-ltp').textContent || '').replace(/,/g,''));
    if (ltpVal > 100) spotHint = ltpVal;
  }

  ws.send(JSON.stringify({
    type: 'get_option_chain',
    underlying: sanitizeLatin1String(spotKey),
    expiry: sanitizeLatin1String(exp),
    spot_hint: spotHint
  }));
}

function onOptExpiries(msg) {
  const expiries = msg.expiries || [];
  optExpiries = expiries;
  const sel = document.getElementById('opt-expiry');
  sel.innerHTML = '<option value="">— select expiry —</option>';
  expiries.forEach(e => {
    const opt = document.createElement('option');
    opt.value = e; opt.textContent = e;
    sel.appendChild(opt);
  });
  if (expiries.length > 0) sel.value = expiries[0];
  document.getElementById('opt-fetch-btn').disabled = false;
  document.getElementById('opt-chain-status').textContent =
    `${expiries.length} expiries loaded  →  Click ⬇ Load Chain`;
}

function onOptChain(msg) {
  optChain = msg;
  document.getElementById('opt-fetch-btn').disabled = false;
  optBuildStrikes();
}

function onOptError(msg) {
  document.getElementById('opt-fetch-btn').disabled = false;
  document.getElementById('opt-chain-status').textContent = '⚠ ' + msg;
  showAlert('err','⚠ Option chain error: ' + msg, false);
}

function optOnAuthOk() {
  document.getElementById('opt-chain-status').textContent = 'Token ready → select underlying & Load Chain';
  optFetchExpiries();
}
