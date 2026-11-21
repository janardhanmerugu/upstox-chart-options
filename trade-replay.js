let importedTrades = [];
let tradeMarkerMatches = 0;
let tradeTickMatches = 0;
let historicalIndexTickInstrument = null;
let historicalIndexTicks = [];
let importedTradeFileName = '';
let bigLossThreshold = 800;
let highProfitThreshold = 800;
const tradeMoneyFormat = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function parseTradeCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        value += '"';
        index++;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"' && value.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(value.trim());
      value = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index++;
      row.push(value.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(value.trim());
  if (row.some(cell => cell !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('CSV must contain a header and at least one trade row.');

  const aliases = {
    row: 'rowNumber',
    serialno: 'rowNumber',
    id: 'rowNumber',
    instrument: 'instrument',
    symbol: 'instrument',
    tradingsymbol: 'instrument',
    cepe: 'optionType',
    optiontype: 'optionType',
    dir: 'direction',
    direction: 'direction',
    side: 'direction',
    entrytime: 'entryTime',
    entrydatetime: 'entryTime',
    exittime: 'exitTime',
    exitdatetime: 'exitTime',
    qty: 'quantity',
    quantity: 'quantity',
    entryprice: 'entryPrice',
    exitprice: 'exitPrice',
    pl: 'pnl',
    pnl: 'pnl',
    profitloss: 'pnl',
    profitandloss: 'pnl',
  };
  const headers = rows[0].map(header => {
    if (header.trim() === '#') return 'rowNumber';
    return aliases[header.toLowerCase().replace(/[^a-z0-9]/g, '')] || '';
  });
  const required = ['instrument', 'direction', 'entryTime', 'exitTime',
    'quantity', 'entryPrice', 'exitPrice', 'pnl'];
  const missing = required.filter(header => !headers.includes(header));
  if (missing.length) {
    throw new Error(`CSV is missing required columns: ${missing.join(', ')}.`);
  }

  const column = Object.fromEntries(headers.map((header, index) => [header, index]));
  const trades = [];
  const errors = [];
  for (let index = 1; index < rows.length; index++) {
    const cells = rows[index];
    const line = index + 1;
    try {
      const read = name => cells[column[name]] ?? '';
      const instrument = read('instrument').trim();
      const direction = read('direction').trim().toUpperCase();
      const optionType = (read('optionType') || '').trim().toUpperCase() ||
        (/\b(CE|PE)$/i.exec(instrument)?.[1]?.toUpperCase() || '');
      if (!instrument) throw new Error('Instrument is empty.');
      if (!['LONG', 'SHORT'].includes(direction)) {
        throw new Error('Dir must be LONG or SHORT.');
      }
      if (optionType && !['CE', 'PE'].includes(optionType)) {
        throw new Error('CE/PE must be CE or PE.');
      }

      const entryTime = parseTradeTimestamp(read('entryTime'));
      const exitTime = parseTradeTimestamp(read('exitTime'));
      if (exitTime.timestampMs < entryTime.timestampMs) {
        throw new Error('Exit Time cannot be before Entry Time.');
      }

      const quantity = parseTradeNumber(read('quantity'), 'Qty');
      if (quantity <= 0) throw new Error('Qty must be greater than zero.');
      const entryPrice = parseTradeNumber(read('entryPrice'), 'Entry Price');
      const exitPrice = parseTradeNumber(read('exitPrice'), 'Exit Price');
      const pnl = parseTradeNumber(read('pnl'), 'P&L');
      const suppliedNumber = read('rowNumber').trim();

      trades.push({
        label: suppliedNumber || String(index),
        instrument,
        optionType,
        direction,
        entryDate: entryTime.date,
        exitDate: exitTime.date,
        entryTimeMs: entryTime.timestampMs,
        exitTimeMs: exitTime.timestampMs,
        entryTimeLabel: entryTime.label,
        exitTimeLabel: exitTime.label,
        quantity,
        entryPrice,
        exitPrice,
        pnl,
      });
    } catch (error) {
      errors.push(`Line ${line}: ${error.message}`);
    }
  }
  if (errors.length) {
    const shown = errors.slice(0, 5).join(' ');
    const remaining = errors.length > 5 ? ` ${errors.length - 5} more invalid row(s).` : '';
    throw new Error(`${shown}${remaining}`);
  }
  if (!trades.length) throw new Error('CSV contains no trade rows.');
  return trades.sort((left, right) => left.entryTimeMs - right.entryTimeMs);
}

function parseTradeTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) throw new Error('Times must use YYYY-MM-DD HH:mm:ss.');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = ''] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = fraction ? Number(fraction.padEnd(3, '0')) : 0;
  const wallTimeMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const date = new Date(wallTimeMs);
  if (year < 1000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) {
    throw new Error('Time contains an invalid date or clock value.');
  }
  return {
    timestampMs: wallTimeMs - IST_OFFSET_MS,
    date: `${yearText}-${monthText}-${dayText}`,
    label: `${hourText}:${minuteText}:${secondText}`,
  };
}

