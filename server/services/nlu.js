import { AIRLINE_ALIASES, KNOWN_AIRLINES, PLACES, INTENT_WORDS } from './phrases.js';
import { repairTranscript, fuzzyHasKeyword } from './speechfix.js';

const DIGIT_BLOCKS = [0x0660, 0x06F0, 0x0966, 0x09E6, 0x0D66, 0x0BE6, 0x0AE6, 0x0A66, 0x0C66, 0x0CE6, 0x0E50, 0x0ED0, 0x1040, 0x17E0, 0x0DE6, 0xFF10];

/** Convert native-script digits (Arabic-Indic, Devanagari, Bengali, Malayalam, full-width…) to ASCII. */
export function normalizeDigits(text) {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    let mapped = null;
    for (const base of DIGIT_BLOCKS) {
      if (cp >= base && cp <= base + 9) { mapped = String(cp - base); break; }
    }
    out += mapped ?? ch;
  }
  return out;
}

const URDU_ONLY = /[ٹڈڑںےۓھ]/u;
const PASHTO_ONLY = /[ټډړږښګڼېۍ]/u;
const PERSIAN_HINT = /[پچژگکی]/u;
const KAZAKH_ONLY = /[әғқңөұүһ]/iu;
const UKRAINIAN_ONLY = /[іїєґ]/iu;

// Languages that share a writing system: typing in that script keeps the passenger's chosen language.
export const SCRIPT_GROUP = {
  hi: 'deva', ne: 'deva', mr: 'deva', ar: 'arab', ur: 'arab', fa: 'arab', ps: 'arab', ru: 'cyrl', uk: 'cyrl', kk: 'cyrl',
  zh: 'han', 'zh-TW': 'han', ja: 'han', bn: 'beng', ml: 'mlym', ta: 'taml', te: 'telu', kn: 'knda', gu: 'gujr', pa: 'guru',
  th: 'thai', ko: 'hang', he: 'hebr', el: 'grek', am: 'ethi', si: 'sinh',
};

/** Detect language from writing script. Returns null for Latin text (ambiguous). */
export function detectScript(text) {
  const counts = {};
  const tests = [
    ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/u], ['ko', /\p{Script=Hangul}/u], ['zh', /\p{Script=Han}/u],
    ['hi', /\p{Script=Devanagari}/u], ['ar', /\p{Script=Arabic}/u], ['bn', /\p{Script=Bengali}/u],
    ['ml', /\p{Script=Malayalam}/u], ['ru', /\p{Script=Cyrillic}/u], ['ta', /\p{Script=Tamil}/u],
    ['te', /\p{Script=Telugu}/u], ['kn', /\p{Script=Kannada}/u], ['gu', /\p{Script=Gujarati}/u], ['pa', /\p{Script=Gurmukhi}/u],
    ['th', /\p{Script=Thai}/u], ['he', /\p{Script=Hebrew}/u], ['el', /\p{Script=Greek}/u], ['am', /\p{Script=Ethiopic}/u],
    ['si', /\p{Script=Sinhala}/u], ['latin', /\p{Script=Latin}/u],
  ];
  for (const ch of text) {
    for (const [lang, re] of tests) if (re.test(ch)) { counts[lang] = (counts[lang] ?? 0) + 1; break; }
  }
  // Any kana means Japanese, even when most characters are kanji.
  if (counts.ja) return 'ja';
  const best = Object.entries(counts).filter(([k]) => k !== 'latin').sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  if (best[0] === 'ar') {
    if (URDU_ONLY.test(text)) return 'ur';
    if (PASHTO_ONLY.test(text)) return 'ps';
    if (PERSIAN_HINT.test(text)) return 'fa';
    return 'ar';
  }
  if (best[0] === 'ru') {
    if (KAZAKH_ONLY.test(text)) return 'kk';
    if (UKRAINIAN_ONLY.test(text)) return 'uk';
  }
  return best[0];
}

/** Pick reply language: script detection wins when it is unambiguous and enabled. */
export function chooseLanguage(text, requested, enabled) {
  const detected = detectScript(text);
  if (detected) {
    // Same writing system as the passenger's chosen language (e.g. Arabic script while Urdu or Persian is
    // selected, kanji while Japanese is selected, Devanagari while Nepali is selected) → honour the selection.
    const sameScript = SCRIPT_GROUP[detected] && SCRIPT_GROUP[detected] === SCRIPT_GROUP[requested] && !(detected === 'ja' && requested !== 'ja');
    if (sameScript && enabled.includes(requested)) return requested;
    if (enabled.includes(detected)) return detected;
  }
  return enabled.includes(requested) ? requested : 'en';
}

/** Replace spoken airline names / transliterations with IATA codes. */
export function normalizeAirlines(text) {
  let s = text;
  for (const [re, code] of AIRLINE_ALIASES) s = s.replace(re, ` ${code} `);
  return s;
}

export function prepare(text) {
  let s = normalizeDigits(String(text ?? '')).normalize('NFC');
  s = repairTranscript(s); // fix common speech-recognition mishearings ("launch" → lounge, "queue are five seven two" → QR 572)
  s = normalizeAirlines(s);
  // "Q R 572" → "QR 572"
  s = s.replace(/\b([A-Za-z])[\s.]+([A-Za-z])[\s.]*(?=\d)/g, '$1$2 ');
  return s.replace(/\s+/g, ' ').trim();
}

