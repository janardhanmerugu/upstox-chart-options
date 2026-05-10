// ─────────────────────────────────────────────────────────────────────────────
// UI CONTROLS and BUTTONS 
// ─────────────────────────────────────────────────────────────────────────────

// ──── Bubbles toggle ────
function toggleBubbles() {
  bubOn = !bubOn;
  const btn = document.getElementById('bubBtn');
  btn.textContent = bubOn ? '● Bubbles ON' : '○ Bubbles OFF';
  btn.classList.toggle('off', !bubOn);
  BUB.draw();
}

// ──── Crosshair / magnet mode ────
let crosshairMagnet = false;
function toggleCrosshair() {
  crosshairMagnet = !crosshairMagnet;
  const btn = document.getElementById('xhair-btn');
  if (lwChart) lwChart.applyOptions({ crosshair: { mode: crosshairMagnet ? 1 : 0 } });
  btn.textContent       = crosshairMagnet ? '🧲 Magnet' : '✥ Free';
  btn.style.borderColor = crosshairMagnet ? 'var(--accent)' : '';
  btn.style.color       = crosshairMagnet ? 'var(--accent)' : '';
  btn.style.background  = crosshairMagnet ? 'var(--accent)15' : '';
}

// ──── Token UI ────
function toggleTokenVis() {
  const i = document.getElementById('token-input'), b = document.getElementById('showHideBtn');
  i.type = i.type === 'password' ? 'text' : 'password';
  b.textContent = i.type === 'password' ? 'Show' : 'Hide';
}

function saveToken() {
  const t = document.getElementById('token-input').value.trim();
  if (!t) { setTok(false,'Token cannot be empty.'); return; }
  if (!ws || ws.readyState !== WebSocket.OPEN) { showAlert('err','⚠ Connect to server first.'); return; }
  ws.send(JSON.stringify({ type: 'auth', token: t }));
}

function clearToken() {
  document.getElementById('token-input').value = '';
  document.getElementById('token-input').className = '';
  sessionStorage.removeItem('upstox_token');
  tokSaved = false; setTok(null,'Token cleared.');
  document.getElementById('clearTokenBtn').disabled = true;
}

function setTok(ok, msg) {
  const dot = document.getElementById('tok-dot');
  const txt = document.getElementById('tok-msg');
  const inp = document.getElementById('token-input');
  txt.textContent = msg;
  if (ok === true) {
    dot.className = 'ok'; inp.className = 'tok-ok'; tokSaved = true;
    sessionStorage.setItem('upstox_token', inp.value.trim());  // persist for page refresh
    document.getElementById('clearTokenBtn').disabled = false;
  } else if (ok === false) {
    dot.className = 'fail'; inp.className = 'tok-fail'; tokSaved = false;
    sessionStorage.removeItem('upstox_token');  // bad token — don't restore it next time
  } else {
    dot.className = ''; inp.className = '';
  }
}

// ──── Status / alerts ────
function setStatus(cls, txt) { const e = document.getElementById('statusBadge'); e.className='badge '+cls; e.textContent=txt; }
function showAlert(type, msg, hide=true) {
  const b = document.getElementById('alerts'); b.style.display='block';
  const d = document.createElement('div'); d.className='alert '+type; d.textContent=msg; b.appendChild(d);
  if (hide) setTimeout(() => { d.remove(); if (!b.children.length) b.style.display='none'; }, 6000);
}
function clearAlerts() { const b = document.getElementById('alerts'); b.innerHTML=''; b.style.display='none'; }

// ──── Ticker helpers ────
function updateLTP(ltp) {
  const el = document.getElementById('t-ltp'), prev = parseFloat(el.dataset.p || ltp);
  el.textContent = fN(ltp); el.className = 'tv '+(ltp >= prev ? 'up' : 'dn'); el.dataset.p = ltp;
}

function updateTicker(c, sym) {
  if (sym) { document.getElementById('sym-disp').textContent=sym; document.getElementById('s-sym').textContent=sym; }
  document.getElementById('t-o').textContent = fN(c.open);
  document.getElementById('t-h').textContent = fN(c.high);
  document.getElementById('t-l').textContent = fN(c.low);
  document.getElementById('t-c').textContent = fN(c.close);
  document.getElementById('t-v').textContent = fV(c.volume);
  const chg = c.close - c.open, pct = ((chg / c.open) * 100).toFixed(2);
  const el = document.getElementById('t-chg');
  el.textContent = `${chg >= 0 ? '+' : ''}${fN(chg)} (${pct}%)`; el.className='tv '+(chg >= 0 ? 'up' : 'dn');
  if (c.volume > 0) {
    const rat = document.getElementById('t-rat');
    if (rat) rat.textContent = (Math.abs(chg) * 1000 / c.volume).toFixed(4) + '×10⁻³';
  }
}