function parseTradeNumber(value, label) {
  const normalized = value.trim().replace(/[,₹\s]/g, '');
  const number = Number(normalized);
  if (!normalized || !Number.isFinite(number)) {
    throw new Error(`${label} must be a valid number.`);
  }
  return number;
}

function formatTradeMoney(value, withSign = false) {
  const formatted = tradeMoneyFormat.format(Math.abs(value));
  if (!withSign) return `₹${value < 0 ? '-' : ''}${formatted}`;
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}₹${formatted}`;
}

function selectedTradeFilters() {
  return {
    bigLoss: document.getElementById('trade-filter-big-loss')?.checked ?? false,
    good: document.getElementById('trade-filter-good')?.checked ?? false,
    bad: document.getElementById('trade-filter-bad')?.checked ?? false,
    highProfit: document.getElementById('trade-filter-high-profit')?.checked ?? false,
  };
}

function visibleTradesFor(assessments) {
  const filters = selectedTradeFilters();
  const selected = Object.values(filters).some(Boolean);
  return importedTrades.filter(trade => {
    if (!selected) return true;
    const matches = [];
    if (filters.bigLoss) matches.push(trade.pnl <= -bigLossThreshold);
    if (filters.good) matches.push(assessments.get(trade)?.matched === true);
    if (filters.bad) matches.push(assessments.get(trade)?.matched === false);
    if (filters.highProfit) matches.push(trade.pnl >= highProfitThreshold);
    return matches.every(Boolean);
  });
}

function setTradeFiltersEnabled(enabled) {
  const options = document.getElementById('trade-filter-options');
  if (options) options.disabled = !enabled;
}

function onTradeFiltersChanged(event) {
  if (!importedTrades.length) return;
  const field = event?.currentTarget;
  if (field?.id === 'trade-filter-big-loss-threshold' ||
      field?.id === 'trade-filter-high-profit-threshold') {
    const threshold = field.valueAsNumber;
    if (!Number.isFinite(threshold) || threshold < 0) {
      field.setCustomValidity('Enter a non-negative P&L threshold.');
      field.reportValidity();
      return;
    }
    field.setCustomValidity('');
    if (field.id === 'trade-filter-big-loss-threshold') bigLossThreshold = threshold;
    else highProfitThreshold = threshold;
  }
  renderImportedTrades();
  renderTradeMarkers();
}

function onTradeCsvSelected(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const status = document.getElementById('trade-csv-status');
  status.textContent = `Reading ${file.name}…`;
  file.text().then(text => {
    const trades = parseTradeCsv(text);
    importedTrades = trades;
    importedTradeFileName = file.name;
    ['trade-filter-big-loss', 'trade-filter-good', 'trade-filter-bad', 'trade-filter-high-profit']
      .forEach(id => {
        const filter = document.getElementById(id);
        if (filter) filter.checked = false;
      });
    tradeMarkerMatches = 0;
    renderImportedTrades();
    renderTradeMarkers();
  }).catch(error => {
    status.textContent = `Could not load CSV: ${error.message}`;
  }).finally(() => {
    input.value = '';
  });
}

function renderImportedTrades() {
  const totalPnl = importedTrades.reduce((sum, trade) => sum + trade.pnl, 0);
  const wins = importedTrades.filter(trade => trade.pnl > 0).length;
  const losses = importedTrades.filter(trade => trade.pnl < 0).length;
  const summary = document.getElementById('trade-summary');
  summary.hidden = false;
  document.getElementById('trade-count').textContent = importedTrades.length;
  document.getElementById('trade-win-loss').textContent = `${wins} / ${losses}`;
  const netPnl = document.getElementById('trade-net-pnl');
  netPnl.textContent = formatTradeMoney(totalPnl, true);
  netPnl.classList.toggle('trade-loss', totalPnl < 0);
  netPnl.classList.toggle('trade-profit', totalPnl > 0);
  document.getElementById('trade-load-dates-btn').disabled = false;
  document.getElementById('trade-clear-btn').disabled = false;
  setTradeFiltersEnabled(true);

  const body = document.getElementById('trade-list-body');
  body.replaceChildren();
  const visibleTrades = visibleTradesFor(tradeSignalAssessments());
  visibleTrades.forEach(trade => {
    const row = document.createElement('tr');
    const instrument = document.createElement('td');
    instrument.textContent = `#${trade.label} ${trade.instrument}`;
    row.appendChild(instrument);
    const entry = document.createElement('td');
    entry.textContent = `${trade.entryDate} ${trade.entryTimeLabel} @ ${tradeMoneyFormat.format(trade.entryPrice)}`;
    row.appendChild(entry);
    const exit = document.createElement('td');
    exit.textContent = `${trade.exitDate} ${trade.exitTimeLabel} @ ${tradeMoneyFormat.format(trade.exitPrice)}`;
    row.appendChild(exit);
    const quantity = document.createElement('td');
    quantity.textContent = trade.quantity.toLocaleString('en-IN');
    row.appendChild(quantity);
    const pnl = document.createElement('td');
    pnl.textContent = formatTradeMoney(trade.pnl, true);
    pnl.className = trade.pnl < 0 ? 'trade-loss' : trade.pnl > 0 ? 'trade-profit' : '';
    row.appendChild(pnl);
    body.appendChild(row);
  });
  const filterStatus = document.getElementById('trade-filter-status');
  if (filterStatus) {
    filterStatus.hidden = false;
    filterStatus.textContent = `${importedTradeFileName}: showing ${visibleTrades.length} of ${importedTrades.length}; totals above include all trades.`;
  }
}

