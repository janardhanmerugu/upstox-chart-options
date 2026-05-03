// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION & EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  // selSym is intentionally NOT set here.
  // It gets assigned in optSelectStrike() when the user picks a CE/PE strike,
  // ensuring the spot chart subscription always matches the chosen underlying.
  document.getElementById('opt-chain-status').textContent = 'Connect & authenticate first';

  // ── Restore token from sessionStorage (survives refresh, clears on tab close) ──
  const savedToken = sessionStorage.getItem('upstox_token');
  if (savedToken) {
    const inp = document.getElementById('token-input');
    inp.value = savedToken;
    // Show a neutral hint — token is pre-filled but not yet re-validated with server
    document.getElementById('tok-msg').textContent = 'Token restored — click Connect then Save Token';
  }

  // Date picker init
  const dateEl = document.getElementById('csv-date');
  if (dateEl) {
    const today = new Date();
    const yyyy  = today.getFullYear();
    const mm    = String(today.getMonth()+1).padStart(2,'0');
    const dd    = String(today.getDate()).padStart(2,'0');
    dateEl.value = `${yyyy}-${mm}-${dd}`;
    // Do NOT call csvDateChanged() here — it triggers _ensureWSForCSV()
    // which auto-connects to the server before the user clicks Connect.
  }

  // History date pickers (function lives in ui.js)
  if (typeof initHistoryDates === 'function') initHistoryDates();

  // Chart click → add/remove horizontal lines
  document.getElementById('lw-chart').addEventListener('click', e => {
    if (!drawLineMode || !lwChart || !cSeries) return;
    const rect  = e.currentTarget.getBoundingClientRect();
    const price = cSeries.coordinateToPrice(e.clientY - rect.top);
    if (price == null) return;
    if (!removeNearestHLine(e.clientY, rect)) addHLine(price);
  });
});
