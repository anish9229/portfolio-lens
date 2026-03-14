'use strict';

const fs = require('fs');

async function parseCDSL(input, password) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  const data = Buffer.isBuffer(input) ? new Uint8Array(input) : new Uint8Array(fs.readFileSync(input));
  const doc = await getDocument({ data, password }).promise;

  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map(item => item.str).join(' ') + '\n';
  }

  return {
    dematHoldings: parseDematHoldings(fullText),
    folioHoldings: parseFolioHoldings(fullText),
    summary: parseSummary(fullText),
  };
}

function parseSummary(text) {
  const totalMatch = text.match(/Total Portfolio Value[^`₹]*[`₹]\s*([\d,]+\.?\d*)/);
  const dateMatch = text.match(/as on (\d{2}-\d{2}-\d{4})/);
  return {
    totalValue: totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : null,
    asOn: dateMatch ? dateMatch[1] : null,
  };
}

function parseDematHoldings(text) {
  const holdings = [];

  const holdingSection = text.match(/HOLDING STATEMENT AS ON[\s\S]*?(?=MARGIN RE-PLEDGE|MUTUAL FUND UNITS HELD WITH MF|$)/);
  if (!holdingSection) return holdings;

  const sectionText = holdingSection[0];

  // Split by ISIN boundaries to handle each holding block independently
  const blocks = sectionText.split(/(INF[A-Z0-9]{9})/);

  for (let i = 1; i < blocks.length - 1; i += 2) {
    const isin = blocks[i];
    let body = blocks[i + 1];

    // Truncate at page headers / Hindi text / repeated column headers to avoid stray numbers
    body = body.split(/ISIN\s+[^\u0000-\u007F]/)[0];  // stop at "ISIN <hindi>"
    body = body.split(/Portfolio Value/)[0];             // stop at portfolio total line

    // Extract fund name: text before the first number
    const nameMatch = body.match(/^([\w\s#\-\.]+?)\s+([\d,]+\.?\d*)/);
    if (!nameMatch) continue;

    const rawName = nameMatch[1].trim();
    const name = rawName.includes('#') ? rawName.split('#')[1].trim() : rawName;
    const totalUnits = parseFloat(nameMatch[2].replace(/,/g, ''));

    // Extract all numbers from the (now-trimmed) block
    const numbers = [...body.matchAll(/([\d,]+\.?\d+)/g)].map(m => parseFloat(m[1].replace(/,/g, '')));
    if (numbers.length < 2) continue;

    // Last number is value, second to last is market price
    const value = numbers[numbers.length - 1];
    const marketPrice = numbers[numbers.length - 2];

    holdings.push({
      isin,
      name,
      totalUnits,
      marketPrice,
      value,
      type: 'demat',
    });
  }

  return holdings;
}

function parseFolioHoldings(text) {
  const holdings = [];

  const folioSection = text.match(/MUTUAL FUND UNITS HELD AS ON[\s\S]*?(?=Load Structures|$)/);
  if (!folioSection) return holdings;

  const sectionText = folioSection[0];

  // Each folio row starts with a scheme code like "32T - " or "TSD1 - " or "N1GD - "
  // Followed by scheme name, ISIN (may have a space mid-ISIN due to PDF rendering), folio, units, nav, invested, value, PL, PL%
  const rowRegex = /(\w+)\s+-\s+([\w\s\-\(\)]+?)\s+(INF[A-Z0-9]{8,10}(?:\s[A-Z0-9]+)?)\s+([\w\/]+)\s+([\d\.]+)\s+([\d,\.]+)\s+([\d,\.]+)\s+([\d,\.]+)\s+(-?[\d,\.]+)\s+(-?[\d,\.]+)/g;

  let match;
  while ((match = rowRegex.exec(sectionText)) !== null) {
    const units = parseFloat(match[5].replace(/,/g, ''));
    if (units === 0) continue;

    // Normalize ISIN — remove any space (PDF sometimes splits it)
    const isin = match[3].replace(/\s/g, '');

    holdings.push({
      isin,
      name: match[2].trim(),
      folioNo: match[4],
      units,
      nav: parseFloat(match[6].replace(/,/g, '')),
      investedAmount: parseFloat(match[7].replace(/,/g, '')),
      value: parseFloat(match[8].replace(/,/g, '')),
      unrealisedPL: parseFloat(match[9].replace(/,/g, '')),
      unrealisedPLPct: parseFloat(match[10].replace(/,/g, '')),
      type: 'folio',
    });
  }

  return holdings;
}

module.exports = { parseCDSL };
