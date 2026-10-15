// Benchmark. Results are measured, never typed in; the output file states which
// backend produced them.
//
//   1. Rules baseline (no model, no network): urgency from the report text alone,
//      English-only rule pack versus all five language packs, per language.
//   2. Model quality and latency (needs a reachable endpoint): extraction accuracy
//      per language on the fictional sample set, then throughput at several
//      concurrency levels.
//
//   npm run bench                      (REPEATS=3 LEVELS=1,2,4)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, probe, extract } from '../llm.mjs';
import { assess, triage, emptyFields, val, fold } from '../public/js/rules.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const cfg = loadConfig();
const REPEATS = Number(process.env.REPEATS || 3);
const LEVELS = (process.env.LEVELS || '1,2,4').split(',').map(Number);
const PAUSE_MS = Number(process.env.PAUSE_MS || 0);
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'cases.json'), 'utf8'));
const langs = [...new Set(cases.map((c) => c.lang))];
const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);
const quant = (a, q) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] : null;
};

// ---- 1. rules baseline: urgency from the text alone, no model ----------------
// Only samples whose gold urgency comes from wording alone (emergency, routine) are scored;
// priority samples depend on extracted fields (age, pregnancy, outcome).
const textOnly = cases.filter((c) => c.gold.triage === 'emergency' || c.gold.triage === 'routine');
const baseline = {};
for (const l of langs) {
  const subset = textOnly.filter((c) => c.lang === l);
  const score = (packs) => subset.filter((c) => triage(emptyFields(), c.narrative, 'en', packs).level === c.gold.triage).length;
  baseline[l] = { samples: subset.length, englishOnlyCorrect: score(['en']), allPacksCorrect: score(undefined) };
}
console.log('Rules baseline (urgency from text alone, no model):');
for (const [l, b] of Object.entries(baseline)) {
  console.log(`  ${l}: English-only pack ${b.englishOnlyCorrect}/${b.samples}, all packs ${b.allPacksCorrect}/${b.samples}`);
}

const stamp0 = new Date().toISOString();
const dir = path.join(ROOT, 'bench', 'results');
fs.mkdirSync(dir, { recursive: true });

const baselineMd = [
  '## Rules baseline (no model, urgency from the report text alone)',
  '',
  'Scored on samples whose gold urgency comes from wording alone (emergency or routine). Fictional samples written by the author, so this shows the packs behave as designed, not clinical validity.',
  '',
  '| Language | Samples | English-only pack correct | All language packs correct |',
  '|---|---|---|---|',
  ...Object.entries(baseline).map(([l, b]) => `| ${l} | ${b.samples} | ${b.englishOnlyCorrect} | ${b.allPacksCorrect} |`),
  '',
].join('\n');

// ---- 2. model quality and throughput ----------------------------------------
const p = await probe(cfg);
if (!p.reachable) {
  console.error('\nEndpoint not reachable: ' + (cfg.baseUrl || '(LLM_BASE_URL unset)') + '. Only the rules baseline was measured.');
  const f = path.join(dir, `${stamp0.replace(/[:.]/g, '-')}-rules-only`);
  fs.writeFileSync(f + '.json', JSON.stringify({ measuredAt: stamp0, baseline }, null, 2));
  fs.writeFileSync(f + '.md', `# Benchmark ${stamp0} (rules only, no model reached)\n\n${baselineMd}`);
  process.exit(0);
}

const emptyQ = () => ({ runs: 0, jsonOk: 0, medicine: 0, sex: 0, outcome: 0, triage: 0, language: 0, grounded: 0, filled: 0 });
const quality = { all: emptyQ() };
for (const l of langs) quality[l] = emptyQ();
const latencies = [];

for (let r = 0; r < REPEATS; r++) {
  for (const c of cases) {
    const qs = [quality.all, quality[c.lang]];
    for (const q of qs) q.runs++;
    if (PAUSE_MS) await new Promise((x) => setTimeout(x, PAUSE_MS)); // stay under a free-tier rate limit
    try {
      const out = await extract(c.narrative, cfg);
      // only the first pass counts: the gateway answers an identical repeated request from a cache in ~200 ms
      if (r === 0) latencies.push(out.meta.latencyMs);
      const f = out.fields;
      const g = c.gold;
      const filled = Object.values(f).filter((x) => (Array.isArray(x.value) ? x.value.length : x.value && x.value !== 'unknown'));
      for (const q of qs) {
        q.jsonOk++;
        if (fold(val(f, 'medicine_name')).replace(/[^a-z0-9]/g, '') === fold(g.medicine_name).replace(/[^a-z0-9]/g, '')) q.medicine++;
        if (val(f, 'patient_sex') === g.patient_sex) q.sex++;
        if (val(f, 'outcome') === g.outcome) q.outcome++;
        if (assess(f, c.narrative).triage.level === g.triage) q.triage++;
        if (out.language === c.lang) q.language++;
        q.filled += filled.length;
        q.grounded += filled.filter((x) => x.grounded !== false).length;
      }
    } catch (e) {
      console.error(`  ${c.id}: ${e.message}`);
    }
  }
}

