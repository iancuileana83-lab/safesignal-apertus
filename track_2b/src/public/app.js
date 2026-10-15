import { FIELD_DEFS, ENUMS, SERIOUSNESS, emptyFields, assess, buildReport } from './js/rules.js';
import { LANGS, tr, tr2 } from './js/i18n.js';

const $ = (id) => document.getElementById(id);
const state = {
  lang: 'en', // UI language
  live: false, // a model endpoint answered
  backend: null,
  cases: [],
  fields: emptyFields(),
  narrative: '',
  followups: [],
  summary: '',
  language: '', // language of the report, as detected by the model
  provenance: null, // {type:'model'|'manual', meta}
  hasResult: false,
};

const T = (key, vars) => tr(state.lang, key, vars);

function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// ---- language ------------------------------------------------------------
function initialLang() {
  try {
    const saved = localStorage.getItem('safesignal.lang');
    if (LANGS.includes(saved)) return saved;
  } catch {}
  return (navigator.language || '').toLowerCase().startsWith('ro') ? 'ro' : 'en';
}

function applyStatic() {
  document.documentElement.lang = state.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = T(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-ph]')) el.setAttribute('placeholder', T(el.dataset.i18nPh));
}

function setLang(lang) {
  state.lang = LANGS.includes(lang) ? lang : 'en';
  try {
    localStorage.setItem('safesignal.lang', state.lang);
  } catch {}
  $('lang').value = state.lang;
  applyStatic();
  fillSamples();
  describeBackend();
  if (state.hasResult) renderAll();
}

// ---- backend honesty badge ----------------------------------------------
function describeBackend() {
  const el = $('backend');
  el.className = 'backend';
  const b = state.backend;
  if (state.live && b) {
    if (b.kind === 'gateway') {
      el.classList.add('amd'); // style hook: "genuine model"
      el.textContent = T('badge.gateway', { model: b.model });
    } else if (b.kind === 'local') {
      el.classList.add('amd');
      el.textContent = T('badge.local', { model: b.model });
    } else if (b.kind === 'standin') {
      el.classList.add('standin');
      el.textContent = T('badge.standin');
    } else {
      el.textContent = T('badge.other', { model: b.model, label: b.label || 'custom endpoint' });
    }
  } else {
    el.classList.add('replay'); // style hook: "no model"
    el.textContent = T('badge.offline');
  }
}

function setNotice(msg) {
  const n = $('notice');
  n.hidden = !msg;
  n.textContent = msg || '';
}

function fillSamples() {
  const sel = $('sample');
  const keep = sel.value;
  sel.replaceChildren(h('option', { value: '' }, T('sample.placeholder')));
  for (const c of state.cases) sel.append(h('option', { value: c.id }, (c.lang ? '[' + c.lang.toUpperCase() + '] ' : '') + c.title));
  sel.value = keep;
}

// ---- init ----------------------------------------------------------------
async function init() {
  state.lang = initialLang();
  $('lang').value = state.lang;
  $('lang').addEventListener('change', (e) => setLang(e.target.value));
  applyStatic();
  try {
    const s = await getJson('api/status');
    state.live = !!(s.reachable && s.configured);
    state.backend = s.backend;
  } catch {
    state.live = false;
  }
  try {
    state.cases = await getJson('cases.json');
  } catch {
    state.cases = [];
  }
  fillSamples();
  describeBackend();
  if (!state.live) setNotice(T('notice.offline'));
}

$('sample').addEventListener('change', (e) => {
  const c = state.cases.find((x) => x.id === e.target.value);
  if (c) $('narrative').value = c.narrative;
});

// ---- actions -------------------------------------------------------------
$('go').addEventListener('click', async () => {
  const narrative = $('narrative').value.trim();
  if (narrative.length < 10) return setNotice(T('notice.short'));
  state.narrative = narrative;
  setNotice('');
  if (!state.live) return setNotice(T('notice.offline'));
  $('busy').hidden = false;
  $('go').disabled = true;
  try {
    const r = await fetch('api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ narrative }),
    });
    if (!r.ok) throw new Error((await r.json()).error || r.status);
    const out = await r.json();
    load(out, { type: 'model', meta: out.meta });
  } catch (e) {
    state.live = false;
    describeBackend();
    setNotice(T('notice.fail', { err: e.message }));
  } finally {
    $('busy').hidden = true;
    $('go').disabled = false;
  }
});

$('manual').addEventListener('click', () => {
  state.narrative = $('narrative').value.trim();
  state.fields = emptyFields();
  state.followups = [];
  state.language = '';
  state.provenance = { type: 'manual' };
  state.hasResult = true;
  show(true);
  $('summary').textContent = '';
  renderAll();
  $('review').scrollIntoView({ behavior: 'smooth' });
});

