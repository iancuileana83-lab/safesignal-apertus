// Renders technical_report.md to SafeSignal_Report.pdf with a headless Edge or Chrome.
// No npm dependencies: a small Markdown converter for the subset the report uses
// (headings, paragraphs, bullet lists with continuation lines, tables, code fences,
// inline code, bold, links). Usage: node src/tools/report-pdf.mjs
//
// Set BROWSER to the path of msedge/chrome if it is not found automatically.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'technical_report.md');
const OUT = path.join(ROOT, 'SafeSignal_Report.pdf');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

function convert(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre>${esc(buf.join('\n'))}</pre>`);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>',
      );
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) {
        let t = lines[i].slice(2);
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*- /.test(lines[i])) t += ' ' + lines[i++].trim();
        items.push(t);
      }
      out.push('<ul>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ul>');
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|```|- |\|)/.test(lines[i])) buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}

const css = `
@page { size: A4; margin: 16mm 15mm; }
body { font: 9.6pt/1.38 "Segoe UI", Arial, sans-serif; color: #14212b; }
h1 { font-size: 17pt; margin: 0 0 6pt; color: #0f3b52; }
h2 { font-size: 12pt; margin: 12pt 0 4pt; color: #0f3b52; border-bottom: 1px solid #cfdde2; padding-bottom: 2pt; }
h3 { font-size: 10.4pt; margin: 8pt 0 3pt; }
p { margin: 0 0 5pt; } ul { margin: 0 0 5pt; padding-left: 16pt; } li { margin-bottom: 2pt; }
code { font: 8.6pt Consolas, monospace; background: #eef4f6; padding: 0 2pt; border-radius: 2pt; }
pre { font: 8.2pt/1.3 Consolas, monospace; background: #f3f7f8; border: 1px solid #dbe6ea; padding: 6pt; white-space: pre-wrap; margin: 0 0 6pt; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 7pt; font-size: 8.4pt; }
th, td { border: 1px solid #cfdde2; padding: 3pt 5pt; text-align: left; vertical-align: top; }
th { background: #eef4f6; }
a { color: #0b5d8a; text-decoration: none; }
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SafeSignal technical report</title><style>${css}</style></head><body>\n${convert(fs.readFileSync(SRC, 'utf8'))}\n</body></html>`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'safesignal-report-'));
const htmlPath = path.join(tmp, 'report.html');
fs.writeFileSync(htmlPath, html);

const candidates = [
  process.env.BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const browser = candidates.find((p) => fs.existsSync(p));
if (!browser) {
  console.error('No Edge/Chrome/Chromium found. Set BROWSER=path. The HTML is at ' + htmlPath);
  process.exit(1);
}
const r = spawnSync(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${OUT}`, pathToFileURL(htmlPath).href], { encoding: 'utf8' });
if (!fs.existsSync(OUT)) {
  console.error('PDF was not created.\n' + (r.stderr || ''));
  process.exit(1);
}
const pdf = fs.readFileSync(OUT, 'latin1');
const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log(`${path.relative(process.cwd(), OUT)}: ${fs.statSync(OUT).size} bytes, ${pages} page(s)`);
if (process.env.KEEP_HTML) fs.copyFileSync(htmlPath, process.env.KEEP_HTML);
fs.rmSync(tmp, { recursive: true, force: true });
if (pages > 6) {
  console.error('WARNING: more than 6 pages; the track allows at most 6 (without references).');
  process.exitCode = 2;
}
