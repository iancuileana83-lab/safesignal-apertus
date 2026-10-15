// DEVELOPMENT STAND-IN. Not an LLM, not Apertus. A tiny English regex "model" that speaks the
// OpenAI chat API so the app can be developed and tested without a key or a network.
// It does not understand Romanian or other languages. Real results come only from
// Apertus (hosted gateway or a local server).
//
//   node src/tools/standin.mjs        -> http://localhost:8001/v1
import http from 'node:http';
import { MARK_START, MARK_END } from '../llm.mjs';

const PORT = Number(process.env.STANDIN_PORT || 8001);

const MEDS = ['paracetamol', 'ibuprofen', 'amoxicillin', 'warfarin', 'diclofenac', 'loratadine', 'aspirin', 'cetirizine', 'omeprazole', 'metformin', 'atorvastatin', 'amlodipine', 'penicillin', 'codeine'];
const SYMPTOMS = /(rash|itch\w*|hives|swell\w*|nausea|vomit\w*|dizz\w*|headache|stomach pain|diarrh\w+|difficulty breathing|could not breathe|black stools|drowsy|palpitations)[^.]*/i;

function pick(re, text, group = 0) {
  const m = re.exec(text);
  return m ? { value: m[group].trim(), quote: m[0].trim() } : { value: '', quote: '' };
}

function run(text) {
  const out = {};
  const age = /(\d{1,3})[- ]?(year|yr)s?[- ]old|aged? (\d{1,3})|\b(\d{1,3}) ?(?:year|yr)s?\b|(\d{1,2}) ?months? old|\bMr\.? \w+\.?,? (\d{2})\b/i.exec(text);
  out.patient_age = age
    ? { value: /month/i.test(age[0]) ? `${age[5]} months` : `${age[1] || age[3] || age[4] || age[6]} years`, quote: age[0] }
    : { value: '', quote: '' };
  const f = /\b(woman|female|girl|daughter|mum|mother|she|her)\b/i.exec(text);
  const m = /\b(man|male|boy|son|he|his|him|Mr\.?)\b/i.exec(text);
  out.patient_sex = f && (!m || f.index < m.index) ? { value: 'female', quote: f[0] } : m ? { value: 'male', quote: m[0] } : { value: '', quote: '' };
  out.pregnancy = /pregnant/i.test(text) ? { value: 'yes', quote: /[^.]*pregnant/i.exec(text)[0].match(/\d+ weeks pregnant|pregnant/i)[0] } : { value: '', quote: '' };
  out.patient_ref = pick(/\bMr\.? [A-Z]\./, text);
  const med = MEDS.find((d) => new RegExp(d, 'i').test(text));
  out.medicine_name = med ? { value: med, quote: new RegExp(med, 'i').exec(text)[0] } : { value: '', quote: '' };
  out.medicine_dose = pick(/\d+(\.\d+)?\s?(mg|g|mcg|ml)[^.,]*?(daily|a day|once|twice|three times a day|\bper day)?(?=[.,]| for| on|$)/i, text);
  out.medicine_indication = pick(/\bfor ((?:a |an |the )?[a-z ]{3,25})(?=[.,]|$| and)/i, text, 1);
  out.medicine_start = pick(/started[^.]*?(\d{1,2} \w+|\bon \w+day)|began taking|first (dose|\w+ capsule)/i, text);
  out.medicine_stop = pick(/stopped[^.]*?(\d{1,2} \w+)/i, text);
  out.other_medicines = { value: '', quote: '' };
  const sym = SYMPTOMS.exec(text);
  out.reaction_description = sym ? { value: sym[0].trim(), quote: sym[0].trim() } : { value: '', quote: '' };
  out.reaction_onset = pick(/(about \d+ minutes later|on \d{1,2} \w+ he got|after (starting|her first)[^.]*)/i, text);
  out.action_taken = /stopped|did not give/i.test(text)
    ? { value: 'stopped', quote: /stopped|did not give/i.exec(text)[0] }
    : /still taking/i.test(text)
      ? { value: 'continued', quote: 'still taking' }
      : { value: '', quote: '' };
  out.outcome = /still in hospital|still has|not recovered/i.test(text)
    ? { value: 'not recovered', quote: /still in hospital|still has|not recovered/i.exec(text)[0] }
    : /gone|better|recovered/i.test(text)
      ? { value: /seems better/i.test(text) ? 'recovering' : 'recovered', quote: /seems better|gone|better|recovered/i.exec(text)[0] }
      : { value: '', quote: '' };
  out.seriousness = [];
  const h = /admitted to hospital|ambulance|emergency department/i.exec(text);
  if (h) out.seriousness.push({ value: 'hospitalisation', quote: h[0] });
  out.reporter_role = /technician|pharmacy/i.test(text) && /I am reporting/i.test(text)
    ? { value: 'pharmacy staff', quote: 'pharmacy technician' }
    : /told me|customer|mother/i.test(text)
      ? { value: 'pharmacy staff', quote: '' }
      : { value: '', quote: '' };
  out.followup_questions = ['Which exact medicine and dose?', 'When did it start?'];
  out.summary = 'Stand-in regex extraction (not a language model).';
  return out;
}

const server = http.createServer((req, res) => {
  const send = (o) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(o));
  };
  if (req.url.endsWith('/models')) return send({ data: [{ id: 'standin-regex' }] });
  if (req.url.endsWith('/chat/completions')) {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const prompt = JSON.parse(b).messages.map((m) => m.content).join('\n');
      const i = prompt.lastIndexOf(MARK_START);
      const j = prompt.lastIndexOf(MARK_END);
      const text = prompt.slice(i + MARK_START.length, j).trim();
      const content = JSON.stringify(run(text));
      send({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: prompt.length >> 2, completion_tokens: content.length >> 2 } });
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
server.listen(PORT, () => console.log(`STAND-IN (not AMD, not an LLM) on http://localhost:${PORT}/v1`));
