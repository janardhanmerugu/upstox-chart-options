// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET — Main connection for auth, spot data, and option chains
// Architecture: Single main WebSocket handles multiple message types
// ─────────────────────────────────────────────────────────────────────────────

function resolvedWebSocketUrl() {
  const configured = CONFIG.WEBSOCKET_URL;
  return window.location.protocol === 'https:' && configured.startsWith('ws://')
    ? 'wss://chronicle-expect-something-administered.trycloudflare.com/ws'
    : configured;
}

function connectWS() {
  clearAlerts();  // Remove any old alert messages
  
  // Close existing connection if present (prevent duplicate connections)
  if (ws) ws.close();
  
  setStatus('connecting','CONNECTING…');
  const socketUrl = resolvedWebSocketUrl();

  try {
    // Establish WebSocket to backend server
    ws = new WebSocket(socketUrl);
  } catch(e) {
    // Connection creation failed (network issue, etc.)
    showAlert('err','⚠ WebSocket creation failed: ' + e.message + '\n→ Check the server, cloud URL, and network access.', false);
    setStatus('err','ERROR');
    return;
  }

  const socket = ws;

  // ── CONNECTION ESTABLISHED ────────────────────────────────────────────
  socket.onopen = () => {
    setStatus('authed','● CONNECTED');
    setTok(null,'✅ Connected! Paste your token and click Save Token.');
    
    // Enable buttons that require connection
    document.getElementById('connectBtn').disabled    = true;
    document.getElementById('disconnectBtn').disabled = false;
    document.getElementById('saveTokenBtn').disabled  = false;
    
    showAlert('info','✅ Connected! Paste your token and click Save Token.', false);
    
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
  socket.onmessage = e => {
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
      
      optOnAuthOk();  // Trigger option chain UI updates
    }
    else if (t === 'auth_fail') { 
      setTok(false,'❌ '+msg.message); 
      showAlert('err','⚠ '+msg.message, false); 
    }

    else if (t === 'open_interest_data') {
      OIB.setData(msg.bubbles || []);
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

    // ── HISTORY-FIRST INDEX LOAD ────────────────────────────────────────
    // Render stored candles before opening the live subscription. The server
    // already exposes this endpoint for the futures chart workflow.
    else if (t === 'symbol_history') {
      if (msg.instrument !== selSym) return;
      if (!lwChart && !initCharts()) return;

      aggBucket = null;
      BUB.clear();
      cData = []; vData = []; cMap = {};
      msg.candles.forEach(c => upsertCandle(aggCandle(c), true));
      _flushBulk();

      if (msg.candles.length > 0) {
        updateTicker(msg.candles[msg.candles.length - 1], msg.instrument);
      }
      historyReadyForSubscribe = true;
      ws.send(JSON.stringify({
        type: 'subscribe', symbol: selSym,
        interval: msg.interval, display_interval: selIv,
      }));
      setLiveMode(true);
      document.getElementById('s-iv').textContent = ivLabel(selIv);
      setTimeout(() => {
        if (lwChart) {
          lwChart.timeScale().fitContent();
          requestAnimationFrame(() => BUB.draw());
        }
      }, 120);
    }

    // ── SWITCHING SYMBOLS (transitioning between different instruments) ───
    else if (t === 'switching') {
      clearAlerts();
      if (!lwChart && !initCharts()) return;
      if (historyReadyForSubscribe) {
        historyReadyForSubscribe = false;
      } else {
        BUB.clear();
        aggBucket = null;
      }
      showAlert('info',`🔄 Switching to ${msg.symbol} @ ${ivLabel(selIv)}…`);
      document.getElementById('s-sym').textContent     = msg.symbol;
      document.getElementById('s-iv').textContent      = ivLabel(selIv);
      document.getElementById('sym-disp').textContent  = msg.symbol;
    }

    // ── LIVE STATUS UPDATES ────────────────────────────────────────────
    else if (t === 'status') {
      if (msg.status === 'connected') {
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
      autoStrikeCheck(msg.ltp);  // Auto strike re-select if enabled
      
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

    else if (t === 'option_expiries')       { onOptExpiries(msg); }
    else if (t === 'option_expiries_error') { onOptError(msg.message || 'Expiry fetch failed'); }
    else if (t === 'option_chain')          { onOptChain(msg); }
    else if (t === 'option_chain_error')    { onOptError(msg.message || 'Chain fetch failed'); }

    else if (t === 'error') { showAlert('err','⚠ '+msg.message, false); }
  };

  socket.onerror = () => {
    setStatus('err','ERROR');
    showAlert('err',`⚠ Cannot connect to ${socketUrl}\n→ Start server first, then retry.`, false);
  };

  socket.onclose = () => {
    if (ws !== socket) return;
    try {
      setStatus('idle','DISCONNECTED');
      document.getElementById('connectBtn').disabled    = false;
      document.getElementById('disconnectBtn').disabled = true;
      document.getElementById('saveTokenBtn').disabled  = true;
      document.getElementById('index-load-btn').disabled = true;
      if (tpsTmr) { clearInterval(tpsTmr); tpsTmr = null; }
      const tpsEl = document.getElementById('s-tps');
      if (tpsEl) tpsEl.textContent = '—';
      tokSaved = false; setTok(null,'Disconnected.');
      ws = null;
    } catch(e) { console.error('Disconnect handler error:', e); }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CE / PE WEBSOCKETS — separate connections feeding ce5Bucket and pe5Bucket
// ─────────────────────────────────────────────────────────────────────────────
function _makeOptWS(instrKey, onCandle) {
  if (!tokSaved || !instrKey) return null;
  const s = new WebSocket(resolvedWebSocketUrl());
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
  document.getElementById('index-load-btn').disabled = true;
  
  // Stop TPS monitoring timer
  if (tpsTmr) { clearInterval(tpsTmr); tpsTmr = null; }
  const tpsEl = document.getElementById('s-tps');
  if (tpsEl) tpsEl.textContent = '—';
  
  // Clear auth state
  tokSaved = false;
  setTok(null, 'Disconnected.');
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
  document.getElementById('index-load-btn').disabled = false;
  document.getElementById('opt-chain-status').textContent = 'Token ready → select underlying & Load Chain';
  optFetchExpiries();
}
