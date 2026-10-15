// SafeSignal server: static files, /api/status, /api/extract.
// Zero dependencies (Node 18+). Narratives are never logged or stored.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, probe, extract } from './llm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const CASES = path.join(HERE, '..', 'data', 'cases.json');
const PORT = Number(process.env.PORT || 3000);
const MAX_CHARS = 4000;
const cfg = loadConfig();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

// tiny in-memory rate limit: 20 extractions / minute / address
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 20;
}

let statusCache = { at: 0, value: null };
async function status() {
  if (statusCache.value && Date.now() - statusCache.at < 5000) return statusCache.value;
  const p = await probe(cfg);
  const value = {
    server: true,
    configured: !!cfg.baseUrl,
    reachable: p.reachable,
    backend: { kind: cfg.kind, label: cfg.label, model: p.model },
  };
  statusCache = { at: Date.now(), value };
  return value;
}

function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base) ? p : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/status') return json(res, 200, await status());

    if (url.pathname === '/api/extract' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || '?';
      if (limited(ip)) return json(res, 429, { error: 'Too many requests, wait a minute.' });
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: 'Bad request.' });
      }
      const narrative = String((body && body.narrative) || '').trim();
      if (narrative.length < 10) return json(res, 400, { error: 'Please write a little more.' });
      if (narrative.length > MAX_CHARS) return json(res, 400, { error: `Please keep it under ${MAX_CHARS} characters.` });
      try {
        const out = await extract(narrative, cfg);
        return json(res, 200, out);
      } catch (e) {
        statusCache.at = 0;
        return json(res, 503, { error: 'The model is not reachable right now.', detail: String(e.message || e) });
      }
    }

    // sample inputs without the gold answers
    if (url.pathname === '/cases.json') {
      try {
        const cases = JSON.parse(fs.readFileSync(CASES, 'utf8')).map(({ id, title, lang, narrative }) => ({ id, title, lang, narrative }));
        return json(res, 200, cases);
      } catch {
        return json(res, 200, []);
      }
    }

    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const f = safeJoin(PUBLIC, rel);
    if (!f) return json(res, 404, { error: 'no' });
    return serveFile(res, f);
  } catch (e) {
    return json(res, 500, { error: 'Server error.' });
  }
});

server.listen(PORT, () => {
  console.log(`SafeSignal on http://localhost:${PORT}`);
  console.log(
    cfg.baseUrl
      ? `Model endpoint: ${cfg.baseUrl} (kind: ${cfg.kind}${cfg.label ? ', ' + cfg.label : ''})`
      : 'No LLM_BASE_URL set: manual mode only (the checks still work).',
  );
});