function load(result, provenance) {
  state.fields = result.fields;
  for (const d of FIELD_DEFS) if (!state.fields[d.key]) state.fields[d.key] = d.list ? { value: [], quote: '' } : { value: '', quote: '' };
  state.followups = result.followups || [];
  state.summary = result.summary || '';
  state.language = result.language || '';
  state.provenance = provenance;
  state.hasResult = true;
  show(true);
  renderAll();
  $('review').scrollIntoView({ behavior: 'smooth' });
}

function show(on) {
  for (const id of ['review', 'checks', 'report']) $(id).hidden = !on;
  $('reviewed').checked = false;
}

// ---- rendering -----------------------------------------------------------
function fmtMeta(m) {
  if (!m) return '';
  const bits = [];
  if (m.latencyMs != null) bits.push(`${m.latencyMs} ms`);
  if (m.tokensPerSec) bits.push(`${m.tokensPerSec} tokens/s`);
  return bits.join(' · ');
}

function renderProvenance() {
  const p = state.provenance;
  const el = $('prov');
  el.className = 'prov';
  if (!p || p.type === 'manual') {
    el.textContent = T('prov.manual');
  } else {
    const m = p.meta || {};
    if (m.kind === 'standin') {
      el.classList.add('standin');
      el.textContent = T('prov.standin');
    } else {
      if (m.kind === 'gateway' || m.kind === 'local') el.classList.add('amd');
      let text = T('prov.model', { model: m.model || '?', backend: m.backend || 'endpoint', meta: fmtMeta(m) ? fmtMeta(m) + '.' : '' });
      if (state.language) text += ' ' + T('lang.detected', { code: state.language });
      el.textContent = text.trim();
    }
  }
  $('summary').textContent = state.summary && p && p.type !== 'manual' ? T('summary.prefix') + state.summary : '';
}

function renderForm() {
  const root = $('form');
  root.replaceChildren();
  let group = null;
  let grid = null;
  for (const d of FIELD_DEFS) {
    const [label, hint] = tr2(state.lang, 'f.' + d.key);
    if (d.group !== group) {
      group = d.group;
      root.append(h('div', { class: 'group' }, T('group.' + group)));
      grid = h('div', { class: 'fields' });
      root.append(grid);
    }
    const f = state.fields[d.key];
    const id = 'f_' + d.key;
    const wrap = h('div', { class: 'field' });
    const meta = h('div', { class: 'meta' });
    const update = () => {
      const empty = d.list ? !f.value.length : !String(f.value || '').trim();
      wrap.classList.toggle('empty', empty);
      if (f.edited) {
        meta.className = 'meta';
        meta.textContent = T('field.edited');
      } else if (!empty && f.quote && f.grounded === false) {
        meta.className = 'meta warn';
        meta.textContent = T('field.notfound');
      } else if (!empty && f.quote) {
        meta.className = 'meta';
        meta.textContent = '✓ “' + f.quote + '”';
      } else {
        meta.className = 'meta';
        meta.textContent = '';
      }
    };
    const changed = (v) => {
      f.value = v;
      f.edited = true;
      update();
      renderChecks();
    };
    if (d.list) {
      const chips = h('div', { class: 'chips', role: 'group', 'aria-labelledby': id + '_l' });
      for (const s of SERIOUSNESS) {
        const cb = h('input', { type: 'checkbox', checked: f.value.includes(s) });
        cb.addEventListener('change', () => {
          const next = new Set(f.value);
          cb.checked ? next.add(s) : next.delete(s);
          changed([...next]);
        });
        chips.append(h('label', {}, cb, T('ser.' + s)));
      }
      wrap.append(h('label', { id: id + '_l' }, label), chips, meta);
    } else if (d.enum) {
      const sel = h('select', { id });
      sel.append(h('option', { value: '' }, T('field.notstated')));
      for (const o of ENUMS[d.enum]) sel.append(h('option', { value: o }, T('v.' + o)));
      sel.value = f.value || '';
      sel.addEventListener('change', () => changed(sel.value));
      wrap.append(h('label', { for: id }, label), sel, meta);
    } else {
      const inp = h('input', { type: 'text', id, value: f.value || '', placeholder: hint || '', maxlength: 300 });
      inp.addEventListener('input', () => changed(inp.value));
      wrap.append(h('label', { for: id }, label), inp, meta);
    }
    update();
    grid.append(wrap);
  }
}

