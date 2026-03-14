'use strict';

const axios = require('axios');

const AMFI_NAV_URL = 'https://www.amfiindia.com/spages/NAVAll.txt';
const MFAPI_BASE = 'https://api.mfapi.in/mf';

// Fetch the full AMFI NAV file and build a map of ISIN -> { nav, schemeName, schemeCode, date }
async function fetchAMFIData() {
  const response = await axios.get(AMFI_NAV_URL, { responseType: 'text' });
  const lines = response.data.split('\n');

  const isinMap = {};
  for (const line of lines) {
    const parts = line.split(';');
    if (parts.length < 6) continue;

    const schemeCode = parts[0].trim();
    const isinGrowth = parts[1].trim();
    const isinDivReinvest = parts[2].trim();
    const schemeName = parts[3].trim();
    const nav = parseFloat(parts[4].trim());
    const date = parts[5].trim();

    if (!schemeCode || isNaN(nav)) continue;

    for (const isin of [isinGrowth, isinDivReinvest]) {
      if (isin && isin.startsWith('INF')) {
        isinMap[isin] = { schemeCode, schemeName, nav, date };
      }
    }
  }

  return isinMap;
}

// Fetch historical NAV from mfapi.in and compute returns over various periods
async function fetchHistoricalReturns(schemeCode) {
  try {
    const response = await axios.get(`${MFAPI_BASE}/${schemeCode}`, { timeout: 8000 });
    const data = response.data.data; // array of { date: "DD-MM-YYYY", nav: "123.45" }

    if (!data || data.length === 0) return null;

    const latestNav = parseFloat(data[0].nav);

    const findNavDaysAgo = (days) => {
      const target = new Date();
      target.setDate(target.getDate() - days);
      for (const entry of data) {
        const [d, m, y] = entry.date.split('-').map(Number);
        const entryDate = new Date(y, m - 1, d);
        if (entryDate <= target) return parseFloat(entry.nav);
      }
      return null;
    };

    const nav1M  = findNavDaysAgo(30);
    const nav3M  = findNavDaysAgo(90);
    const nav6M  = findNavDaysAgo(180);
    const nav1Y  = findNavDaysAgo(365);
    const nav3Y  = findNavDaysAgo(1095);

    const pct  = (old, cur) => old ? (((cur - old) / old) * 100).toFixed(2) : null;
    const cagr = (old, cur, yrs) => old ? ((Math.pow(cur / old, 1 / yrs) - 1) * 100).toFixed(2) : null;

    return {
      returns: {
        '1M':      pct(nav1M, latestNav),
        '3M':      pct(nav3M, latestNav),
        '6M':      pct(nav6M, latestNav),
        '1Y':      pct(nav1Y, latestNav),
        '3Y_CAGR': cagr(nav3Y, latestNav, 3),
      },
    };
  } catch {
    return null;
  }
}

// Main: enrich all holdings with current NAV and performance data
async function enrichHoldings(holdings) {
  console.log('Fetching current NAV data from AMFI...');
  const amfiMap = await fetchAMFIData();

  const enriched = [];

  for (const holding of holdings) {
    const amfi = amfiMap[holding.isin];

    if (!amfi) {
      console.warn(`  ISIN not found in AMFI data: ${holding.isin}`);
      enriched.push({ ...holding, currentNav: null, currentValue: null, returns: null });
      continue;
    }

    const units = holding.totalUnits || holding.units;
    const currentNav = amfi.nav;
    const currentValue = parseFloat((units * currentNav).toFixed(2));

    console.log(`  Fetching history for: ${amfi.schemeName.substring(0, 55)}...`);
    const history = await fetchHistoricalReturns(amfi.schemeCode);

    enriched.push({
      ...holding,
      schemeName: amfi.schemeName,
      currentNav,
      navDate: amfi.date,
      currentValue,
      returns: history ? history.returns : null,
    });
  }

  return enriched;
}

module.exports = { enrichHoldings };
