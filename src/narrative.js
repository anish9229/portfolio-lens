'use strict';

const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

async function generateNarrative(summary, riskAnalysis) {
  const { fundBreakdown, categoryBreakdown, domesticVsInternational, avg1MReturn, riskFlags, totalCurrentValue } = riskAnalysis;

  const fundsText = fundBreakdown.map(f => {
    const r = f.returns;
    const returnsStr = r
      ? `1M: ${r['1M']}%, 3M: ${r['3M']}%, 6M: ${r['6M']}%, 1Y: ${r['1Y']}%, 3Y CAGR: ${r['3Y_CAGR']}%`
      : 'Returns unavailable';
    return `- ${f.name} [${f.category}] — ${f.weight}% of portfolio (₹${f.value.toLocaleString('en-IN')}) | ${returnsStr}`;
  }).join('\n');

  const categoriesText = Object.entries(categoryBreakdown)
    .map(([cat, v]) => `- ${cat}: ${v.weight}% (₹${v.value.toLocaleString('en-IN')})`)
    .join('\n');

  const flagsText = riskFlags.length > 0
    ? riskFlags.map(f => `- ${f}`).join('\n')
    : '- No major risk flags identified';

  const prompt = `You are a senior Indian mutual fund advisor providing a portfolio review to a retail investor.
Analyse the following portfolio data and write a clear, honest, and insightful commentary.

PORTFOLIO SNAPSHOT (as of ${summary.asOn})
Statement value: ₹${summary.totalValue.toLocaleString('en-IN')}
Current value: ₹${totalCurrentValue.toLocaleString('en-IN')}
Average 1-month return across funds: ${avg1MReturn}%

HOLDINGS (sorted by size):
${fundsText}

CATEGORY ALLOCATION:
${categoriesText}

INTERNATIONAL vs DOMESTIC:
- Domestic: ₹${domesticVsInternational.domestic.toLocaleString('en-IN')} (${100 - domesticVsInternational.internationalWeight}%)
- International: ₹${domesticVsInternational.international.toLocaleString('en-IN')} (${domesticVsInternational.internationalWeight}%)

RISK FLAGS:
${flagsText}

Write a portfolio narrative in the following structure:
1. **Overall Portfolio Health** — A 2-3 sentence macro summary of the portfolio's current state and recent performance.
2. **What's Working** — Highlight strengths (e.g. funds with strong 3Y CAGR, good diversification aspects).
3. **What to Watch** — Address the risk flags and weaker performers honestly but constructively.
4. **Key Recommendations** — 3-4 specific, actionable suggestions (e.g. consolidation, adding international exposure, rebalancing).
5. **Bottom Line** — A single punchy closing sentence summarising the overall assessment.

Keep the tone conversational but professional. Speak directly to the investor as "your portfolio". Use Indian financial context (₹, Indian market conditions, ELSS tax implications). Avoid jargon. Be specific with numbers.`;

  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}

module.exports = { generateNarrative };