function chartTimeForTrade(timestampMs) {
  const interval = chartIntervalSeconds();
  const chartSeconds = timestampMs / 1000 + IST_OFFSET_S;
  return Math.floor(chartSeconds / interval) * interval;
}

function setTradeHistoricalTicks(instrument, ticks) {
  historicalIndexTickInstrument = instrument;
  historicalIndexTicks = Array.isArray(ticks)
    ? ticks.map(tick => ({
      timestamp: Number(tick.timestamp),
      ltp: Number(tick.ltp),
    })).filter(tick => Number.isFinite(tick.timestamp) && Number.isFinite(tick.ltp))
      .sort((left, right) => left.timestamp - right.timestamp)
    : [];
}

function historicalIndexTickAtOrBefore(timestampMs) {
  if (historicalIndexTickInstrument !== selSym || !historicalIndexTicks.length) return null;
  let low = 0;
  let high = historicalIndexTicks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (historicalIndexTicks[middle].timestamp <= timestampMs) low = middle + 1;
    else high = middle;
  }
  const tick = historicalIndexTicks[low - 1];
  if (!tick ||
      Math.floor((tick.timestamp + IST_OFFSET_MS) / 86400000) !==
        Math.floor((timestampMs + IST_OFFSET_MS) / 86400000)) return null;
  return tick;
}

function tradeOptionTypeLabel(trade) {
  return trade.optionType || (/\b(CE|PE)$/i.exec(trade.instrument)?.[1]?.toUpperCase() || '');
}