const load = [];
for (const level of LEVELS) {
  const jobs = [];
  for (let i = 0; i < Math.max(level * 2, 6); i++) jobs.push(cases[i % cases.length]);
  const lat = [];
  let tokens = 0;
  let failed = 0;
  const t0 = performance.now();
  let next = 0;
  await Promise.all(
    Array.from({ length: level }, async () => {
      while (next < jobs.length) {
        const c = jobs[next++];
        try {
          const o = await extract(c.narrative, cfg);
          lat.push(o.meta.latencyMs);
          tokens += o.meta.completionTokens || 0;
        } catch {
          failed++;
        }
      }
    }),
  );
  const sec = (performance.now() - t0) / 1000;
  load.push({
    concurrency: level,
    requests: jobs.length,
    failed,
    wallSeconds: Math.round(sec * 100) / 100,
    reportsPerSecond: Math.round((lat.length / sec) * 100) / 100,
    completionTokensPerSecond: Math.round(tokens / sec),
    latencyMsP50: quant(lat, 0.5),
    latencyMsP95: quant(lat, 0.95),
  });
  console.log(`concurrency ${level}: ${load.at(-1).reportsPerSecond} reports/s, p50 ${load.at(-1).latencyMsP50} ms`);
}

const summarise = (q) => ({
  ...q,
  pctJson: pct(q.jsonOk, q.runs),
  pctMedicine: pct(q.medicine, q.runs),
  pctSex: pct(q.sex, q.runs),
  pctOutcome: pct(q.outcome, q.runs),
  pctTriage: pct(q.triage, q.runs),
  pctLanguage: pct(q.language, q.runs),
  pctGrounded: pct(q.grounded, q.filled),
});

const res = {
  measuredAt: stamp0,
  backend: { kind: cfg.kind, label: cfg.label, model: p.model },
  note:
    cfg.kind === 'gateway' || cfg.kind === 'local'
      ? 'Measured against the configured endpoint.'
      : 'NOT Apertus: stand-in or other endpoint. Do not quote as Apertus results.',
  samples: cases.length,
  repeats: REPEATS,
  baseline,
  quality: Object.fromEntries(Object.entries(quality).map(([k, q]) => [k, summarise(q)])),
  latencyMsP50: quant(latencies, 0.5),
  latencyMsP95: quant(latencies, 0.95),
  load,
};

const stamp = stamp0.replace(/[:.]/g, '-');
fs.writeFileSync(path.join(dir, `${stamp}-${cfg.kind}.json`), JSON.stringify(res, null, 2));
const rows = Object.entries(res.quality).map(
  ([k, q]) => `| ${k} | ${q.runs} | ${q.pctJson}% | ${q.pctMedicine}% | ${q.pctSex}% | ${q.pctOutcome}% | ${q.pctTriage}% | ${q.pctLanguage}% | ${q.pctGrounded}% |`,
);
const md = [
  `# Benchmark ${res.measuredAt}`,
  '',
  `Backend: **${cfg.kind}** · ${p.model} · ${cfg.label || 'unlabelled'}`,
  res.note,
  '',
  `## Model quality (${cases.length} fictional samples x ${REPEATS} repeats)`,
  '',
  '| Language | Runs | JSON ok | Medicine | Sex | Outcome | Urgency | Language detected | Quotes found in text |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows,
  '',
  `Latency per report (first pass only): p50 ${res.latencyMsP50} ms, p95 ${res.latencyMsP95} ms.`,
  '',
  'Caveat: the Public AI gateway caches identical requests (observed: same completion id, ~200 ms). Latency is only',
  'valid for requests it has not seen before; the throughput table below reuses the same samples, so its latencies are',
  'cache hits, and concurrent requests on the free tier were answered with HTTP 429 (rate limit).',
  '',
  '## Throughput',
  '',
  '| Concurrency | Reports/s | Tokens/s | p50 ms | p95 ms | Failed |',
  '|---|---|---|---|---|---|',
  ...load.map((l) => `| ${l.concurrency} | ${l.reportsPerSecond} | ${l.completionTokensPerSecond} | ${l.latencyMsP50} | ${l.latencyMsP95} | ${l.failed} |`),
  '',
  baselineMd,
].join('\n');
fs.writeFileSync(path.join(dir, `${stamp}-${cfg.kind}.md`), md);
console.log('\n' + md);
