'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const fs = require('fs');
const { parseCDSL } = require('./parser');
const { enrichHoldings } = require('./funds');
const { analyzeRisk } = require('./risk');
const { generateNarrative } = require('./narrative');

function askPAN() {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question('Enter your PAN number (used as PDF password): ', answer => {
      rl.close();
      resolve(answer.trim().toUpperCase());
    });
  });
}

async function run() {
  // Find the first PDF in the input/ folder
  const inputDir = path.join(__dirname, '..', 'input');
  const pdfs = fs.readdirSync(inputDir).filter(f => f.toLowerCase().endsWith('.pdf'));
  if (pdfs.length === 0) {
    console.error('No PDF found in the input/ folder. Please drop your CDSL statement there first.');
    process.exit(1);
  }
  const pdfPath = path.join(inputDir, pdfs[0]);

  const password = await askPAN();

  console.log('=== Portfolio Tracker ===\n');

  // Step 1: Parse the CDSL statement
  console.log('Step 1: Parsing CDSL statement...');
  const parsed = await parseCDSL(pdfPath, password);
  const allHoldings = [...parsed.dematHoldings, ...parsed.folioHoldings];
  console.log(`  Found ${allHoldings.length} holdings (statement date: ${parsed.summary.asOn})\n`);

  // Step 2: Fetch current NAV and performance data
  console.log('Step 2: Fetching live NAV and historical returns...');
  const enriched = await enrichHoldings(allHoldings);
  console.log('  Done.\n');

  // Step 3: Risk analysis
  console.log('Step 3: Analysing portfolio risk...');
  const riskAnalysis = analyzeRisk(enriched);
  console.log(`  Total current value: ₹${riskAnalysis.totalCurrentValue.toLocaleString('en-IN')}`);
  console.log(`  Risk flags: ${riskAnalysis.riskFlags.length}\n`);

  // Step 4: Generate AI narrative
  console.log('Step 4: Generating AI narrative...');
  const narrative = await generateNarrative(parsed.summary, riskAnalysis);
  console.log('  Done.\n');

  // Step 5: Write output report
  const report = buildReport(parsed.summary, riskAnalysis, narrative);
  const outputPath = path.join(__dirname, '..', 'output', 'portfolio_report.txt');
  fs.writeFileSync(outputPath, report, 'utf8');

  console.log('='.repeat(60));
  console.log(report);
  console.log('='.repeat(60));
  console.log(`\nReport saved to: output/portfolio_report.txt`);
}

function buildReport(summary, riskAnalysis, narrative) {
  const lines = [];
  const divider = '─'.repeat(60);

  lines.push('PORTFOLIO REPORT');
  lines.push(`Statement date: ${summary.asOn}`);
  lines.push(`Report generated: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`);
  lines.push(divider);

  lines.push('\nHOLDINGS SUMMARY');
  riskAnalysis.fundBreakdown.forEach(f => {
    lines.push(`  ${f.weight.toString().padStart(5)}%  ${f.name.substring(0, 48).padEnd(48)}  ₹${f.value.toLocaleString('en-IN')}`);
  });

  lines.push(`\n${''.padEnd(56)}──────────────`);
  lines.push(`${'TOTAL CURRENT VALUE'.padEnd(58)}₹${riskAnalysis.totalCurrentValue.toLocaleString('en-IN')}`);

  lines.push('\n' + divider);
  lines.push('\nCATEGORY ALLOCATION');
  Object.entries(riskAnalysis.categoryBreakdown).forEach(([cat, v]) => {
    const bar = '█'.repeat(Math.round(v.weight / 2));
    lines.push(`  ${cat.padEnd(30)} ${v.weight.toString().padStart(5)}%  ${bar}`);
  });

  lines.push('\n' + divider);
  lines.push('\nPERFORMANCE (returns %)');
  lines.push('  Fund'.padEnd(42) + '  1M     3M     6M     1Y    3Y CAGR');
  riskAnalysis.fundBreakdown.forEach(f => {
    const r = f.returns;
    if (!r || !r['1M']) return;
    const row = [r['1M'], r['3M'], r['6M'], r['1Y'], r['3Y_CAGR']]
      .map(v => (v || 'N/A').toString().padStart(6))
      .join('  ');
    lines.push(`  ${f.name.substring(0, 38).padEnd(38)}  ${row}`);
  });

  lines.push(`\n  Avg 1-month return across portfolio: ${riskAnalysis.avg1MReturn}%`);

  lines.push('\n' + divider);
  lines.push('\nRISK FLAGS');
  riskAnalysis.riskFlags.forEach(flag => lines.push(`  ⚠  ${flag}`));

  lines.push('\n' + divider);
  lines.push('\nAI PORTFOLIO NARRATIVE\n');
  lines.push(narrative);

  return lines.join('\n');
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