/** Extract a flight number like QR572 / QR 572 / 6E 1234. Returns normalized "QR572" or null. */
export function extractFlight(prepared) {
  const up = prepared.toUpperCase();
  const spaced = /(?:^|[^A-Z0-9])([A-Z0-9]{2})\s*-?\s*(\d{1,4})(?![0-9])/g;
  let m;
  while ((m = spaced.exec(up))) {
    const code = m[1];
    if (!/[A-Z]/.test(code)) continue;
    if (KNOWN_AIRLINES.has(code)) return code + m[2].replace(/^0+(?=\d)/, '');
  }
  const compact = /(?:^|[^A-Z0-9])([A-Z]{2}|[A-Z]\d|\d[A-Z])(\d{2,4})(?![A-Z0-9])/g;
  while ((m = compact.exec(up))) {
    // Letter+digit prefixes (e.g. "A3" in "A320") are only accepted for known airline codes.
    if (/\d/.test(m[1]) && !KNOWN_AIRLINES.has(m[1])) continue;
    return m[1] + m[2].replace(/^0+(?=\d)/, '');
  }
  return null;
}

const GATE_WORDS = '(?:gate|गेट|بوابة|البوابة|گیٹ|গেট|ഗേറ്റ്|登机口|porte|puerta|выход|flugsteig|gate)';

/** Extract a gate code such as C14. Requires an uppercase letter or a nearby "gate" word. */
export function extractGate(prepared) {
  const withWord = new RegExp(`${GATE_WORDS}\\s*(?:no\\.?|number|नंबर|نمبر|رقم|№)?\\s*([a-eA-E])\\s*-?\\s*(\\d{1,2})(?![0-9])`, 'iu');
  let m = prepared.match(withWord);
  if (m) return m[1].toUpperCase() + Number(m[2]);
  const before = new RegExp(`(?:^|[^A-Za-z0-9])([a-eA-E])\\s*-?\\s*(\\d{1,2})(?![0-9])\\s*${GATE_WORDS}`, 'iu');
  m = prepared.match(before);
  if (m) return m[1].toUpperCase() + Number(m[2]);
  m = prepared.match(/(?:^|[^A-Za-z0-9])([A-E])-?(\d{1,2})(?![0-9A-Za-z])/);
  if (m) return m[1] + Number(m[2]);
  return null;
}

const LATINISH = /^[\p{Script=Latin}\p{Script=Cyrillic}\s'&().-]+$/u;

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const ARABIC_SCRIPT = /\p{Script=Arabic}/u;

/** Normalise Arabic-script text: strip diacritics/tatweel, unify alef/ya/ta-marbuta, drop the "al-" article. */
export function normArabic(s) {
  return s.replace(/[ً-ٰٟـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/(^|[\s،؟.!])(?:و)?ال(?=\S{2,})/gu, '$1');
}

/** Does `text` (lowercased) contain keyword `kw`, honouring word boundaries for alphabetic scripts? */
export function hasKeyword(text, kw) {
  const k = kw.toLowerCase();
  if (!k) return false;
  if (ARABIC_SCRIPT.test(k)) return normArabic(text).includes(normArabic(k));
  if (LATINISH.test(k)) {
    const re = k.length <= 3
      ? new RegExp(`(^|[^\\p{L}])${escapeRe(k)}($|[^\\p{L}])`, 'u')
      : new RegExp(`(^|[^\\p{L}])${escapeRe(k)}`, 'u');
    return re.test(text);
  }
  return text.includes(k);
}

function matchesGroup(text, group, langs) {
  for (const lang of langs) {
    const list = group[lang];
    if (!list) continue;
    for (const kw of list) if (hasKeyword(text, kw)) return true;
  }
  return false;
}

function langOrder(lang) {
  return lang === 'en' ? Object.keys(PLACES.prayer) : [lang, 'en', ...Object.keys(PLACES.prayer).filter(l => l !== lang && l !== 'en')];
}

/** Second pass: tolerate small spelling or recognition errors ("lounje", "toilett", "restaurent") in the passenger's language and English. */
function fuzzyGroup(text, group, lang) {
  for (const l of new Set([lang, 'en'])) for (const kw of group[l] ?? []) if (fuzzyHasKeyword(text, kw)) return true;
  return false;
}

/** Which place type is mentioned (prayer room, toilet…)? */
export function matchPlace(prepared, lang) {
  const text = prepared.toLowerCase();
  const order = langOrder(lang);
  for (const [type, group] of Object.entries(PLACES)) {
    if (matchesGroup(text, group, order)) return type;
  }
  for (const [type, group] of Object.entries(PLACES)) {
    if (fuzzyGroup(text, group, lang)) return type;
  }
  return null;
}

export function hasIntentWord(prepared, intent, lang, { fuzzy = true } = {}) {
  const text = prepared.toLowerCase();
  return matchesGroup(text, INTENT_WORDS[intent], langOrder(lang)) || (fuzzy && fuzzyGroup(text, INTENT_WORDS[intent], lang));
}

export function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}