// ──── Drawer toggle ────
function toggleDrawer() {
  const drawer = document.getElementById('side-drawer');
  const toggle = document.getElementById('drawer-toggle');
  const open   = drawer.classList.toggle('collapsed');
  toggle.classList.toggle('collapsed', open);
  toggle.textContent = open ? '›' : '‹';
  setTimeout(() => {
    if (lwChart) {
      const con = document.getElementById('chart-con');
      lwChart.resize(Math.max(con.clientWidth,200), Math.max(con.clientHeight,200));
      BUB.sync(); BUB.draw();
    }
  }, 280);
}

// ──── Interval picker ────
function pickIv(v) {
  selIv = v;
  document.querySelectorAll('.ivbtn').forEach(b => b.classList.toggle('active', +b.dataset.iv === v));
}

// ──── Symbol loader ────
function loadSym() {
  if (!selSym) { showAlert('warn','⚠ No symbol selected.'); return; }
  if (!tokSaved) { showAlert('err','⚠ Save your Access Token first.'); return; }
  if (!ws || ws.readyState !== WebSocket.OPEN) { showAlert('err','⚠ Not connected. Click Connect.'); return; }
  clearAlerts();
  aggBucket = null;
  BUB.clear();
  const backendIv = (selIv === 60 || selIv === 300 || selIv === 900) ? 1 : selIv;
  ws.send(JSON.stringify({ type: 'subscribe', symbol: selSym, interval: backendIv, display_interval: selIv }));
}

// ──── Line Drawing ────
// Lines added/removed via Ctrl + Left-click on chart
// All lines cleared via Ctrl + C
let hLines = [];

function addHLine(price) {
  if (!cSeries) return;
  const pl = cSeries.createPriceLine({ price, color:'#ffe033cc', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'' });
  hLines.push({ priceLine: pl, price });
}

function removeNearestHLine(clientY, rect) {
  if (!cSeries || hLines.length === 0) return false;
  const SNAP_PX = 6;
  let closest = null, minDiff = Infinity, idx = -1;
  hLines.forEach((h, i) => {
    const lineY = cSeries.priceToCoordinate(h.price);
    if (lineY == null) return;
    const diff = Math.abs((clientY - rect.top) - lineY);
    if (diff <= SNAP_PX && diff < minDiff) { minDiff = diff; closest = h; idx = i; }
  });
  if (closest) { cSeries.removePriceLine(closest.priceLine); hLines.splice(idx, 1); return true; }
  return false;
}

function clearAllLines() {
  if (!cSeries) return;
  hLines.forEach(h => cSeries.removePriceLine(h.priceLine));
  hLines = [];
}

