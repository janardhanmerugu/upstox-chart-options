// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION & EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  const rightContent = document.getElementById('right-drawer-content');
  const oiPanel = document.querySelector('.oi-panel');
  const bubbleFilters = document.getElementById('bubble-filter-controls');
  const bubbleFilterBody = document.getElementById('bubble-filter-body');
  const bubbleConfig = [...document.querySelectorAll('#side-drawer>.ds')]
    .find(section => section.querySelector('.ds-title')?.textContent.includes('Delta Change'));
  if (rightContent) {
    if (bubbleFilters && bubbleFilterBody) bubbleFilterBody.appendChild(bubbleFilters);
    if (oiPanel) rightContent.appendChild(oiPanel);
    if (bubbleConfig) rightContent.appendChild(bubbleConfig);
    setupRightDrawerAccordion(rightContent);
  }

  // selSym is intentionally NOT set here.
  // It gets assigned in optSelectStrike() when the user picks a CE/PE strike,
  // ensuring the spot chart subscription always matches the chosen underlying.
  document.getElementById('opt-chain-status').textContent = 'Connect & authenticate first';

  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const dateValue = date => date.toISOString().slice(0, 10);
  document.getElementById('oi-from').value = dateValue(weekAgo);
  document.getElementById('oi-to').value = dateValue(today);

  // ── Restore token from sessionStorage (survives refresh, clears on tab close) ──
  const defaultToken = 'eyJ0eXAiOiJKV1QiLCJrZXlfaWQiOiJza192MS4wIiwiYWxnIjoiSFMyNTYifQ.eyJzdWIiOiJCTTY3OTIiLCJqdGkiOiI2YTMwYzU3ZmY4NWUzZTY2MTgwNmM4N2UiLCJpc011bHRpQ2xpZW50IjpmYWxzZSwiaXNQbHVzUGxhbiI6dHJ1ZSwiaXNFeHRlbmRlZCI6dHJ1ZSwiaWF0IjoxNzgxNTgxMTgzLCJpc3MiOiJ1ZGFwaS1nYXRld2F5LXNlcnZpY2UiLCJleHAiOjE4MTMxODMyMDB9.XujS7CgYRW1uCm_zhdhHza9rrCD1BBE4vG03lPglqz8';
  const savedToken = sessionStorage.getItem('upstox_token') || defaultToken;
  if (savedToken) {
    const inp = document.getElementById('token-input');
    inp.value = savedToken;
    // Show a neutral hint — token is pre-filled but not yet re-validated with server
    document.getElementById('tok-msg').textContent = 'Token restored — click Connect then Save Token';
  }


  // Ctrl + Left-click → add / remove nearest horizontal line
  document.getElementById('chart-con').addEventListener('click', e => {
    if (!e.ctrlKey || !lwChart || !cSeries) return;
    const rect  = document.getElementById('lw-chart').getBoundingClientRect();
    const price = cSeries.coordinateToPrice(e.clientY - rect.top);
    if (price == null) return;
    if (!removeNearestHLine(e.clientY, rect)) addHLine(price);
  });

  // Ctrl + C → clear all horizontal lines
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.key === 'c') {
      if (hLines.length === 0) return;
      e.preventDefault();
      clearAllLines();
    }
  });

  connectWS();
});

function setupRightDrawerAccordion(container) {
  const sections = [...container.querySelectorAll('.ds')];
  sections.forEach((section, index) => {
    const title = section.querySelector('.ds-title');
    if (!title) return;

    section.classList.add('accordion-section');
    title.classList.add('accordion-trigger');
    title.setAttribute('role', 'button');
    title.setAttribute('tabindex', '0');
    title.setAttribute('aria-expanded', index === 0 ? 'true' : 'false');
    title.setAttribute('aria-controls', `right-section-${index}`);

    const body = document.createElement('div');
    body.className = 'accordion-body';
    body.id = `right-section-${index}`;
    while (title.nextSibling) body.appendChild(title.nextSibling);
    section.appendChild(body);

    const toggle = () => {
      const expanded = section.classList.toggle('expanded');
      title.setAttribute('aria-expanded', String(expanded));
    };

    title.addEventListener('click', toggle);
    title.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });

    if (index === 0) section.classList.add('expanded');
  });
}