function renderChecks() {
  const a = assess(state.fields, state.narrative, state.lang);
  const c = a.completeness;
  $('pct').textContent = T('pct', { present: c.present, total: c.total, percent: c.percent });
  $('barfill').style.width = c.percent + '%';
  $('minimum').textContent = c.minimumMet ? T('minimum.ok') : T('minimum.no');
  const ul = $('missing');
  ul.replaceChildren();
  if (!c.missing.length) ul.append(h('li', {}, T('missing.none')));
  for (const m of c.missing) ul.append(h('li', {}, h('strong', {}, m.label + ': '), m.question));
  const mq = $('modelq');
  mq.replaceChildren();
  const have = new Set(c.missing.map((m) => m.question.toLowerCase()));
  const extra = (state.followups || []).filter((q) => q && !have.has(q.toLowerCase()));
  if (extra.length && state.provenance && state.provenance.type !== 'manual') {
    mq.append(h('h3', {}, T('modelq.h')), h('ul', { class: 'plain' }, extra.map((q) => h('li', {}, q))));
  }
  const t = a.triage;
  const tg = $('triage');
  tg.className = 'triage ' + t.level;
  tg.replaceChildren(h('span', { class: 'lbl' }, t.label), t.message);
  const rs = $('reasons');
  rs.replaceChildren(...t.reasons.map((r) => h('li', {}, h('span', { class: 'rid' }, r.id), r.text)));
  renderDraft();
}

function renderDraft() {
  const meta = state.provenance && state.provenance.meta ? state.provenance.meta : {};
  const p = state.provenance || { type: 'manual' };
  const rep = buildReport(
    state.fields,
    state.narrative,
    {
      extraction: p.type === 'model' ? 'live model' : 'manual entry',
      model: meta.model || null,
      backend: meta.backend || null,
      language: state.language || null,
    },
    $('reviewed').checked,
  );
  state.report = rep;
  const v = (x) => (x ? T('v.' + x) : '');
  const row = (k, val) => [h('dt', {}, k), h('dd', {}, val || '—')];
  const d = $('draft');
  d.replaceChildren(
    h('p', { class: 'stamp' }, rep.status === 'DRAFT_NEEDS_HUMAN_REVIEW' ? T('draft.draft') : T('draft.reviewed')),
    h(
      'dl',
      {},
      row(T('draft.patient'), [rep.patient.age, v(rep.patient.sex), rep.patient.pregnant === 'yes' ? T('draft.pregnant') : '', rep.patient.reference].filter(Boolean).join(', ')),
      row(T('draft.medicine'), [rep.suspectMedicine.name, rep.suspectMedicine.dose].filter(Boolean).join(' · ')),
      row(T('draft.indication'), rep.suspectMedicine.indication),
      row(
        T('draft.dates'),
        [rep.suspectMedicine.startedOn && T('draft.started') + ' ' + rep.suspectMedicine.startedOn, rep.suspectMedicine.stoppedOn && T('draft.stopped') + ' ' + rep.suspectMedicine.stoppedOn]
          .filter(Boolean)
          .join(', '),
      ),
      row(T('draft.other'), rep.suspectMedicine.otherMedicines),
      row(T('draft.reaction'), rep.reaction.description),
      row(T('draft.onset'), rep.reaction.onset),
      row(T('draft.action'), v(rep.reaction.actionTaken)),
      row(T('draft.outcome'), v(rep.outcome)),
      row(T('draft.seriousness'), rep.seriousness.map((s) => T('ser.' + s)).join(', ')),
      row(T('draft.reporter'), v(rep.reporter.role)),
      row(T('draft.urgency'), T('tri.' + rep.triage.level) + ' (' + rep.triage.reasons.map((r) => r.id).join(', ') + ')'),
      row(
        T('draft.completeness'),
        rep.completeness.percent + '%' + (rep.completeness.missing.length ? ', ' + T('draft.missing') + ': ' + assess(state.fields, state.narrative, state.lang).completeness.missing.map((m) => m.label).join(', ') : ''),
      ),
    ),
    h('p', { class: 'muted' }, T('disclaimer')),
  );
  $('download').disabled = !$('reviewed').checked;
}

function renderAll() {
  renderProvenance();
  renderForm();
  renderChecks();
}

$('reviewed').addEventListener('change', renderDraft);
$('print').addEventListener('click', () => window.print());
$('download').addEventListener('click', () => {
  if (!$('reviewed').checked) return;
  const blob = new Blob([JSON.stringify(state.report, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'safesignal-draft-report.json' });
  document.body.append(a);
  a.click();
  a.remove();
});

init();
