'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const { parseCDSL } = require('./parser');
const { enrichHoldings } = require('./funds');
const { fetchBenchmarks } = require('./benchmarks');
const { analyzeRisk } = require('./risk');
const { generateNarrative } = require('./narrative');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// In-memory job store: jobId -> { events: [], done: bool, error: string|null }
const jobs = new Map();

app.use(express.static(path.join(__dirname, '..', 'public')));

// POST /api/analyze — accepts PDF + PAN, kicks off background processing
app.post('/api/analyze', upload.single('statement'), (req, res) => {
  const pan = (req.body.pan || '').trim().toUpperCase();

  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded.' });
  if (!pan || pan.length !== 10) return res.status(400).json({ error: 'Invalid PAN number.' });

  const jobId = crypto.randomUUID();
  jobs.set(jobId, { events: [], done: false, error: null });

  // Start processing in background
  processPortfolio(req.file.buffer, pan, jobId);

  res.json({ jobId });
});

// GET /api/progress/:jobId — SSE stream for live progress + final result
app.get('/api/progress/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send any already-queued events
  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  if (job.done) return res.end();

  // Attach live listener
  job.listener = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (event.type === 'done' || event.type === 'error') res.end();
  };

  req.on('close', () => { job.listener = null; });
});

function emit(jobId, event) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.events.push(event);
  if (job.listener) job.listener(event);
  if (event.type === 'done' || event.type === 'error') {
    job.done = true;
    // Clean up job after 5 minutes
    setTimeout(() => jobs.delete(jobId), 5 * 60 * 1000);
  }
}

async function processPortfolio(pdfBuffer, pan, jobId) {
  try {
    emit(jobId, { type: 'progress', step: 1, message: 'Parsing your CDSL statement...' });
    const parsed = await parseCDSL(pdfBuffer, pan);
    const allHoldings = [...parsed.dematHoldings, ...parsed.folioHoldings];

    if (allHoldings.length === 0) {
      return emit(jobId, { type: 'error', message: 'No holdings found. Check your PAN number or statement format.' });
    }

    emit(jobId, { type: 'progress', step: 2, message: `Found ${allHoldings.length} funds. Fetching live NAV data and benchmarks...` });
    const [enriched, benchmarks] = await Promise.all([
      enrichHoldings(allHoldings),
      fetchBenchmarks(),
    ]);

    emit(jobId, { type: 'progress', step: 3, message: 'Analysing portfolio risk and performance...' });
    const riskAnalysis = analyzeRisk(enriched, benchmarks);

    emit(jobId, { type: 'progress', step: 4, message: 'Generating AI commentary...' });
    const narrative = await generateNarrative(parsed.summary, riskAnalysis);

    emit(jobId, { type: 'done', result: { summary: parsed.summary, riskAnalysis, narrative } });
  } catch (err) {
    const message = err.message && err.message.includes('password')
      ? 'Incorrect PAN number — could not open the PDF.'
      : `Something went wrong: ${err.message}`;
    emit(jobId, { type: 'error', message });
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Portfolio Tracker running at http://localhost:${PORT}`));
