// ─────────────────────────────────────────────────────────────────────────────
// BUBBLE OVERLAY
// Draws a transparent canvas EXACTLY over the LightweightCharts pane.
// Uses chart.timeScale().timeToCoordinate() and series.priceToCoordinate()
// to map (candle.time, candle.open) → canvas pixel (x, y).
// Redraws on: new candle, scroll, zoom, resize.
// ─────────────────────────────────────────────────────────────────────────────
const BUB = {
  canvas:  null,
  ctx:     null,
  items:   [],      // [{time, open, ratio, optType:'CE'|'PE', optDelta, spotDelta, ...}]
  MAX:     2000,
  MIN_R:   2,
  hovered: null,

  // ── Create canvas overlay inside #chart-con ──────────────────────────────
  mount() {
    const old = document.getElementById('bub-canvas');
    if (old) old.remove();
    const canvas = document.createElement('canvas');
    canvas.id = 'bub-canvas';
    canvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
    document.getElementById('chart-con').appendChild(canvas);
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    canvas.addEventListener('mousemove',  e => this._onMove(e));
    canvas.addEventListener('mouseleave', () => this._onLeave());
  },

  sync() {
    if (!this.canvas) return;
    const w = this.canvas.offsetWidth, h = this.canvas.offsetHeight;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  },

  _chartTime(t5s) {
    if (selIv === 60 || selIv === 300 || selIv === 900) return Math.floor(t5s / selIv) * selIv;
    return t5s;
  },

  _acc5s(bucket, raw) {
    const bt = Math.floor(raw.time / 5) * 5;
    let flushed = null;
    if (!bucket.cur || bucket.cur.time !== bt) {
      if (bucket.cur) flushed = { ...bucket.cur };
      bucket.cur = { time: bt, open: raw.open, high: raw.high,
                     low: raw.low, close: raw.close, volume: raw.volume || 0 };
    } else {
      bucket.cur.high   = Math.max(bucket.cur.high,  raw.high);
      bucket.cur.low    = Math.min(bucket.cur.low,   raw.low);
      bucket.cur.close  = raw.close;
      bucket.cur.volume = (bucket.cur.volume || 0) + (raw.volume || 0);
    }
    return flushed;
  },

  // ── CE bubble: ratio = ceDelta / spotAbs  →  +ve = premium rose, −ve = premium fell
  // ── color: ratio > 0 → green, ratio ≤ 0 → red
  _tryEmitCE(ceBucket, spotBucket) {
    if (!ceBucket || !spotBucket) return;
    if (ceBucket.time !== spotBucket.time) return;
    const ceDelta   = ceBucket.close - ceBucket.open;
    if (ceDelta === 0) return;
    const spotDelta = Math.abs(spotBucket.close - spotBucket.open);
    const spotAbs   = spotDelta || 0.01;
    const ratio = ceDelta / spotAbs;
    if (Math.abs(ratio) < bubMinRatioCE) return;
    if (spotDelta < bubSpotDeltaMin) return;
    this._pushItem(spotBucket, ceDelta, spotDelta, ratio, 'CE');
  },

  // ── PE bubble: color: ratio > 0 → red (premium rose = bearish), ratio ≤ 0 → green
  _tryEmitPE(peBucket, spotBucket) {
    if (!peBucket || !spotBucket) return;
    if (peBucket.time !== spotBucket.time) return;
    const peDelta   = peBucket.close - peBucket.open;
    if (peDelta === 0) return;
    const spotDelta = Math.abs(spotBucket.close - spotBucket.open);
    const spotAbs   = spotDelta || 0.01;
    const ratio = peDelta / spotAbs;
    if (Math.abs(ratio) < bubMinRatioPE) return;
    if (spotDelta < bubSpotDeltaMin) return;
    this._pushItem(spotBucket, peDelta, spotDelta, ratio, 'PE');
  },

  _pushItem(spotBucket, optDelta, spotDelta, ratio, optType) {
    const strike = optType === 'CE' ? selCEKey : selPEKey;
    this.items.push({
      time:      spotBucket.time,
      chartTime: this._chartTime(spotBucket.time),
      open:      spotBucket.open,
      spotClose: spotBucket.close,
      optDelta, spotDelta, ratio, optType, strike,
    });

    // Auto-save to server CSV
    if (ws && ws.readyState === WebSocket.OPEN && strike && typeof strike === 'string' && strike.trim()) {
      ws.send(JSON.stringify({
        type:       'bubble',
        strike:     strike.trim(),
        time:       spotBucket.time,
        open:       spotBucket.open,
        spot_close: spotBucket.close,
        ratio:      ratio,
      }));
    }
    if (this.items.length > this.MAX) this.items.shift();
    const el = document.getElementById('s-bubs');
    if (el) el.textContent = this.items.length;
    this.draw();
  },

  // ── Called with each raw candle from CE feed ──────────────────────────────
  pushCE5s(raw) {
    if (!raw) return;
    const flushed = this._acc5s(ce5Bucket, raw);
    if (flushed) { this._tryEmitCE(flushed, spot5Bucket._last); ce5Bucket._last = flushed; }
  },

  // ── Called with each raw candle from PE feed ──────────────────────────────
  pushPE5s(raw) {
    if (!raw) return;
    const flushed = this._acc5s(pe5Bucket, raw);
    if (flushed) { this._tryEmitPE(flushed, spot5Bucket._last); pe5Bucket._last = flushed; }
  },

  // ── Called with each raw candle from SPOT feed ────────────────────────────
  pushSpot5s(raw) {
    if (!raw) return;
    const flushed = this._acc5s(spot5Bucket, raw);
    if (flushed) {
      this._tryEmitCE(ce5Bucket._last, flushed);
      this._tryEmitPE(pe5Bucket._last, flushed);
      spot5Bucket._last = flushed;
    }
  },

  // ── Map (time, price) → canvas pixel ──────────────────────────────────────
  toXY(time, price) {
    if (!lwChart || !cSeries) return null;
    try {
      const x = lwChart.timeScale().timeToCoordinate(time + IST_OFFSET_S);
      const y = cSeries.priceToCoordinate(price);
      if (x == null || y == null) return null;
      return { x, y };
    } catch(_) { return null; }
  },

  _radius(b) {
    return Math.min(bubMaxSize, Math.max(this.MIN_R, Math.abs(b.ratio) * bubScale));
  },

  // ── DRAW ──────────────────────────────────────────────────────────────────
  draw() {
    if (!this.ctx || !this.canvas) return;
    this.sync();
    const ctx = this.ctx;
    const W   = this.canvas.width;
    const H   = this.canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!bubOn || this.items.length === 0) return;

    // Read color pickers once per draw
    const clrCEBull = document.getElementById('clr-ce-bull')?.value || '#00e676';
    const clrCEBear = document.getElementById('clr-ce-bear')?.value || '#ff3d5a';
    const clrPEBull = document.getElementById('clr-pe-bull')?.value || '#00e676';
    const clrPEBear = document.getElementById('clr-pe-bear')?.value || '#ff3d5a';

    // Read direction checkboxes
    const chkCEBullPos = document.getElementById('chk-ce-bull-pos')?.checked ?? true;
    const chkCEBullNeg = document.getElementById('chk-ce-bull-neg')?.checked ?? true;
    const chkCEBearPos = document.getElementById('chk-ce-bear-pos')?.checked ?? true;
    const chkCEBearNeg = document.getElementById('chk-ce-bear-neg')?.checked ?? true;
    const chkPEBullPos = document.getElementById('chk-pe-bull-pos')?.checked ?? true;
    const chkPEBullNeg = document.getElementById('chk-pe-bull-neg')?.checked ?? true;
    const chkPEBearPos = document.getElementById('chk-pe-bear-pos')?.checked ?? true;
    const chkPEBearNeg = document.getElementById('chk-pe-bear-neg')?.checked ?? true;

    this.items.forEach((b) => {
      // Per-type min ratio filter
      const minRatio = b.optType === 'CE' ? bubMinRatioCE : bubMinRatioPE;
      if (Math.abs(b.ratio) < minRatio) { b._x = undefined; return; }

      // Spot delta magnitude filter — only apply when spotDelta is actually stored
      // (CSV-loaded bubbles have spotDelta=0; skip the filter so they still show)
      if (b.spotDelta > 0 && b.spotDelta < bubSpotDeltaMin) { b._x = undefined; return; }

      // ── Classify bubble type & index direction ────────────────────────────
      // CE Bullish  → CE ratio > 0  (premium rose  → calls bid up → bullish)
      // CE Bearish  → CE ratio ≤ 0  (premium fell  → calls sold   → bearish)
      // PE Bullish  → PE ratio ≤ 0  (premium fell  → puts sold    → bullish)
      // PE Bearish  → PE ratio > 0  (premium rose  → puts bid up  → bearish)
      const isCE    = b.optType === 'CE';
      const isGreen = isCE ? (b.ratio > 0) : (b.ratio <= 0);

      // Index direction: did spot move up (+ve) or down (−ve) during this 5s bar?
      // Use spotClose−open when available; fall back to ratio sign as proxy.
      let spotPos;
      if (b.spotClose !== undefined && b.open !== undefined && b.spotClose !== b.open) {
        spotPos = (b.spotClose - b.open) > 0;
      } else {
        // Proxy: CE ratio>0 or PE ratio<0 both imply bullish pressure
        spotPos = isGreen;
      }

      // ── Checkbox visibility gate ──────────────────────────────────────────
      // ▲ +ve checkbox = show this bubble type when index went UP
      // ▼ −ve checkbox = show this bubble type when index went DOWN
      let visible = false;
      if ( isCE &&  isGreen) visible = spotPos ? chkCEBullPos : chkCEBullNeg;
      if ( isCE && !isGreen) visible = spotPos ? chkCEBearPos : chkCEBearNeg;
      if (!isCE &&  isGreen) visible = spotPos ? chkPEBullPos : chkPEBullNeg;
      if (!isCE && !isGreen) visible = spotPos ? chkPEBearPos : chkPEBearNeg;
      if (!visible) { b._x = undefined; return; }

      let hexColor;
      if (isCE && isGreen)  hexColor = clrCEBull;
      else if (isCE)        hexColor = clrCEBear;
      else if (isGreen)     hexColor = clrPEBull;
      else                  hexColor = clrPEBear;

      // Recalculate chartTime based on current selIv
      b.chartTime = (selIv === 60 || selIv === 300 || selIv === 900)
        ? Math.floor(b.time / selIv) * selIv
        : b.time;

      const pt = this.toXY(b.chartTime, b.open);
      if (!pt) { b._x = undefined; return; }

      let { x, y } = pt;

      // Spread bubbles within candle bar for aggregated timeframes
      if (selIv === 60 || selIv === 300 || selIv === 900) {
        const slot       = Math.round((b.time - b.chartTime) / 5);
        const totalSlots = selIv / 5;
        const x2         = lwChart.timeScale().timeToCoordinate(b.chartTime + selIv + IST_OFFSET_S);
        const candleW    = (x2 != null) ? Math.abs(x2 - x) : 0;
        if (candleW > 1) x = x + ((slot + 0.5) / totalSlots - 0.5) * candleW;
      }

      const r    = this._radius(b);
      const isHov = this.hovered === b;
      const rr   = isHov ? r * 1.3 : r;

      b._x = x; b._y = y; b._r = r;

      if (x + rr < 0 || x - rr > W || y + rr < 0 || y - rr > H) return;

      const op = Math.min(bubOpacity + (isHov ? 0.15 : 0), 1.0);

      // Parse hex → rgba
      const hr = parseInt(hexColor.slice(1,3), 16);
      const hg = parseInt(hexColor.slice(3,5), 16);
      const hb = parseInt(hexColor.slice(5,7), 16);

      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${hr},${hg},${hb},${op})`;
      ctx.fill();

      ctx.strokeStyle = `rgba(${Math.max(0,hr-30)},${Math.max(0,hg-30)},${Math.max(0,hb-30)},${Math.min(op+0.15,1)})`;
      ctx.lineWidth = isHov ? 2 : 1;
      ctx.stroke();

      // Ratio label inside circle
      if (rr >= 10) {
        const txt      = Math.abs(b.ratio).toFixed(1);
        const fontSize = Math.max(7, Math.min(rr * 0.50, 13));
        ctx.save();
        ctx.font         = `bold ${fontSize}px "JetBrains Mono", monospace`;
        ctx.fillStyle    = isGreen ? 'rgba(0,30,15,0.95)' : 'rgba(255,220,220,0.95)';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, x, y);
        ctx.restore();
      }
    });
  },

  // ── Mouse move ─────────────────────────────────────────────────────────────
  _onMove(e) {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;
    let hit    = null;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const b = this.items[i];
      if (b._x === undefined) continue;
      const dx = b._x - mx, dy = b._y - my;
      if (Math.sqrt(dx*dx + dy*dy) <= (b._r || 0) + 4) { hit = b; break; }
    }

    this.canvas.style.pointerEvents = hit ? 'all' : 'none';
    this.canvas.style.cursor        = hit ? 'crosshair' : '';

    if (hit !== this.hovered) { this.hovered = hit; this.draw(); }
    if (hit) this._showTip(e, hit);
    else     this._hideTip();
  },

  _onLeave() {
    this.canvas.style.pointerEvents = 'none';
    this.hovered = null;
    this._hideTip();
    this.draw();
  },

  _showTip(e, b) {
    const tip   = document.getElementById('bub-tip');
    const title = document.getElementById('btt-title');
    const body  = document.getElementById('btt-body');
    if (!tip || !title || !body) return;
    const isCE = b.optType === 'CE';
    const d    = new Date((b.time + IST_OFFSET_S) * 1000);
    const ts   = String(d.getUTCHours()).padStart(2,'0') + ':' +
                 String(d.getUTCMinutes()).padStart(2,'0') + ':' +
                 String(d.getUTCSeconds()).padStart(2,'0') + ' IST';

    const isGreenTip  = isCE ? (b.ratio > 0) : (b.ratio <= 0);
    title.textContent = isCE
      ? (b.ratio > 0 ? '🟢 CE Rising' : '🔴 CE Falling')
      : (b.ratio > 0 ? '🔴 PE Rising' : '🟢 PE Falling');
    title.className   = 'btt ' + (isGreenTip ? 'bull' : 'bear');

    const optClass = isGreenTip ? 'bull' : 'bear';
    body.innerHTML =
      `<span style="color:var(--muted)">Time</span>  ${ts}<br>` +
      `<span style="color:var(--muted)">Spot Open</span>  ${b.open.toFixed(2)}<br>` +
      `<span style="color:var(--muted)">Spot |C-O|5s</span>  <span class="bull">${b.spotDelta.toFixed(2)}</span><br>` +
      `<span style="color:var(--muted)">${b.optType} C-O 5s</span>  <span class="${optClass}">${b.optDelta.toFixed(2)}</span><br>` +
      `<span style="color:var(--muted)">Ratio</span>  <b>${b.ratio.toFixed(2)}×</b>`;

    const hoverEl = document.getElementById('bub-hover-info');
    if (hoverEl) hoverEl.textContent = `${b.optType} ${b.ratio > 0 ? '▲' : '▼'}  ratio=${b.ratio.toFixed(2)}×`;

    tip.style.display     = 'block';
    tip.style.borderColor = isGreenTip ? 'var(--green)' : 'var(--red)';
    let tx = e.clientX + 14, ty = e.clientY - 20;
    if (tx + 260 > window.innerWidth)  tx = e.clientX - 270;
    if (ty + 160 > window.innerHeight) ty = e.clientY - 165;
    tip.style.left = tx + 'px';
    tip.style.top  = ty + 'px';
  },

  _hideTip() {
    const tip = document.getElementById('bub-tip');
    if (tip) tip.style.display = 'none';
    const hoverEl = document.getElementById('bub-hover-info');
    if (hoverEl) hoverEl.textContent = '';
  },

  clear() {
    this.items   = [];
    this.hovered = null;
    this._hideTip();
    if (this.ctx && this.canvas)
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const el = document.getElementById('s-bubs');
    if (el) el.textContent = '0';
    ce5Bucket   = { cur: null, _last: null };
    pe5Bucket   = { cur: null, _last: null };
    spot5Bucket = { cur: null, _last: null };
  },
};

function setLiveMode(live) { _atRealTime = live; }