// ──── Option Chain UI ────
function optPickUL(ul, btn) {
  optUL = ul;
  document.querySelectorAll('.opt-ul-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // NOTE: do NOT set selSym here — selSym is only updated when the spot chart
  // actually subscribes (inside optSelectStrike → loadSym).

  optChain    = null;
  optExpiries = [];
  const exp = document.getElementById('opt-expiry');
  exp.innerHTML = '<option value="">— load chain —</option>';
  document.getElementById('opt-strikes-row').style.display = 'none';
  document.getElementById('opt-info-row').style.display    = 'none';
  document.getElementById('opt-strikes').innerHTML         = '';
  document.getElementById('opt-chain-status').textContent  = 'Pick expiry → Load Chain';

  if (tokSaved && ws && ws.readyState === WebSocket.OPEN) {
    optFetchExpiries();
  }
}

function optOnExpiry() {
  const val = document.getElementById('opt-expiry').value;
  if (!val) return;
  optChain = null;
  document.getElementById('opt-strikes-row').style.display = 'none';
  document.getElementById('opt-info-row').style.display    = 'none';
  document.getElementById('opt-strikes').innerHTML         = '';
  document.getElementById('opt-fetch-btn').disabled        = false;
  document.getElementById('opt-chain-status').textContent  = `Expiry: ${val}  →  Click ⬇ Load Chain`;
}

// Called when range/ATM selection changes → refetch with new parameters
function optBuildStrikes() {
  if (!optChain) return;
  const range   = parseInt(document.getElementById('opt-range').value) || 5;
  const strikes = optChain.strikes;
  const spot    = optChain.spot;
  const atmIdx  = optChain.atm_index;

  const lo  = Math.max(0, atmIdx - range);
  const hi  = Math.min(strikes.length - 1, atmIdx + range);
  const sub = strikes.slice(lo, hi + 1);

  const cont = document.getElementById('opt-strikes');
  cont.innerHTML = '';

  sub.forEach((s, idx) => {
    const isAtm = (lo + idx) === atmIdx;
    const row   = document.createElement('div');
    row.className = 'strike-row';

    const ceBtn = document.createElement('button');
    ceBtn.className   = 'ce-btn';
    ceBtn.textContent = s.strike;
    ceBtn.title       = `CE  ${s.ce_key}`;
    ceBtn.onclick     = () => optSelectStrike(s.strike, 'CE', s.ce_key, ceBtn);

    const lbl = document.createElement('div');
    lbl.className   = isAtm ? 'strike-label atm' : 'strike-label';
    lbl.textContent = isAtm ? '◆ ATM' : s.strike;
    lbl.title       = `Spot: ${spot ? spot.toFixed(2) : '—'}`;

    const peBtn = document.createElement('button');
    peBtn.className   = 'pe-btn';
    peBtn.textContent = s.strike;
    peBtn.title       = `PE  ${s.pe_key}`;
    peBtn.onclick     = () => optSelectStrike(s.strike, 'PE', s.pe_key, peBtn);

    row.appendChild(ceBtn);
    row.appendChild(lbl);
    row.appendChild(peBtn);
    cont.appendChild(row);
  });

  let spotEl = cont.parentElement.querySelector('.strikes-spot');
  if (!spotEl) {
    spotEl = document.createElement('div');
    spotEl.className = 'strikes-spot';
    cont.parentElement.appendChild(spotEl);
  }
  spotEl.textContent = `Spot: ${spot ? spot.toFixed(2) : '—'}  |  ATM ± ${range}  |  ${sub.length} strikes`;

  document.getElementById('opt-strikes-row').style.display = 'flex';
  document.getElementById('opt-chain-status').textContent  =
    `✅ ${sub.length} strikes loaded  |  Spot: ${spot ? spot.toFixed(2) : '—'}`;
}

function optSelectStrike(strike, optType, instrKey, btn) {
  if (!instrKey) { showAlert('warn','⚠ No instrument key for this strike.'); return; }
  const expiry = document.getElementById('opt-expiry').value;

  if (optType === 'CE') {
    if (selCEBtn) selCEBtn.classList.remove('active');
    selCEBtn = btn; selCEKey = instrKey; selCEStrike = strike;
    btn.classList.add('active');
    document.getElementById('oi-ce-strike').textContent = strike;
    document.getElementById('oi-ce-expiry').textContent = expiry;
    document.getElementById('oi-ce-key').textContent    = instrKey;
    document.getElementById('oi-ce-wrap').style.display = 'block';
    ce5Bucket = { cur: null, _last: null };
    connectCEWS(instrKey);
    showAlert('info',`🔴 CE: ${optUL} ${strike}  |  Expiry: ${expiry}`);
  } else {
    if (selPEBtn) selPEBtn.classList.remove('active');
    selPEBtn = btn; selPEKey = instrKey; selPEStrike = strike;
    btn.classList.add('active');
    document.getElementById('oi-pe-strike').textContent = strike;
    document.getElementById('oi-pe-expiry').textContent = expiry;
    document.getElementById('oi-pe-key').textContent    = instrKey;
    document.getElementById('oi-pe-wrap').style.display = 'block';
    pe5Bucket = { cur: null, _last: null };
    connectPEWS(instrKey);
    showAlert('info',`🟢 PE: ${optUL} ${strike}  |  Expiry: ${expiry}`);
  }

  document.getElementById('opt-info-strip') && (document.getElementById('opt-info-strip').style.display = 'flex');
  document.getElementById('opt-info-row').style.display = 'flex';

  // Load spot chart — always use the correct index key for the current underlying.
  // selSym drives the spot WebSocket subscription; set it here (not in optPickUL).
  const spotKey = OPT_INDEX_KEY[optUL];
  if (selSym !== spotKey) {
    selSym = spotKey;
    BUB.clear();
    loadSym();
  } else if (!lwChart) {
    // Underlying already selected but chart not yet initialised
    BUB.clear();
    loadSym();
  }
}

// ──── Auto Strike Selection ────

// Toggle Auto/Manual mode from button click
function toggleAutoStrike() {
  autoStrikeMode = !autoStrikeMode;
  const btn = document.getElementById('auto-strike-btn');
  btn.textContent       = autoStrikeMode ? '⚡ Auto' : '✋ Manual';
  btn.classList.toggle('active', autoStrikeMode);

  if (autoStrikeMode) {
    // Read threshold from input on enable
    const inp = document.getElementById('auto-strike-thresh');
    autoThreshold = parseFloat(inp.value) || 75;

    // Immediately try to select ATM using current spot LTP
    const spotNow = parseFloat((document.getElementById('t-ltp').textContent || '').replace(/,/g,''));
    if (spotNow > 100) {
      autoSelectATM(spotNow);
    } else {
      showAlert('warn','⚠ Auto: Waiting for spot price…');
    }
  } else {
    autoRefPrice = null;
    showAlert('info','✋ Manual mode — auto strike disabled.');
  }
}

// Core auto-select logic: compute ATM strike and call optSelectStrike for CE + PE
function autoSelectATM(spot) {
  if (!optChain || !optChain.strikes || optChain.strikes.length === 0) {
    showAlert('warn','⚠ Auto: Load option chain first.');
    return;
  }

  // Step size based on current underlying
  const step = OPT_STEP[optUL] || 50;

  // Round spot to nearest step → ATM strike
  const atm = Math.round(spot / step) * step;

  // Find matching strike row in optChain
  const found = optChain.strikes.find(s => s.strike === atm)
             || optChain.strikes.reduce((best, s) =>
                  Math.abs(s.strike - atm) < Math.abs(best.strike - atm) ? s : best,
                  optChain.strikes[0]);

  if (!found) { showAlert('warn','⚠ Auto: ATM strike not found in chain.'); return; }

  // Find the DOM buttons for this strike to pass into optSelectStrike
  // (optSelectStrike needs the btn reference to mark it active)
  const rows = document.querySelectorAll('.strike-row');
  let ceBtn = null, peBtn = null;
  rows.forEach(row => {
    const btns = row.querySelectorAll('button');
    if (btns.length >= 2 && parseInt(btns[0].textContent) === found.strike) {
      ceBtn = btns[0];
      peBtn = btns[1];
    }
  });

  // Select CE
  if (found.ce_key) optSelectStrike(found.strike, 'CE', found.ce_key, ceBtn);
  // Select PE
  if (found.pe_key) optSelectStrike(found.strike, 'PE', found.pe_key, peBtn);

  // Set new reference price to the ATM strike (not raw spot)
  autoRefPrice = atm;

  showAlert('ok', `⚡ Auto ATM: ${found.strike}  (Spot: ${spot.toFixed(2)},  Step: ${step})`);
}

// Called on every spot LTP update — checks if drift ≥ threshold
function autoStrikeCheck(spot) {
  if (!autoStrikeMode || autoRefPrice === null) return;
  if (Math.abs(spot - autoRefPrice) >= autoThreshold) {
    showAlert('info', `⚡ Auto re-select: spot moved ${(spot - autoRefPrice).toFixed(1)} pts from ${autoRefPrice}`);
    autoSelectATM(spot);
  }
}

// ──── History helpers ────
function initHistoryDates() {
  const today = new Date();
  const yyyy  = today.getFullYear();
  const mm    = String(today.getMonth()+1).padStart(2,'0');
  const dd    = String(today.getDate()).padStart(2,'0');
  const todayStr = `${yyyy}-${mm}-${dd}`;
  const weekAgo  = new Date(today); weekAgo.setDate(today.getDate()-7);
  const wy = weekAgo.getFullYear(), wm = String(weekAgo.getMonth()+1).padStart(2,'0'), wd = String(weekAgo.getDate()).padStart(2,'0');
  const fromStr = `${wy}-${wm}-${wd}`;
  const hFrom = document.getElementById('hist-from');
  const hTo   = document.getElementById('hist-to');
  if (hFrom) { hFrom.value = fromStr; hFrom.max = todayStr; }
  if (hTo)   { hTo.value   = todayStr; hTo.max  = todayStr; }
}

function loadHistory() {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showAlert('err','⚠ Connect first.'); return; }
  if (!selSym) { showAlert('warn','⚠ Pick a symbol first.'); return; }
  const unit     = document.getElementById('hist-unit').value;
  const fromDate = document.getElementById('hist-from').value;
  const toDate   = document.getElementById('hist-to').value;
  if (!fromDate || !toDate) { showAlert('warn','⚠ Set from/to dates.'); return; }
  document.getElementById('hist-status').textContent = '⏳ Loading…';
  document.getElementById('hist-btn').disabled = true;
  ws.send(JSON.stringify({ type:'get_history', symbol:selSym, unit, from_date:fromDate, to_date:toDate }));
}

