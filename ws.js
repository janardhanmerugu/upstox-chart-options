// ─────────────────────────────────────────────────────────────────────────────
// WEBSOCKET — main connection + CE/PE option feeds
// ─────────────────────────────────────────────────────────────────────────────

function connectWS() {
  clearAlerts();
  if (ws) ws.close();
  setStatus('connecting','CONNECTING…');

  try {
    ws = new WebSocket(CONFIG.WEBSOCKET_URL);
  } catch(e) {
    showAlert('err','⚠ WebSocket creation failed: ' + e.message, false);
    setStatus('err','ERROR');
    return;
  }

  ws.onopen = () => {
    setStatus('authed','● CONNECTED');
    document.getElementById('connectBtn').disabled    = true;
    document.getElementById('disconnectBtn').disabled = false;
    document.getElementById('saveTokenBtn').disabled  = false;
    showAlert('info','✅ Connected! Paste your token and click Save Token.');
    if (tpsTmr) clearInterval(tpsTmr);
    tpsTmr = setInterval(() => {
      const el = document.getElementById('s-tps');
      if (el) el.textContent = tickCnt;
      tickCnt = 0;
    }, CONFIG.TPS_INTERVAL_MS);
  };

  ws.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch(_) { return; }
    tickCnt++;
    const t = msg.type;

    if (t === 'auth_ok') {
      setTok(true,'✅ Token accepted!'); setStatus('live','● READY');
      showAlert('ok','✅ Token saved! Pick underlying & click ⬇ Load Chain');
      const histBtn = document.getElementById('hist-btn');
      if (histBtn) histBtn.disabled = false;
      optOnAuthOk();
    }
    else if (t === 'auth_fail') { setTok(false,'❌ '+msg.message); showAlert('err','⚠ '+msg.message, false); }

    else if (t === 'init') {
      if (msg.candles && msg.candles.length > 0) {
        if (!lwChart && !initCharts()) return;
        aggBucket = null;
        msg.candles.forEach(c => upsertCandle(aggCandle(c), true));
        setTimeout(() => {
          BUB.clear();
          lwChart.timeScale().fitContent();
          requestAnimationFrame(() => BUB.draw());
        }, 120);
        updateTicker(msg.candles[msg.candles.length-1], msg.symbol || '');
        document.getElementById('s-iv').textContent = ivLabel(selIv);
      }
    }

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

    else if (t === 'status') {
      if (msg.status === 'connected') {
        clearAlerts();
        showAlert('ok',`✅ Live: ${msg.symbol} @ ${ivLabel(selIv)}`);
        document.getElementById('s-sym').textContent = msg.symbol;
        document.getElementById('s-iv').textContent  = ivLabel(selIv);
        setStatus('live','● LIVE');
      } else if (msg.status === 'error') {
        showAlert('err','⚠ Feed error: '+msg.message, false);
      } else if (msg.status === 'auth_error') {
        setStatus('err','⚠ TOKEN EXPIRED');
        setTok(false,'❌ Token expired — get a new token from developer.upstox.com');
        showAlert('err','🔑 Token rejected (403). Get a fresh token.',false);
      } else if (msg.status === 'reconnecting') {
        setStatus('connecting','RECONNECTING…');
        showAlert('warn','🔄 '+msg.message, false);
      }
    }

    else if (t === 'candle') {
      if (!lwChart && !initCharts()) return;
      const chartCandle = aggCandle(msg.candle);
      upsertCandle(chartCandle, false);
      updateTicker(chartCandle, msg.instrument);
      BUB.pushSpot5s(msg.candle);
      if (_atRealTime) lwChart.timeScale().scrollToRealTime();
      requestAnimationFrame(() => BUB.draw());
    }

    else if (t === 'tick') {
      if (!lwChart && !initCharts()) return;
      updateLTP(msg.ltp);
      if (spotInstrKey) lastSpotLtp[spotInstrKey] = msg.ltp;
      const lastEl = document.getElementById('s-last');
      if (lastEl) lastEl.textContent = fT(msg.ltt);
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

    else if (t === 'bubble_strikes') {
      const sel = document.getElementById('csv-strike');
      if (sel) {
        sel.innerHTML = '<option value="">— select strike —</option>';
        if (!msg.strikes || msg.strikes.length === 0) {
          sel.innerHTML = '<option value="">No bubbles for this date</option>';
        } else {
          msg.strikes.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            sel.appendChild(opt);
          });
        }
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

    else if (t === 'bubbles_data') {
      if (!msg.bubbles || msg.bubbles.length === 0) {
        document.getElementById('csv-bubble-status').textContent = '⚠ No bubbles found'; return;
      }
      const optType = msg.strike.toLowerCase().startsWith('pe') ? 'PE' : 'CE';
      msg.bubbles.forEach(b => {
        if (BUB.items.length >= BUB.MAX) BUB.items.shift();
        // b.time is raw UTC epoch seconds — do NOT add IST_OFFSET_S here.
        // BUB.toXY() already adds IST_OFFSET_S when calling timeToCoordinate().
        const t = b.time;
        BUB.items.push({
          time:      t,
          chartTime: (selIv === 60 || selIv === 300 || selIv === 900)
                       ? Math.floor(t / selIv) * selIv : t,
          open:      b.open,
          spotClose: b.spot_close,
          ratio:     b.ratio,
          optType,
          strike:    msg.strike,
          spotDelta: 0,
          optDelta:  0,
        });
      });
      const el = document.getElementById('s-bubs');
      if (el) el.textContent = BUB.items.length;
      requestAnimationFrame(() => BUB.draw());
      const _bs1 = document.getElementById('csv-bubble-status');
      if (_bs1) _bs1.textContent = `✅ ${msg.bubbles.length} bubbles (${msg.strike})`;
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

function loadLocalBubbles(input) {
  const file = input.files[0];
  if (!file) return;
  const status = document.getElementById('local-bubble-status');
  status.textContent = '⏳ Reading…';
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.trim().split('\n');
    const rows = lines.slice(1);
    const optType = file.name.toLowerCase().includes('pe') ? 'PE' : 'CE';
    let count = 0;
    rows.forEach(line => {
      const parts = line.split(',');
      if (parts.length < 4) return;
      const [dt, open, spot_close, ratio] = parts;
      if (!dt || !open || !ratio) return;
      const t = Math.floor(new Date(dt.trim().replace(' ', 'T') + 'Z').getTime() / 1000);
      if (isNaN(t) || isNaN(+ratio)) return;
      if (BUB.items.length >= BUB.MAX) BUB.items.shift();
      BUB.items.push({
        time:      t,
        chartTime: (selIv === 60 || selIv === 300 || selIv === 900)
                     ? Math.floor(t / selIv) * selIv : t,
        open:      +open,
        spotClose: +spot_close,
        ratio:     +ratio,
        optType,
        strike:    file.name.replace(/\.csv$/i, ''),
        spotDelta: 0,
        optDelta:  0,
      });
      count++;
    });
    const el = document.getElementById('s-bubs');
    if (el) el.textContent = BUB.items.length;
    requestAnimationFrame(() => BUB.draw());
    status.textContent = '✅ ' + count + ' bubbles loaded from ' + file.name;
  };
  reader.onerror = () => { status.textContent = '⚠ Failed to read file'; };
  reader.readAsText(file);
}

function disconnectWS() {
  if (ws)   { try { ws.close();   } catch(_){} ws   = null; }
  if (wsCE) { try { wsCE.close(); } catch(_){} wsCE = null; }
  if (wsPE) { try { wsPE.close(); } catch(_){} wsPE = null; }
  ce5Bucket   = { cur: null, _last: null };
  pe5Bucket   = { cur: null, _last: null };
  spot5Bucket = { cur: null, _last: null };
  // Reset UI immediately — do not rely on onclose firing
  setStatus('idle', 'DISCONNECTED');
  document.getElementById('connectBtn').disabled    = false;
  document.getElementById('disconnectBtn').disabled = true;
  document.getElementById('saveTokenBtn').disabled  = true;
  if (tpsTmr) { clearInterval(tpsTmr); tpsTmr = null; }
  const tpsEl = document.getElementById('s-tps');
  if (tpsEl) tpsEl.textContent = '—';
  tokSaved = false;
  setTok(null, 'Disconnected.');
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV LOADERS — auto-connect, then send requests via WS
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
    // Only reset state if ws still points to this temp connection.
    // If connectWS() replaced it, or disconnectWS() already nulled it, do nothing.
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
    else if (t === 'bubble_strikes') {
      const sel = document.getElementById('csv-strike');
      if (sel) {
        sel.innerHTML = '<option value="">— select strike —</option>';
        if (!msg.strikes || msg.strikes.length === 0) { sel.innerHTML = '<option value="">No bubbles for this date</option>'; }
        else { msg.strikes.forEach(s => { const opt=document.createElement('option'); opt.value=s; opt.textContent=s; sel.appendChild(opt); }); }
      }
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
    else if (t === 'bubbles_data') {
      if (!msg.bubbles || msg.bubbles.length === 0) { document.getElementById('csv-bubble-status').textContent='⚠ No bubbles found'; return; }
      msg.bubbles.forEach(b => {
        if(BUB.items.length>=BUB.MAX)BUB.items.shift();
        const bt=b.time;
        // Use stored opt_type if present; fallback: check full strike string for CE/PE suffix
        const fullStrike = b.strike || msg.strike || '';
        let optType = (b.opt_type||'').toUpperCase();
        if (!optType) {
          const sl = fullStrike.toLowerCase();
          optType = sl.includes('25pe') || sl.endsWith('pe') ? 'PE' : 'CE';
        }
        BUB.items.push({
          time:bt, chartTime:(selIv===60||selIv===300||selIv===900)?Math.floor(bt/selIv)*selIv:bt,
          open:b.open, spotClose:b.spot_close, ratio:b.ratio,
          optType, strike:fullStrike, spotDelta:0, optDelta:0
        });
      });
      const el=document.getElementById('s-bubs'); if(el) el.textContent=BUB.items.length;
      requestAnimationFrame(()=>BUB.draw());
      document.getElementById('csv-bubble-status').textContent=`✅ ${msg.bubbles.length} bubbles (${msg.strike})`;
    }
  };
}

function csvDateChanged() {
  const d = document.getElementById('csv-date').value;
  if (!d) return;
  const candleStatus = document.getElementById('csv-candle-status');
  const bubbleStatus = document.getElementById('csv-bubble-status');
  if (candleStatus) candleStatus.textContent = '';
  if (bubbleStatus) bubbleStatus.textContent = '';
  _ensureWSForCSV(() => {
    ws.send(JSON.stringify({ type: 'list_saved', date: d }));
    // Only request bubble strikes if the server-side strike select still exists in HTML
    if (document.getElementById('csv-strike')) {
      ws.send(JSON.stringify({ type: 'list_bubble_strikes', date: d }));
    }
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

function loadBubblesCSV() {
  const d = document.getElementById('csv-date').value;
  const strikeEl = document.getElementById('csv-strike');
  const bubStatus = document.getElementById('csv-bubble-status');
  const s = strikeEl ? strikeEl.value : null;
  if (!d || !s) { if (bubStatus) bubStatus.textContent = '⚠ Pick date + strike'; return; }
  if (bubStatus) bubStatus.textContent = '⏳ Loading…';
  _ensureWSForCSV(() => {
    ws.send(JSON.stringify({ type: 'load_bubbles', date: d, strike: s }));
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
  ws.send(JSON.stringify({ type: 'get_option_expiries', underlying }));
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

  ws.send(JSON.stringify({ type: 'get_option_chain', underlying: spotKey, expiry: exp, spot_hint: spotHint }));
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
  // msg is the raw server payload: {spot, atm_index, strikes:[{strike,ce_key,pe_key}]}
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
