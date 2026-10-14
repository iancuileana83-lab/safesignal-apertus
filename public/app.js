import { FIELD_DEFS, ENUMS, SERIOUSNESS, SERIOUSNESS_LABEL, emptyFields, val, assess, buildReport } from './js/rules.js';

const $ = (id) => document.getElementById(id);
const state = {
  live: false, // a model endpoint answered
  backend: null,
  cases: [],
  replays: [], // [{id,title}] ids that have a recorded real run
  fields: emptyFields(),
  narrative: '',
  provenance: null, // {type:'model'|'replay'|'manual', ...}
};

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

// ---- backend honesty badge ----------------------------------------------
function describeBackend() {
  const el = $('backend');
  el.className = 'backend';
  const b = state.backend;
  if (state.live && b) {
    if (b.kind === 'amd') {
      el.classList.add('amd');
      el.textContent = `Live on AMD · ${b.model}${b.hardware ? ' · ' + b.hardware : ''}`;
    } else if (b.kind === 'standin') {
      el.classList.add('standin');
      el.textContent = 'Local stand-in (not AMD, not a real model)';
    } else {
      el.textContent = `Live · ${b.model} · ${b.label || 'custom endpoint'}`;
    }
  } else if (state.replays.length) {
    el.classList.add('replay');
    el.textContent = 'AMD GPU is off · showing replays of real AMD runs';
  } else {
    el.classList.add('replay');
    el.textContent = 'Model offline · manual form only';
  }
}

function setNotice(msg) {
  const n = $('notice');
  n.hidden = !msg;
  n.textContent = msg || '';
}

function goLabel() {
  if (state.live) return 'Check this report';
  return state.replays.length ? 'Show recorded run' : 'Analysis unavailable (no model, no recording)';
}

// ---- init ----------------------------------------------------------------
async function init() {
  try {
    const s = await getJson('api/status');
    state.live = !!(s.reachable && s.configured);
    state.backend = s.backend;
  } catch {
    state.live = false; // static hosting: no server
  }
  try {
    state.cases = await getJson('cases.json');
  } catch {
    state.cases = [];
  }
  try {
    state.replays = await getJson('replays/index.json');
  } catch {
    state.replays = [];
  }
  const sel = $('sample');
  for (const c of state.cases) {
    const rec = state.replays.some((r) => r.id === c.id);
    sel.append(h('option', { value: c.id }, c.title + (!state.live && rec ? '  (recorded AMD run)' : '')));
  }
  describeBackend();
  $('go').textContent = goLabel();
  if (!state.live) {
    setNotice(
      state.replays.length
        ? 'The AMD GPU is switched off to save credits. Pick a sample to see a replay of a real run on AMD, or fill the form by hand. Nothing here is invented.'
        : 'No model is connected and there is no recorded run yet. You can still fill the form by hand and use the checks.',
    );
  }
}

$('sample').addEventListener('change', (e) => {
  const c = state.cases.find((x) => x.id === e.target.value);
  if (c) $('narrative').value = c.narrative;
});

// ---- actions -------------------------------------------------------------
$('go').addEventListener('click', async () => {
  const narrative = $('narrative').value.trim();
  if (narrative.length < 10) return setNotice('Please write a little more first.');
  state.narrative = narrative;
  setNotice('');
  if (state.live) {
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
      $('go').textContent = goLabel();
      setNotice(
        'The model could not be reached (' + e.message + '). ' +
          (state.replays.length ? 'You can use a recorded sample or fill the form by hand.' : 'There is no recorded run yet, so fill the form by hand.'),
      );
    } finally {
      $('busy').hidden = true;
      $('go').disabled = false;
    }
    return;
  }
  // replay mode: only exact sample narratives have a real recording
  const c = state.cases.find((x) => x.narrative.trim() === narrative);
  const rec = c && state.replays.find((r) => r.id === c.id);
  if (!rec) {
    setNotice(
      state.replays.length
        ? 'The AMD GPU is off, so a new text cannot be analysed live. Choose one of the samples that has a recorded AMD run, or fill the form by hand.'
        : 'No model is connected and there is no recorded run yet, so this text cannot be analysed. Fill the form by hand and use the checks.',
    );
    return;
  }
  try {
    const r = await getJson(`replays/${rec.id}.json`);
    load(r.result, { type: 'replay', meta: r.meta });
  } catch {
    setNotice('Could not load that recording.');
  }
});

$('manual').addEventListener('click', () => {
  state.narrative = $('narrative').value.trim();
  state.fields = emptyFields();
  state.provenance = { type: 'manual' };
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
  state.provenance = provenance;
  $('summary').textContent = state.summary ? 'Model summary: ' + state.summary : '';
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
    el.textContent = 'Entered by hand. No model was used for these details.';
  } else if (p.type === 'replay') {
    el.classList.add('replay');
    const m = p.meta || {};
    el.textContent = `REPLAY of a real run recorded ${m.recordedAt ? m.recordedAt.slice(0, 10) : ''} on ${m.hardware || 'AMD Instinct'} with ${m.model}. ${fmtMeta(m)}. Not generated live.`;
  } else {
    const m = p.meta || {};
    if (m.kind === 'standin') {
      el.classList.add('standin');
      el.textContent = 'Extracted by the LOCAL STAND-IN (a regex script, not AMD and not a real model).';
    } else {
      if (m.kind === 'amd') el.classList.add('amd');
      el.textContent = `Extracted just now by ${m.model} on ${m.hardware || m.backend || 'the configured endpoint'}. ${fmtMeta(m)}.`;
    }
  }
}