// ──── Offline Bubble Loader ────
function offlineLoadBubbles() {
  const dateStr = document.getElementById('csv-date').value;
  const selVal  = document.getElementById('offline-bub-strike').value;
  if (!dateStr) { showAlert('warn','⚠ Pick a date first.'); return; }
  if (!selVal)  { showAlert('warn','⚠ Pick a strike first.'); return; }
  let parsed;
  try { parsed = JSON.parse(selVal); } catch(_) { showAlert('err','⚠ Invalid selection.'); return; }
  wsLoadBubbles(dateStr, parsed.opt_type, parsed.strike);
}

// ──── Bubble Presets ────
const BUB_PRESETS = {
  smart: {
    // Smart Money: writers confirming direction
    // CE falling while spot falls + PE falling while spot rises
    'chk-ce-bull-pos': false, 'chk-ce-bull-neg': false,
    'chk-ce-bear-pos': false, 'chk-ce-bear-neg': true,
    'chk-pe-bull-pos': true,  'chk-pe-bull-neg': false,
    'chk-pe-bear-pos': false, 'chk-pe-bear-neg': false,
  },
  positive: {
    // Positive Direction: all ▲ +ve — spot genuinely moving up
    'chk-ce-bull-pos': true,  'chk-ce-bull-neg': false,
    'chk-ce-bear-pos': false,  'chk-ce-bear-neg': false,
    'chk-pe-bull-pos': true,  'chk-pe-bull-neg': false,
    'chk-pe-bear-pos': false,  'chk-pe-bear-neg': false,
  },
  negative: {
    // Negative Direction: all ▼ −ve — spot genuinely moving down
    'chk-ce-bull-pos': false, 'chk-ce-bull-neg': false,
    'chk-ce-bear-pos': false, 'chk-ce-bear-neg': true,
    'chk-pe-bull-pos': false, 'chk-pe-bull-neg': false,
    'chk-pe-bear-pos': false, 'chk-pe-bear-neg': true,
  },
  fake: {
    // Fake Move: options contradicting price direction
    // CE rising while spot falls + PE falling while spot falls + PE rising while spot rises
    'chk-ce-bull-pos': false, 'chk-ce-bull-neg': true,
    'chk-ce-bear-pos': true, 'chk-ce-bear-neg': false,
    'chk-pe-bull-pos': false, 'chk-pe-bull-neg': true,
    'chk-pe-bear-pos': true,  'chk-pe-bear-neg': false,
  },
  inverse_fake: {
    // Inverse Fake: options confirming price from contrarian side
    // CE rising while spot rises + CE falling while spot rises + PE falling while spot rises + PE rising while spot falls
    'chk-ce-bull-pos': true,  'chk-ce-bull-neg': false,
    'chk-ce-bear-pos': false,  'chk-ce-bear-neg': true,
    'chk-pe-bull-pos': true,  'chk-pe-bull-neg': false,
    'chk-pe-bear-pos': false, 'chk-pe-bear-neg': true,
  },
  all: {
    'chk-ce-bull-pos': true,  'chk-ce-bull-neg': true,
    'chk-ce-bear-pos': true,  'chk-ce-bear-neg': true,
    'chk-pe-bull-pos': true,  'chk-pe-bull-neg': true,
    'chk-pe-bear-pos': true,  'chk-pe-bear-neg': true,
  },
  none: {
    'chk-ce-bull-pos': false, 'chk-ce-bull-neg': false,
    'chk-ce-bear-pos': false, 'chk-ce-bear-neg': false,
    'chk-pe-bull-pos': false, 'chk-pe-bull-neg': false,
    'chk-pe-bear-pos': false, 'chk-pe-bear-neg': false,
  },
};

function bubApplyPreset(val) {
  if (val === 'custom') return; // user selected custom manually — do nothing
  const preset = BUB_PRESETS[val];
  if (!preset) return;
  Object.entries(preset).forEach(([id, checked]) => {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  });
  BUB.draw();
}

// Called by every checkbox onchange — switches dropdown to Custom
function bubPresetCustom() {
  const sel = document.getElementById('bub-preset');
  if (sel && sel.value !== 'custom') sel.value = 'custom';
  BUB.draw();
}