function tradeSignalAssessments() {
  const buySignalTimes = new Set((OIB.lastBuySignals || []).map(signal =>
    chartTimeForTrade(Number(signal.time) * 1000)
  ));
  const sellSignalTimes = new Set((OIB.lastSellSignals || []).map(signal =>
    chartTimeForTrade(Number(signal.time) * 1000)
  ));
  return new Map(importedTrades.map(trade => {
    const optionType = tradeOptionTypeLabel(trade);
    const expectedSignal = optionType === 'CE' ? 'BUY' : optionType === 'PE' ? 'SELL' : '';
    const entryTime = chartTimeForTrade(trade.entryTimeMs);
    const matched = expectedSignal === 'BUY'
      ? buySignalTimes.has(entryTime)
      : expectedSignal === 'SELL' && sellSignalTimes.has(entryTime);
    return [trade, { expectedSignal, matched }];
  }));
}

function renderTradeQualitySummary(assessments, trades) {
  const summary = document.getElementById('trade-quality-summary');
  if (!summary) return;
  summary.replaceChildren();
  summary.hidden = !trades.length;
  if (!trades.length) return;

  const goodCount = trades.filter(trade => assessments.get(trade)?.matched).length;
  const badCount = trades.length - goodCount;
  const goodPnl = trades.reduce((total, trade) =>
    total + (assessments.get(trade)?.matched ? trade.pnl : 0), 0);
  const badPnl = trades.reduce((total, trade) =>
    total + (!assessments.get(trade)?.matched ? trade.pnl : 0), 0);
  const title = document.createElement('strong');
  title.className = 'trade-quality-title';
  title.textContent = 'TRADE CHECK';
  const good = document.createElement('span');
  good.className = 'trade-quality-metric trade-quality-good';
  good.textContent = `GOOD ${goodCount}`;
  const bad = document.createElement('span');
  bad.className = 'trade-quality-metric trade-quality-bad';
  bad.textContent = `BAD ${badCount}`;
  const goodPnlLabel = document.createElement('span');
  goodPnlLabel.className = `trade-quality-metric trade-quality-pnl ${
    goodPnl > 0 ? 'is-profit' : goodPnl < 0 ? 'is-loss' : 'is-flat'
  }`;
  goodPnlLabel.textContent = `GOOD P&L ${formatTradeMoney(goodPnl, true)}`;
  goodPnlLabel.title = 'Cumulative P&L from trades whose entry signal matched.';
  const badPnlLabel = document.createElement('span');
  badPnlLabel.className = `trade-quality-metric trade-quality-pnl ${
    badPnl > 0 ? 'is-profit' : badPnl < 0 ? 'is-loss' : 'is-flat'
  }`;
  badPnlLabel.textContent = `BAD P&L ${formatTradeMoney(badPnl, true)}`;
  badPnlLabel.title = 'Cumulative P&L from trades whose entry signal did not match.';
  summary.append(title, good, bad, goodPnlLabel, badPnlLabel);
}

