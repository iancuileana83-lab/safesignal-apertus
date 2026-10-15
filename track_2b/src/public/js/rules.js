// SafeSignal rules engine. Pure functions, no I/O, no model calls.
// Used unchanged by the browser, the server, the tests and the benchmark,
// so the completeness check and the triage are always transparent and identical.
//
// Multilingual: the text is folded (lower case, accents removed) and checked
// against red-flag patterns written for English, Romanian, German, French and
// Italian. Every pack is applied to every text, so mixed-language reports work.
// The Romanian pack is the primary one; the others have not been reviewed by a
// native speaker and are marked as such in the technical report.

import { tr, tr2 } from './i18n.js';

export const SERIOUSNESS = [
  'death',
  'life_threatening',
  'hospitalisation',
  'disability',
  'congenital_anomaly',
  'other_medically_important',
];

export const SERIOUSNESS_LABEL = {
  death: 'Death',
  life_threatening: 'Life-threatening',
  hospitalisation: 'Hospitalisation',
  disability: 'Lasting disability',
  congenital_anomaly: 'Congenital anomaly',
  other_medically_important: 'Other medically important',
};

export const ENUMS = {
  patient_sex: ['female', 'male', 'other', 'unknown'],
  pregnancy: ['yes', 'no', 'unknown'],
  action_taken: ['stopped', 'dose reduced', 'continued', 'unknown'],
  outcome: ['recovered', 'recovering', 'not recovered', 'fatal', 'unknown'],
  reporter_role: ['patient', 'family member', 'pharmacist', 'pharmacy staff', 'doctor', 'nurse', 'other', 'unknown'],
};

// group -> section shown in the form (English keys; the UI translates them)
export const FIELD_DEFS = [
  { key: 'patient_age', group: 'Patient', label: 'Age', hint: 'e.g. 34 years, 18 months' },
  { key: 'patient_sex', group: 'Patient', label: 'Sex', enum: 'patient_sex' },
  { key: 'pregnancy', group: 'Patient', label: 'Pregnant', enum: 'pregnancy' },
  { key: 'patient_ref', group: 'Patient', label: 'Initials or reference', hint: 'initials or an internal code, never a full name' },
  { key: 'medicine_name', group: 'Suspect medicine', label: 'Medicine', hint: 'brand or generic name' },
  { key: 'medicine_dose', group: 'Suspect medicine', label: 'Dose and frequency', hint: 'e.g. 500 mg three times a day' },
  { key: 'medicine_indication', group: 'Suspect medicine', label: 'Taken for', hint: 'the reason for taking it' },
  { key: 'medicine_start', group: 'Suspect medicine', label: 'Started on', hint: 'date or how long ago' },
  { key: 'medicine_stop', group: 'Suspect medicine', label: 'Stopped on', hint: 'date, or "still taking"' },
  { key: 'other_medicines', group: 'Suspect medicine', label: 'Other medicines', hint: 'anything else taken at the same time' },
  { key: 'reaction_description', group: 'Reaction', label: 'What happened', hint: 'the reaction in the reporter\'s words' },
  { key: 'reaction_onset', group: 'Reaction', label: 'Started on', hint: 'date, or how long after the medicine' },
  { key: 'action_taken', group: 'Reaction', label: 'Action taken', enum: 'action_taken' },
  { key: 'outcome', group: 'Outcome', label: 'Outcome so far', enum: 'outcome' },
  { key: 'seriousness', group: 'Outcome', label: 'Seriousness', list: SERIOUSNESS },
  { key: 'reporter_role', group: 'Reporter', label: 'Reporter is', enum: 'reporter_role' },
];

export const FIELD_KEYS = FIELD_DEFS.map((d) => d.key);

export function emptyFields() {
  const f = {};
  for (const d of FIELD_DEFS) f[d.key] = d.list ? { value: [], quote: '' } : { value: '', quote: '' };
  return f;
}

