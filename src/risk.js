'use strict';

// Category classification based on ISIN / scheme name keywords
function classifyFund(holding) {
  const name = (holding.schemeName || holding.name || '').toLowerCase();

  if (name.includes('midcap') || name.includes('mid cap')) return 'Mid Cap';
  if (name.includes('nasdaq') || name.includes('fund of fund') || name.includes('fof')) return 'International / FoF';
  if (name.includes('elss') || name.includes('tax saver') || name.includes('tax saving')) return 'ELSS (Tax Saving)';
  if (name.includes('flexi cap') || name.includes('flexicap')) return 'Flexi Cap';
  if (name.includes('large cap') || name.includes('largecap')) return 'Large Cap';
  if (name.includes('small cap') || name.includes('smallcap')) return 'Small Cap';
  if (name.includes('opportunities')) return 'Thematic / Opportunities';
  return 'Other';
}

const PERIODS = ['1M', '3M', '6M', '1Y', '3Y_CAGR'];

// Compute weighted portfolio return for each period, normalising over funds that have data
function computeWeightedReturns(fundBreakdown) {
  const weighted = {};
  for (const period of PERIODS) {
    const fundsWithData = fundBreakdown.filter(f => f.returns[period] != null);
    if (fundsWithData.length === 0) { weighted[period] = null; continue; }
    const totalWeight = fundsWithData.reduce((s, f) => s + f.weight, 0);
    const value = fundsWithData.reduce((s, f) => s + (f.weight / totalWeight) * parseFloat(f.returns[period]), 0);
    weighted[period] = value.toFixed(2);
  }
  return weighted;
}

// Compare portfolio returns vs each benchmark; positive delta = portfolio beat the benchmark
function computeBenchmarkComparison(portfolioReturns, benchmarks) {
  const comparison = {};
  for (const [key, { label, returns }] of Object.entries(benchmarks)) {
    if (!returns) { comparison[key] = { label, returns: null, delta: null }; continue; }
    const delta = {};
    for (const period of PERIODS) {
      const p = portfolioReturns[period];
      const b = returns[period];
      delta[period] = (p != null && b != null) ? (parseFloat(p) - parseFloat(b)).toFixed(2) : null;
    }
    comparison[key] = { label, returns, delta };
  }
  return comparison;
}

function analyzeRisk(enrichedHoldings, benchmarks = {}) {
  const totalCurrentValue = enrichedHoldings.reduce((sum, h) => sum + (h.currentValue || 0), 0);

  // Per-fund breakdown
  const fundBreakdown = enrichedHoldings.map(h => {
    const value = h.currentValue || 0;
    const weight = totalCurrentValue > 0 ? (value / totalCurrentValue) * 100 : 0;
    const category = classifyFund(h);
    return {
      name: h.schemeName || h.name,
      isin: h.isin,
      category,
      value,
      weight: parseFloat(weight.toFixed(2)),
      returns: h.returns || {},
      holdingType: h.type === 'demat' ? 'Demat (MF)' : 'Folio (MF)',
    };
  }).sort((a, b) => b.value - a.value);

  // Category-level concentration
  const categoryMap = {};
  for (const fund of fundBreakdown) {
    if (!categoryMap[fund.category]) categoryMap[fund.category] = { value: 0, weight: 0, funds: [] };
    categoryMap[fund.category].value += fund.value;
    categoryMap[fund.category].funds.push(fund.name);
  }
  for (const cat of Object.values(categoryMap)) {
    cat.weight = parseFloat(((cat.value / totalCurrentValue) * 100).toFixed(2));
  }

  // Concentration risk: top fund weight
  const topFundWeight = fundBreakdown[0]?.weight || 0;
  const top2Weight = (fundBreakdown[0]?.weight || 0) + (fundBreakdown[1]?.weight || 0);

  // ELSS overlap check (same fund held in both demat and folio)
  const elssHoldings = fundBreakdown.filter(f => f.category === 'ELSS (Tax Saving)');
  const hdfcElssCount = elssHoldings.filter(f => f.name.toLowerCase().includes('hdfc')).length;
  const hasElssDuplication = hdfcElssCount > 1;

  // Flexi cap overlap: two flexi cap funds likely have overlapping top holdings
  const flexiCapFunds = fundBreakdown.filter(f => f.category === 'Flexi Cap');
  const hasFlexiCapOverlap = flexiCapFunds.length > 1;

  // Domestic vs international split
  const intlValue = categoryMap['International / FoF']?.value || 0;
  const domesticValue = totalCurrentValue - intlValue;
  const intlWeight = parseFloat(((intlValue / totalCurrentValue) * 100).toFixed(2));

  // Weighted portfolio returns and benchmark comparison
  const portfolioWeightedReturns = computeWeightedReturns(fundBreakdown);
  const benchmarkComparison = computeBenchmarkComparison(portfolioWeightedReturns, benchmarks);

  // Recent drawdown context (1M avg return across all funds)
  const fundsWithReturns = fundBreakdown.filter(f => f.returns['1M']);
  const avg1MReturn = fundsWithReturns.length > 0
    ? (fundsWithReturns.reduce((sum, f) => sum + parseFloat(f.returns['1M']), 0) / fundsWithReturns.length).toFixed(2)
    : null;

  // Risk flags
  const flags = [];

  if (topFundWeight > 35) flags.push(`High single-fund concentration: ${fundBreakdown[0].name} is ${topFundWeight}% of portfolio`);
  if (top2Weight > 60) flags.push(`Top 2 funds account for ${top2Weight}% of portfolio`);
  if (hasElssDuplication) flags.push('HDFC ELSS Tax Saver held in both demat and folio — overlapping exposure to the same fund');
  if (hasFlexiCapOverlap) flags.push('Two Flexi Cap funds (HDFC + Parag Parikh) likely have significant stock-level overlap in large caps');
  if (intlWeight < 5) flags.push('Very low international diversification — portfolio is almost entirely domestic equity');

  return {
    totalCurrentValue: parseFloat(totalCurrentValue.toFixed(2)),
    fundBreakdown,
    categoryBreakdown: categoryMap,
    portfolioWeightedReturns,
    benchmarkComparison,
    domesticVsInternational: {
      domestic: parseFloat(domesticValue.toFixed(2)),
      international: parseFloat(intlValue.toFixed(2)),
      internationalWeight: intlWeight,
    },
    avg1MReturn,
    riskFlags: flags,
  };
}

module.exports = { analyzeRisk };