function renderForm() {
  const root = $('form');
  root.replaceChildren();
  let group = null;
  let grid = null;
  for (const d of FIELD_DEFS) {
    if (d.group !== group) {
      group = d.group;
      root.append(h('div', { class: 'group' }, group));
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
        meta.textContent = '✎ edited by you';
      } else if (!empty && f.quote && f.grounded === false) {
        meta.className = 'meta warn';
        meta.textContent = '⚠ not found in your text, please check';
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
        chips.append(h('label', {}, cb, SERIOUSNESS_LABEL[s]));
      }
      wrap.append(h('label', { id: id + '_l' }, d.label), chips, meta);
    } else if (d.enum) {
      const sel = h('select', { id });
      sel.append(h('option', { value: '' }, '— not stated —'));
      for (const o of ENUMS[d.enum]) sel.append(h('option', { value: o }, o));
      sel.value = f.value || '';
      sel.addEventListener('change', () => changed(sel.value));
      wrap.append(h('label', { for: id }, d.label), sel, meta);
    } else {
      const inp = h('input', { type: 'text', id, value: f.value || '', placeholder: d.hint || '', maxlength: 300 });
      inp.addEventListener('input', () => changed(inp.value));
      wrap.append(h('label', { for: id }, d.label), inp, meta);
    }
    update();
    grid.append(wrap);
  }
}

function renderChecks() {
  const a = assess(state.fields, state.narrative);
  const c = a.completeness;
  $('pct').textContent = `${c.present} of ${c.total} key items (${c.percent}%)`;
  $('barfill').style.width = c.percent + '%';
  $('minimum').textContent = c.minimumMet
    ? 'The minimum for a valid report is there: patient, reporter, suspect medicine and reaction.'
    : 'Not yet a valid report: patient, reporter, suspect medicine and reaction are all needed.';
  const ul = $('missing');
  ul.replaceChildren();
  if (!c.missing.length) ul.append(h('li', {}, 'Nothing key is missing. Please still read it through.'));
  for (const m of c.missing) ul.append(h('li', {}, h('strong', {}, m.label + ': '), m.question));
  const mq = $('modelq');
  mq.replaceChildren();
  const have = new Set(c.missing.map((m) => m.question.toLowerCase()));
  const extra = (state.followups || []).filter((q) => q && !have.has(q.toLowerCase()));
  if (extra.length && state.provenance && state.provenance.type !== 'manual') {
    mq.append(h('h3', {}, 'Also suggested by the model'), h('ul', { class: 'plain' }, extra.map((q) => h('li', {}, q))));
  }
  const t = a.triage;
  const tr = $('triage');
  tr.className = 'triage ' + t.level;
  tr.replaceChildren(h('span', { class: 'lbl' }, t.label), t.message);
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
      extraction: p.type === 'model' ? 'live model' : p.type === 'replay' ? 'replay of a recorded run' : 'manual entry',
      model: meta.model || null,
      backend: meta.hardware || meta.backend || null,
    },
    $('reviewed').checked,
  );
  state.report = rep;
  const row = (k, v) => [h('dt', {}, k), h('dd', {}, v || '—')];
  const d = $('draft');
  d.replaceChildren(
    h('p', { class: 'stamp' }, rep.status === 'DRAFT_NEEDS_HUMAN_REVIEW' ? 'DRAFT · not sent · needs human review' : 'REVIEWED BY A PERSON · not sent'),
    h(
      'dl',
      {},
      row('Patient', [rep.patient.age, rep.patient.sex, rep.patient.pregnant === 'yes' ? 'pregnant' : '', rep.patient.reference].filter(Boolean).join(', ')),
      row('Suspect medicine', [rep.suspectMedicine.name, rep.suspectMedicine.dose].filter(Boolean).join(' · ')),
      row('Taken for', rep.suspectMedicine.indication),
      row('Medicine dates', [rep.suspectMedicine.startedOn && 'started ' + rep.suspectMedicine.startedOn, rep.suspectMedicine.stoppedOn && 'stopped ' + rep.suspectMedicine.stoppedOn].filter(Boolean).join(', ')),
      row('Other medicines', rep.suspectMedicine.otherMedicines),
      row('Reaction', rep.reaction.description),
      row('Reaction began', rep.reaction.onset),
      row('Action taken', rep.reaction.actionTaken),
      row('Outcome', rep.outcome),
      row('Seriousness', rep.seriousness.map((s) => SERIOUSNESS_LABEL[s]).join(', ')),
      row('Reporter', rep.reporter.role),
      row('Urgency', rep.triage.level + ' (' + rep.triage.reasons.map((r) => r.id).join(', ') + ')'),
      row('Completeness', rep.completeness.percent + '%' + (rep.completeness.missing.length ? ', missing: ' + rep.completeness.missing.join(', ') : '')),
    ),
    h('p', { class: 'muted' }, rep.disclaimer),
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
