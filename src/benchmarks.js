'use strict';

const yahooFinance = require('yahoo-finance2').default;

const BENCHMARKS = {
  nifty50: { symbol: '^NSEI',       label: 'NIFTY 50' },
  sensex:  { symbol: '^BSESN',      label: 'SENSEX' },
  gold:    { symbol: 'GOLDBEES.NS', label: 'Gold (GOLDBEES)' },
};

async function fetchBenchmarkReturns(symbol) {
  const start = new Date();
  start.setFullYear(start.getFullYear() - 3);
  start.setDate(start.getDate() - 10); // small buffer for weekends/holidays

  const data = await yahooFinance.historical(symbol, {
    period1: start,
    period2: new Date(),
    interval: '1d',
  }, { validateResult: false });

  if (!data || data.length === 0) return null;

  // Sort descending (most recent first)
  data.sort((a, b) => new Date(b.date) - new Date(a.date));

  const latestClose = data[0].adjClose ?? data[0].close;

  const findCloseDaysAgo = (days) => {
    const target = new Date();
    target.setDate(target.getDate() - days);
    for (const entry of data) {
      if (new Date(entry.date) <= target) return entry.adjClose ?? entry.close;
    }
    return null;
  };

  const price1M = findCloseDaysAgo(30);
  const price3M = findCloseDaysAgo(90);
  const price6M = findCloseDaysAgo(180);
  const price1Y = findCloseDaysAgo(365);
  const price3Y = findCloseDaysAgo(1095);

  const pct  = (old, cur) => old ? (((cur - old) / old) * 100).toFixed(2) : null;
  const cagr = (old, cur, yrs) => old ? ((Math.pow(cur / old, 1 / yrs) - 1) * 100).toFixed(2) : null;

  return {
    '1M':      pct(price1M, latestClose),
    '3M':      pct(price3M, latestClose),
    '6M':      pct(price6M, latestClose),
    '1Y':      pct(price1Y, latestClose),
    '3Y_CAGR': cagr(price3Y, latestClose, 3),
  };
}

async function fetchBenchmarks() {
  const results = {};
  for (const [key, { symbol, label }] of Object.entries(BENCHMARKS)) {
    console.log(`  Fetching benchmark: ${label}...`);
    try {
      const returns = await fetchBenchmarkReturns(symbol);
      results[key] = { label, returns };
    } catch (err) {
      console.warn(`  Warning: could not fetch ${label}: ${err.message}`);
      results[key] = { label, returns: null };
    }
  }
  return results;
}

module.exports = { fetchBenchmarks };