function renderTradeMarkers() {
  const overlay = document.getElementById('trade-marker-overlay');
  if (!overlay) return;
  overlay.replaceChildren();
  const assessments = tradeSignalAssessments();
  const visibleTrades = visibleTradesFor(assessments);
  renderTradeQualitySummary(assessments, visibleTrades);
  const totalEvents = visibleTrades.length * 2;
  if (!cSeries || !lwChart) {
    tradeMarkerMatches = 0;
    tradeTickMatches = 0;
    updateTradeMarkerStatus(totalEvents);
    return;
  }

  const labelsByEvent = new Map();
  let matchedEvents = 0;
  let matchedTicks = 0;
  const exits = importedTrades.slice().sort((left, right) =>
    left.exitTimeMs - right.exitTimeMs
  );
  const cumulativeExits = [];
  let runningPnl = 0;
  exits.forEach(trade => {
    runningPnl += trade.pnl;
    cumulativeExits.push({ timestampMs: trade.exitTimeMs, pnl: runningPnl });
  });
  const cumulativePnlAt = timestampMs => {
    let low = 0;
    let high = cumulativeExits.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (cumulativeExits[middle].timestampMs <= timestampMs) low = middle + 1;
      else high = middle;
    }
    return low ? cumulativeExits[low - 1].pnl : 0;
  };

  visibleTrades.forEach((trade, index) => {
    const events = [
      { side: 'IN', timestampMs: trade.entryTimeMs },
      { side: 'OUT', timestampMs: trade.exitTimeMs },
    ];
    events.forEach(event => {
      const tick = historicalIndexTickAtOrBefore(event.timestampMs);
      if (!tick) return;
      matchedTicks++;
      const time = chartTimeForTrade(event.timestampMs);
      const candleIndex = cMap[time];
      if (candleIndex == null || cData[candleIndex]?.open == null) return;
      matchedEvents++;
      const optionType = tradeOptionTypeLabel(trade);
      const key = `${time}|${optionType}|${event.side}|${tick.timestamp}`;
      if (!labelsByEvent.has(key)) {
        labelsByEvent.set(key, {
          time,
          side: event.side,
          optionType,
          indexTick: tick,
          events: [],
        });
      }
      labelsByEvent.get(key).events.push({
        trade,
        label: trade.label || String(index + 1),
        timestampMs: event.timestampMs,
        side: event.side,
        signalAssessment: assessments.get(trade),
      });
    });
  });

  const labels = [...labelsByEvent.values()]
    .map(group => {
      const x = lwChart.timeScale().timeToCoordinate(group.time);
      if (x == null) return null;
      const y = cSeries.priceToCoordinate(group.indexTick.ltp);
      if (y == null) return null;
      const label = document.createElement('div');
      const qualityClass = group.side === 'IN'
        ? ` is-${group.events.every(event => event.signalAssessment.matched) ? 'good'
          : group.events.every(event => !event.signalAssessment.matched) ? 'bad' : 'mixed'}-trade`
        : '';
      label.className = `trade-marker-label ${group.side === 'IN' ? 'is-entry' : 'is-exit'}${qualityClass}`;
      const mainLine = document.createElement('span');
      mainLine.className = 'trade-marker-main';
      mainLine.appendChild(document.createTextNode(
        `${group.optionType ? `${group.optionType} ` : ''}${group.side} `
      ));
      group.events.forEach((event, index) => {
        if (index > 0) mainLine.appendChild(document.createTextNode(', '));
        mainLine.appendChild(document.createTextNode(`#${event.label}`));
        if (group.side === 'OUT') {
          mainLine.appendChild(document.createTextNode(' '));
          const pnl = document.createElement('span');
          pnl.className = event.trade.pnl > 0 ? 'trade-profit'
            : event.trade.pnl < 0 ? 'trade-loss' : 'trade-flat';
          pnl.textContent = formatTradeMoney(event.trade.pnl, true);
          mainLine.appendChild(pnl);
        }
      });
      label.appendChild(mainLine);
      const cumulativeTime = Math.max(...group.events.map(event => event.timestampMs));
      const cumulativePnl = cumulativePnlAt(cumulativeTime);
      const cumulativeLine = document.createElement('span');
      cumulativeLine.className = `trade-marker-cumulative ${
        cumulativePnl > 0 ? 'trade-profit' : cumulativePnl < 0 ? 'trade-loss' : 'trade-flat'
      }`;
      cumulativeLine.textContent = `Cum ${formatTradeMoney(cumulativePnl, true)}`;
      label.appendChild(cumulativeLine);
      label.style.left = `${x}px`;
      const details = group.events.map(event => {
        const trade = event.trade;
        const timeLabel = event.side === 'IN' ? trade.entryTimeLabel : trade.exitTimeLabel;
        const dateLabel = event.side === 'IN' ? trade.entryDate : trade.exitDate;
        const price = event.side === 'IN' ? trade.entryPrice : trade.exitPrice;
        const signalResult = event.side === 'IN' && event.signalAssessment.expectedSignal
          ? event.signalAssessment.matched
            ? `${event.signalAssessment.expectedSignal} signal matched`
            : `${event.signalAssessment.expectedSignal} signal missing`
          : event.side === 'IN' ? 'CE/PE type unavailable' : '';
        const signalDetail = signalResult ? `, ${signalResult}` : '';
        return `${event.side} #${event.label} ${dateLabel} ${timeLabel} @ ${tradeMoneyFormat.format(price)}, Index ${tradeMoneyFormat.format(group.indexTick.ltp)}${signalDetail}, Qty ${trade.quantity}, P&L ${formatTradeMoney(trade.pnl, true)}`;
      });
      label.title = `${details.join('\n')}\nCumulative P&L ${formatTradeMoney(cumulativePnl, true)}`;
      const longestLine = Math.max(mainLine.textContent.length, cumulativeLine.textContent.length);
      const width = Math.min(240, longestLine * 7.5 + 16);
      if (x < -width / 2 || x > overlay.clientWidth + width / 2) return null;
      return { element: label, x, y, width };
    })
    .filter(Boolean)
    .sort((left, right) => left.x - right.x || left.y - right.y);

  const placedLabels = [];
  labels.forEach(({ element, x, y, width }) => {
    const center = Math.max(width / 2 + 2, Math.min(overlay.clientWidth - width / 2 - 2, x));
    element.style.left = `${center}px`;
    const offsets = [0];
    for (let distance = 42; distance <= overlay.clientHeight; distance += 42) {
      offsets.push(-distance, distance);
    }
    const top = offsets.map(offset =>
      Math.max(22, Math.min(overlay.clientHeight - 22, y + offset))
    ).find(candidate => !placedLabels.some(previous =>
      Math.abs(center - previous.x) < (width + previous.width) / 2 + 4 &&
      Math.abs(candidate - previous.y) < 42
    )) ?? Math.max(22, Math.min(overlay.clientHeight - 22, y));
    element.style.top = `${top}px`;
    overlay.appendChild(element);
    placedLabels.push({ x: center, y: top, width });
  });

  tradeMarkerMatches = matchedEvents;
  tradeTickMatches = matchedTicks;
  updateTradeMarkerStatus(totalEvents);
}