/** Plain string value of a field, '' when empty or 'unknown'. */
export function val(fields, key) {
  const f = fields && fields[key];
  if (!f) return '';
  const v = Array.isArray(f.value) ? '' : String(f.value ?? '').trim();
  return v.toLowerCase() === 'unknown' ? '' : v;
}

export function serious(fields) {
  const f = fields && fields.seriousness;
  return f && Array.isArray(f.value) ? f.value.filter((s) => SERIOUSNESS.includes(s)) : [];
}

/** Lower case, accents removed (ă→a, ș/ş→s, ț/ţ→t, ö→o, é→e ...), quotes unified. Used for matching only. */
export function fold(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/[’‘`´]/g, "'")
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// ---- Completeness -------------------------------------------------------

// The four minimum criteria for a valid case report (patient, reporter,
// suspect medicine, reaction) plus the other key items.
const KEY_ITEMS = [
  { id: 'patient', test: (f) => !!(val(f, 'patient_age') || val(f, 'patient_sex') || val(f, 'patient_ref')) },
  { id: 'medicine_name', test: (f) => !!val(f, 'medicine_name') },
  { id: 'medicine_dose', test: (f) => !!val(f, 'medicine_dose') },
  { id: 'medicine_start', test: (f) => !!val(f, 'medicine_start') },
  { id: 'reaction_description', test: (f) => !!val(f, 'reaction_description') },
  { id: 'reaction_onset', test: (f) => !!val(f, 'reaction_onset') },
  { id: 'outcome', test: (f) => !!val(f, 'outcome') },
  { id: 'action_taken', test: (f) => !!val(f, 'action_taken') },
  { id: 'reporter_role', test: (f) => !!val(f, 'reporter_role') },
];

// A report is a valid minimum case when these four are present.
const MINIMUM = ['patient', 'medicine_name', 'reaction_description', 'reporter_role'];

export function completeness(fields, lang = 'en') {
  const items = KEY_ITEMS.map((i) => {
    const [label, question] = tr2(lang, 'ci.' + i.id);
    return { id: i.id, label, present: !!i.test(fields), question };
  });
  const present = items.filter((i) => i.present).length;
  const missing = items.filter((i) => !i.present);
  const minimumMet = MINIMUM.every((id) => items.find((i) => i.id === id).present);
  return {
    items,
    present,
    total: items.length,
    percent: Math.round((present / items.length) * 100),
    missing,
    minimumMet,
    minimumMissing: MINIMUM.filter((id) => !items.find((i) => i.id === id).present),
  };
}

// ---- Triage -------------------------------------------------------------

// Each rule has a visible id so a reviewer can see exactly why a level was set.
// Patterns run on fold()ed text, so they are written without accents.
// Language packs: en, ro (primary), de, fr, it.
const EMERGENCY_RULES = [
  {
    id: 'E1',
    en: /anaphyla/,
    ro: /anafilax|anafilact/,
    de: /anaphyla/,
    fr: /anaphyla/,
    it: /anafila/,
  },
  {
    id: 'E2',
    en: /difficult\w*\s+(in\s+)?breath|trouble\s+breath|(can'?t|cannot|can\s+not|couldn'?t|could\s+not|unable\s+to)\s+breathe|short(ness)?\s+of\s+breath|wheez|struggl\w+\s+to\s+breathe|breathless|gasping/,
    ro: /dificult\w*\s+(de\s+|la\s+|in\s+|cu\s+)?(a\s+)?respir|greutat\w*\s+(la|in|de|cu)\s+respir|nu\s+(mai\s+)?(pot|poate|putea|puteam|reuseste|reusea|reuseam|reusesc)\s+(sa\s+)?respir|lipsa\s+de\s+aer|lipsa\s+aerului|lipsea\s+aerul|respiratie\s+(grea|dificila|suieratoare)|\bsufoc|\bsuier\w*\s+(la|in)\s+respir|\bgafai/,
    de: /atemnot|atembeschwerd|schwer\w*\s+(zu\s+)?atm|nicht\s+(mehr\s+)?(richtig\s+)?atmen|kaum\s+(noch\s+)?(luft|atmen)|keine\s+luft|\bluftnot|kurzatmig|(pfeifend|keuchend)\w*\s+atm|\berstick/,
    fr: /difficult\w*\s+(a\s+|pour\s+)?respir|(ne\s+)?(pouvait|peut|arrivait|arrive|parvenait)\s+(plus\s+|pas\s+|presque\s+plus\s+)?(a\s+)?respirer|\bessouffl|souffle\s+court|detresse\s+respiratoire|\bsifflement|\betouff|\bsuffoqu|manque\s+d'air|plus\s+d'air/,
    it: /difficolta\s+(a|di|nel)\s+respir|(non\s+)?(riesce|riusciva|riuscivo|riesco|riuscire)\s+(piu\s+)?a\s+respirare|non\s+respira|fiato\s+corto|\baffanno|dispnea|respiro\s+(affannoso|sibilante)|fame\s+d'aria|\bsoffoc|mancanza\s+d'aria/,
  },
  {
    id: 'E3',
    en: /swell\w*[^.]{0,40}\b(face|lips?|tongue|throat|mouth|eyelids?)\b|\b(face|lips?|tongue|throat|mouth|eyelids?)\b[^.]{0,30}\bswell/,
    // "gura" (mouth) only counts when the swelling word is right next to it ("umflat la gura",
    // "gura i s-a umflat"), so "gura uscata" and unrelated sentences never match.
    ro: /(umfl\w+|edem\w*|angioedem\w*|tumefi\w+)[^.]{0,40}\b(fata|buz\w+|limb\w+|gat\w*|faringe|pleoap\w+)\b|\b(fata|buz\w+|limb\w+|gat\w*|pleoap\w+)\b[^.]{0,30}(umfl|edem|tumefi)|(umfl\w+|edem\w*|tumefi\w+)\s+(la\s+|in\s+|pe\s+|de\s+)?gur\w*|\bgur\w*\s+(i\s+|s-a\s+|s-au\s+|i\s+s-a\s+|i\s+s-au\s+)?(umfl|edem|tumefi)|quincke/,
    de: /(geschwollen\w*|schwellung\w*|angeschwollen|odem|angioodem|quincke)[^.]{0,40}\b(gesicht\w*|lippen?|zunge|hals|rachen|mund|augenlid\w*)\b|\b(gesicht\w*|lippen?|zunge|hals|rachen|mund|augenlid\w*)\b[^.]{0,30}(geschwollen|schwell|schwoll|angeschwollen)/,
    fr: /(gonfl\w+|enfl\w+|oedeme\w*|angio-?oedeme|quincke|tumefi\w+)[^.]{0,40}\b(visage|levres?|langue|gorge|bouche|paupieres?|face)\b|\b(visage|levres?|langue|gorge|bouche|paupieres?)\b[^.]{0,30}(gonfl|enfl|oedeme|tumefi)/,
    it: /(gonfi\w+|tumefa\w+|edema|angioedema)[^.]{0,40}\b(viso|faccia|labbr\w+|lingua|gola|bocca|palpebr\w+)\b|\b(viso|faccia|labbra|labbro|lingua|gola|bocca|palpebre)\b[^.]{0,30}(gonfi|tumef|edema)/,
  },
  {
    id: 'E4',
    en: /chest\s+(pain|tightness|pressure)|tight\w*\s+(in|across)\s+(the\s+)?chest/,
    ro: /dureri?\s+(in|la|de)\s+(piept|torace|cutia\s+toracica)|durere\s+toracica|dureri\s+toracice|presiune\s+(in|la|pe)\s+piept|(stranger\w*|apasare)\s+(in|la|pe)\s+piept|piept\w*\s+(stran\w+|apasa\w+)/,
    de: /brustschmerz|schmerz\w*\s+(in|auf)\s+der\s+brust|brustenge|engegefuhl|druck\s+(auf|in)\s+der\s+brust|brustdruck/,
    fr: /douleur\w*\s+(thoracique|dans\s+(la\s+)?poitrine|a\s+la\s+poitrine)|oppression\s+(thoracique|dans\s+la\s+poitrine)|serrement\s+(dans\s+la\s+poitrine|thoracique)|poitrine\s+(serree|oppressee)/,
    it: /dolor\w*\s+(al\s+petto|toracic\w*|nel\s+petto|retrosternal\w*)|oppressione\s+(al\s+petto|toracica)|petto\s+(stretto|oppresso)|costrizione\s+toracica/,
  },
  {
    id: 'E5',
    en: /seizure|convuls|unconscious|passed\s+out|fainted|collapsed|unresponsive|lost\s+consciousness|blacked\s+out/,
    ro: /convulsi|criza\s+(epileptica|convulsiva)|\blesin|pierdut\s+cunostinta|pierdere\w*\s+(a\s+)?cunostintei|inconstient|nu\s+(mai\s+)?raspunde\s+(la\s+(stimuli|apel|strigat|intrebari|chemari|scuturat)|deloc)|nu\s+reactioneaza|s-a\s+prabusit|colaps|\bsincop/,
    de: /krampfanfall|epileptisch\w*\s+anfall|\bohnmacht|bewusstlos|kollabiert|zusammengebrochen|nicht\s+(mehr\s+)?ansprechbar|bewusstseinsverlust|\bsynkope/,
    fr: /convuls|crise\s+(d'epilepsie|convulsive|epileptique|comitiale)|perdu\s+connaissance|perte\s+de\s+connaissance|\bevanoui|\bsyncope|inconscient|ne\s+reagit\s+plus|ne\s+repond\s+plus\s+aux|s'est\s+effondr/,
    it: /convulsion|crisi\s+(epilettic\w*|convulsiv\w*)|\bsvenut\w*|\bsvenimento|perso\s+(i\s+sensi|conoscenza|coscienza)|perdita\s+(di\s+)?(coscienza|conoscenza|dei\s+sensi)|incosciente|non\s+risponde\s+(agli|ai|alle)|non\s+reagisce|collass|\bsincope/,
  },
  {
    id: 'E6',
    en: /(severe|heavy|uncontrolled|profuse)\s+bleeding|vomit\w*\s+(up\s+)?blood|blood\s+in\s+(the\s+)?(stool|vomit|urine)|black\s+(tarry\s+)?stools?|cough\w*\s+(up\s+)?blood/,
    ro: /sangerar\w*\s+(abundent\w*|puternic\w*|severa|masiv\w*|necontrolat\w*|grava)|(abundent\w*|puternic\w*|masiv\w*|severa)\s+sangerar|hemoragi|(varsat|varsa\w*|vomit\w*)\s+(cu\s+|de\s+)?sange|sange\s+(in|la|pe)\s+(scaun\w*|urina|varsatur\w*|vomism\w*)|scaun\w*\s+negr\w*|scaun\w*\s+cu\s+sange|\bmelena|tuse\w*\s+(cu\s+)?sange|\bhemoptiz/,
    de: /(starke\w*|heftige\w*|massive\w*|unstillbare\w*|schwere\w*)\s+blutung|blutung\w*\s+(stark|heftig|massiv|unstillbar)|blut\s+erbrochen|bluterbrechen|erbrach\w*\s+blut|erbricht\s+blut|blut\s+(im|in\s+der|in\s+den)\s+(stuhl|urin|erbrochene\w*)|teerstuhl|schwarz\w*\s+stuhl|blut\s+(ge)?hustet|hustet\w*\s+blut|\bblutsturz/,
    fr: /saignement\w*\s+(abondant\w*|important\w*|severe\w*|massif\w*|incontrolable\w*|grave)|hemorragi|vomi\w*\s+(du\s+|de\s+)?sang|vomissement\w*\s+(de\s+|du\s+)?sang|sang\s+dans\s+(les\s+|ses\s+)?(selles|urines|vomissements)|selles\s+noires|\bmelena|crach\w+\s+(du\s+|de\s+)?sang|\bhemoptysie/,
    it: /\bemorragi|sanguinamento\s+(abbondante|grave|massiv\w*|incontrollabil\w*|importante)|vomit\w*\s+(di\s+|del\s+)?sangue|\bematemesi|sangue\s+(nelle|nei|nell')\s*(feci|urine|vomito)|feci\s+nere|\bmelena|(tosse|sputo)\s+con\s+sangue|\bemottisi/,
  },
  {
    id: 'E7',
    en: /suicid|self[- ]harm|want(s|ed)?\s+to\s+(die|kill)|end\s+(my|his|her|their)\s+life/,
    ro: /suicid|sinucid|autovatam|autoagres|vrea\s+sa\s+(moara|se\s+omoare|isi\s+ia\s+viata|se\s+sinucida)|sa\s+se\s+omoare|sa\s+(imi|isi)\s+(iau|ia)\s+viata|nu\s+mai\s+vrea\s+sa\s+traiasca/,
    de: /suizid|selbstmord|selbstverletz|selbsttotung|sich\s+(das\s+leben\s+)?(nehmen|umbringen|toten)|nicht\s+mehr\s+leben\s+(will|wollen)|lebensmude/,
    fr: /suicid|automutil|se\s+faire\s+du\s+mal|mettre\s+fin\s+a\s+(ses|ma|sa|mes)\s+(jours|vie)|veut\s+mourir|se\s+tuer|se\s+donner\s+la\s+mort/,
    it: /suicid|autolesion|farsi\s+del\s+male|togliersi\s+la\s+vita|togliermi\s+la\s+vita|vuole\s+morire|uccidersi/,
  },
];

const PRIORITY_TEXT_RULES = [
  {
    id: 'P1',
    en: /blister|peeling\s+skin|skin\s+(is\s+|was\s+)?peeling|mouth\s+sores|stevens|widespread\s+rash/,
    ro: /\bbasic(?!a\s+urinar)\w*|vezicul\w+|\bbule\b|descuam|desprindere\w*\s+(a\s+)?piel|piele\w*\s+(care\s+)?(se\s+)?(desprinde|exfoliaza|cojeste|jupoaie)|(rani|afte|ulcer\w+)\s+(in|la|pe)\s+(gura|mucoas\w+|cavitatea\s+bucala)|stevens|eruptie\s+(cutanata\s+)?(extinsa|generalizata|difuza)/,
    de: /blasenbildung|hautblasen|blasen\s+(auf|an|im)\s+(der\s+)?(haut|mund)|abschalung|haut\s+(loest|lost|schalt)\s+sich|stevens|wunden\s+im\s+mund|ausgedehnt\w*\s+(haut)?ausschlag/,
    fr: /\bcloque|bulles?\s+(sur|de)\s+(la\s+)?peau|desquam|decollement\s+(de\s+la\s+)?peau|ulcerations?\s+buccales|aphtes?\s+(dans\s+la\s+bouche|buccaux)|stevens|eruption\s+(cutanee\s+)?(etendue|generalisee|diffuse)/,
    it: /vescicole|\bbolle\s+(sulla|sul|in)|pelle\s+(che\s+)?si\s+(stacca|squama)|desquam|ulcere\s+(in\s+bocca|orali)|afte\s+(in|nella)\s+bocca|stevens|eruzione\s+(cutanea\s+)?(estesa|diffusa|generalizzata)/,
  },
  {
    id: 'P2',
    en: /jaundice|yellow(ing|ed)?\s+(of\s+)?(the\s+)?(skin|eyes)/,
    ro: /\bicter|galben\w*\s+(la\s+)?(piel|ochi|tegument|sclere)|piele\w*\s+(este\s+|e\s+|a\s+devenit\s+)?galben\w*|ochii\s+(sunt\s+)?galben\w*|sclere\w*\s+galben/,
    de: /gelbsucht|gelbfarbung|gelb\w*\s+(haut|augen)|haut\s+(ist\s+|wurde\s+)?gelb|augen\s+(sind\s+|wurden\s+)?gelb|\bikterus/,
    fr: /jaunisse|\bictere|peau\s+(est\s+|devenue\s+)?jaune|yeux\s+(sont\s+|devenus\s+)?jaunes|jaunissement/,
    it: /\bittero|pelle\s+(e\s+|di\s+colore\s+)?gialla|occhi\s+gialli|ingiallimento/,
  },
  {
    id: 'P3',
    en: /hospitali[sz]|admitted|emergency\s+(department|room)|\ba\s*&\s*e\b|intensive\s+care|\bicu\b|ambulance/,
    // spital / spitalul / spitale ... and spitaliz* (spitalizat, spitalizare), but not "spitalicesc"
    ro: /\bspital(ul|ului|e|ele|elor)?\b|\bspitaliz\w*|\binternat\w*|\binternare|\bambulant\w*|\bupu\b|camera\s+de\s+garda|terapie\s+intensiva|\bsmurd\b/,
    de: /krankenhaus|\bspital(s|er)?\b|\bspitalaufenthalt|\bspitaleintritt|notaufnahme|rettungsdienst|rettungswagen|krankenwagen|notarzt|intensivstation|stationar|eingeliefert|eingewiesen/,
    fr: /hospitalis|\bhopital|\burgences\b|ambulance|\bsamu\b|reanimation|soins\s+intensifs/,
    it: /\bricoverat\w*|\bricovero|\bospedal\w*|pronto\s+soccorso|ambulanza|terapia\s+intensiva|\b118\b/,
  },
  {
    id: 'P4',
    en: /\bdied\b|\bdeath\b|passed\s+away|\bfatal/,
    ro: /\bdecedat|\bdeces\w*|\ba\s+murit|\bau\s+murit|\bmoarte\w*|\bletal|\bfatal/,
    de: /\bgestorben|\bverstorben|\bverstarb|\btod\b|\btodlich|\btodesfall|\bstarb\b/,
    fr: /\bdecede|\bdeces\b|\best\s+mort|\bmort\b|\bmorte\b|\bfatal/,
    it: /\bmorto\b|\bmorta\b|\bdeceduto|\bdeceduta|\bdecesso|\bfatale/,
  },
];

const LANG_PACKS = ['en', 'ro', 'de', 'fr', 'it'];

/** First language pack whose pattern matches the folded text, or null. */
function matchRule(rule, folded, packs = LANG_PACKS) {
  for (const l of packs) if (rule[l] && rule[l].test(folded)) return l;
  return null;
}

// age units in the five languages, matched on folded text
const AGE_RE =
  /(\d+(?:[.,]\d+)?)\s*(?:de\s+)?(years?|yrs?|y|ani|an|jahre?|ans|annees?|anni|anno|months?|mos?|luni|luna|monate?|mois|mesi|mese|weeks?|wks?|saptamani|saptamana|wochen|woche|semaines?|settimane|settimana|days?|zile|zi|tage?|jours?|jour|giorni|giorno)\b/;

export function parseAgeYears(text) {
  const m = AGE_RE.exec(fold(text));
  if (!m) return null;
  const n = parseFloat(m[1].replace(',', '.'));
  const u = m[2];
  if (/^(y|yr|ye|ani|an$|jahr|ans$|annee|anni|anno)/.test(u)) return n;
  if (/^(mo|lun|mois|mes)/.test(u)) return n / 12;
  if (/^(w|sapt|woch|sem|sett)/.test(u)) return n / 52;
  if (/^(d|zi|zile|tag|jour|giorn)/.test(u)) return n / 365;
  return null;
}

/**
 * Transparent triage. Order of precedence: emergency > priority > routine.
 * It never diagnoses; it only says how fast a human should look at the report.
 * `lang` only changes the wording shown; the level and rule ids never depend on it.
 * `packs` restricts which language packs are applied (default: all; used by the benchmark baseline).
 */
export function triage(fields, narrative = '', lang = 'en', packs = LANG_PACKS) {
  const reasons = [];
  const textParts = [narrative, val(fields, 'reaction_description'), val(fields, 'outcome')];
  const text = fold(textParts.filter(Boolean).join(' . '));
  const add = (id, level, vars = {}, matched = null) =>
    reasons.push({ id, level, text: tr(lang, 'rule.' + id, vars), ...(matched ? { matched } : {}) });

  for (const r of EMERGENCY_RULES) {
    const l = matchRule(r, text, packs);
    if (l) add(r.id, 'emergency', {}, l);
  }
  const sers = serious(fields);
  if (sers.length) add('S1', 'priority', { list: sers.map((s) => tr(lang, 'ser.' + s)).join(', ') });
  if (val(fields, 'outcome') === 'fatal') add('S2', 'priority');
  for (const r of PRIORITY_TEXT_RULES) {
    const l = matchRule(r, text, packs);
    if (l) add(r.id, 'priority', {}, l);
  }
  const age = parseAgeYears(val(fields, 'patient_age'));
  if (age !== null && age < 2) add('V1', 'priority');
  if (val(fields, 'pregnancy') === 'yes') add('V2', 'priority');
  if (val(fields, 'outcome') === 'not recovered') add('O1', 'priority');

  let level = 'routine';
  if (reasons.some((r) => r.level === 'priority')) level = 'priority';
  if (reasons.some((r) => r.level === 'emergency')) level = 'emergency';
  if (!reasons.length) add('R0', 'routine');

  return { level, label: tr(lang, 'tri.' + level), message: tr(lang, 'tri.' + level + '.msg'), reasons };
}

// ---- Report -------------------------------------------------------------

export const DISCLAIMER = tr('en', 'disclaimer');

export function assess(fields, narrative = '', lang = 'en') {
  return { completeness: completeness(fields, lang), triage: triage(fields, narrative, lang) };
}

/** Structured draft report (always English keys and wording). Nothing is sent; status says who has reviewed it. */
export function buildReport(fields, narrative, meta = {}, reviewed = false) {
  const a = assess(fields, narrative, 'en');
  const g = (k) => val(fields, k) || null;
  return {
    schema: 'safesignal-apertus.draft-report.v1',
    status: reviewed ? 'REVIEWED_BY_HUMAN_NOT_SENT' : 'DRAFT_NEEDS_HUMAN_REVIEW',
    generatedAt: meta.generatedAt || new Date().toISOString(),
    disclaimer: DISCLAIMER,
    reportLanguage: meta.language || null,
    patient: {
      age: g('patient_age'),
      sex: g('patient_sex'),
      pregnant: g('pregnancy'),
      reference: g('patient_ref'),
    },
    suspectMedicine: {
      name: g('medicine_name'),
      dose: g('medicine_dose'),
      indication: g('medicine_indication'),
      startedOn: g('medicine_start'),
      stoppedOn: g('medicine_stop'),
      otherMedicines: g('other_medicines'),
    },
    reaction: {
      description: g('reaction_description'),
      onset: g('reaction_onset'),
      actionTaken: g('action_taken'),
    },
    outcome: g('outcome'),
    seriousness: serious(fields),
    reporter: { role: g('reporter_role') },
    triage: { level: a.triage.level, reasons: a.triage.reasons.map((r) => ({ id: r.id, text: r.text })) },
    completeness: {
      percent: a.completeness.percent,
      minimumMet: a.completeness.minimumMet,
      missing: a.completeness.missing.map((m) => m.label),
    },
    narrative,
    provenance: {
      extraction: meta.extraction || 'manual entry',
      model: meta.model || null,
      backend: meta.backend || null,
    },
  };
}