function updateTradeMarkerStatus(totalEvents = importedTrades.length * 2) {
  const status = document.getElementById('trade-csv-status');
  const visibleTradeCount = totalEvents / 2;
  if (!importedTrades.length) {
    status.textContent = 'No trade CSV loaded.';
    return;
  }
  if (historicalIndexTickInstrument !== selSym || !historicalIndexTicks.length) {
    status.textContent = `${visibleTradeCount} visible trade(s). Load matching index history with historical ticks to place exact-price markers.`;
    return;
  }
  if (!cSeries || !cData.length) {
    status.textContent = `${visibleTradeCount} visible trade(s). Load matching index candles to place markers.`;
    return;
  }
  const missing = totalEvents - tradeMarkerMatches;
  status.textContent = missing
    ? `${tradeMarkerMatches} of ${totalEvents} markers placed at historical tick prices (${tradeTickMatches} timestamps matched ticks; ${missing} missing tick or candle matches).`
    : `${visibleTradeCount} visible trade(s); all ${totalEvents} entry/exit markers placed at historical tick prices.`;
}

function loadTradeDateRange() {
  if (!importedTrades.length) return;
  const dates = importedTrades.flatMap(trade => [trade.entryDate, trade.exitDate]).sort();
  document.getElementById('index-history-from').value = dates[0];
  document.getElementById('index-history-to').value = dates[dates.length - 1];
  loadIndexChart();
}

function clearTradeCsv() {
  importedTrades = [];
  importedTradeFileName = '';
  tradeMarkerMatches = 0;
  tradeTickMatches = 0;
  ['trade-filter-big-loss', 'trade-filter-good', 'trade-filter-bad', 'trade-filter-high-profit']
    .forEach(id => {
      const filter = document.getElementById(id);
      if (filter) filter.checked = false;
    });
  setTradeFiltersEnabled(false);
  document.getElementById('trade-summary').hidden = true;
  document.getElementById('trade-list-body').replaceChildren();
  document.getElementById('trade-load-dates-btn').disabled = true;
  document.getElementById('trade-clear-btn').disabled = true;
  const filterStatus = document.getElementById('trade-filter-status');
  if (filterStatus) {
    filterStatus.hidden = true;
    filterStatus.textContent = '';
  }
  document.getElementById('trade-csv-status').textContent = 'No trade CSV loaded.';
  renderTradeMarkers();
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('trade-csv-input').addEventListener('change', onTradeCsvSelected);
});
