// Speech-recognition repair: browsers' speech engines often mishear airport words ("lounge" → "launch",
// "QR 572" → "queue are five seven two", "gate C9" → "get see nine"). These rules repair the transcript
// before understanding. They only rewrite words into the airport vocabulary the passenger most likely
// meant; they never invent flight numbers — digits come only from what the passenger said.

const UNITS = { zero: 0, oh: 0, o: 0, nil: 0, one: 1, won: 1, two: 2, to: 2, too: 2, three: 3, tree: 3, four: 4, for: 4, fore: 4, five: 5, six: 6, seven: 7, eight: 8, ate: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
// Homophones (to/too/for/won/ate/tree/o) only count as numbers inside a run that already has a real number word.
const AMBIGUOUS = new Set(['to', 'too', 'for', 'fore', 'won', 'ate', 'tree', 'o']);
const NUM_WORD = new RegExp(`^(?:${[...Object.keys(UNITS), ...Object.keys(TEENS), ...Object.keys(TENS), 'hundred', 'double', 'triple', 'and'].join('|')})$`, 'i');

/** "five seven two" → "572", "five seventy two" → "572", "twelve thirty four" → "1234", "double one" → "11". */
export function wordsToDigits(words) {
  const w = words.map(x => x.toLowerCase()).filter(x => x !== 'and');
  let out = '';
  for (let i = 0; i < w.length; i++) {
    const t = w[i];
    if ((t === 'double' || t === 'triple') && w[i + 1] in UNITS) { out += String(UNITS[w[i + 1]]).repeat(t === 'double' ? 2 : 3); i++; continue; }
    if (t === 'hundred') {
      const lead = out.slice(-1) || '1';
      out = out.slice(0, -1);
      const nt = w[i + 1], nu = w[i + 2];
      if (nt in TENS) { out += lead + String(TENS[nt] + (nu in UNITS && UNITS[nu] ? UNITS[nu] : 0)); i += nu in UNITS && UNITS[nu] ? 2 : 1; }
      else if (nt in TEENS) { out += lead + String(TEENS[nt]); i++; }
      else if (nt in UNITS) { out += lead + '0' + UNITS[nt]; i++; }
      else out += lead + '00';
      continue;
    }
    if (t in TEENS) { out += String(TEENS[t]); continue; }
    if (t in TENS) {
      const n = w[i + 1];
      if (n in UNITS && UNITS[n] > 0) { out += String(TENS[t] + UNITS[n]); i++; } else out += String(TENS[t]);
      continue;
    }
    if (t in UNITS) { out += String(UNITS[t]); continue; }
  }
  return out;
}

/** Replace runs of spoken number words with digits (a single word only right after an airline code or gate letter). */
function convertNumberWords(s) {
  const tokens = s.split(/(\s+|-)/);
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (NUM_WORD.test(tok) && !AMBIGUOUS.has(tok.toLowerCase()) && tok.toLowerCase() !== 'and') {
      // collect the run (number words separated by spaces/hyphens)
      const words = [tok];
      let j = i + 1;
      while (j + 1 < tokens.length && /^(\s+|-)$/.test(tokens[j]) && NUM_WORD.test(tokens[j + 1])) { words.push(tokens[j + 1]); j += 2; }
      while (words.length && /^(and|to|too|for|fore)$/i.test(words.at(-1))) { words.pop(); j -= 2; }
      const prev = out.join('').trimEnd();
      const afterCode = /(?:\b[A-Z][A-Z0-9]|\b[A-Z0-9][A-Z]|\bgate\s+[A-Ea-e]|\b[A-E]|\bflight(?:\s+(?:number|no\.?))?|\bnumber)$/i.test(prev);
      if (words.length >= 2 || afterCode) {
        const digits = wordsToDigits(words);
        if (digits) { out.push(digits); i = j; continue; }
      }
    }
    out.push(tok);
    i++;
  }
  return out.join('');
}

const NUM_AHEAD = '(?=[\\s-]*(?:\\d|zero|oh|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|double|triple))';
const LETTER = '(?:[a-e]|see|sea|si|bee|be|ay|eh|dee|ee)';

// Common English mishearings of airport words (only rewritten in a matching context).
const FIXES = [
  [/\b(?:launch(?:es)?|lunge|lounges|lounch|launge|lownge|lounj|lawnge)\b/gi, 'lounge'],
  [new RegExp(`\\b(?:queue|cue|kyu|kew|q|cure|kure|qu)[\\s.-]*(?:are|r|ar|aar|our)\\b${NUM_AHEAD}`, 'gi'), 'QR'],
  [new RegExp(`\\b(?:cure|kure)\\b${NUM_AHEAD}`, 'gi'), 'QR'],
  [new RegExp(`\\bqatar\\b(?!\\s*airways)${NUM_AHEAD}`, 'gi'), 'QR'],
  [new RegExp(`\\b(?:get|gait|great|kate|gay|date|gates|gated)\\b(?=\\s+${LETTER}\\s*-?\\s*(?:\\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty))`, 'gi'), 'gate'],
  [/\b(?:player|players|pray|praying|prayers)\s+(?=(?:room|rooms|area|place|hall)\b)/gi, 'prayer '],
  [/\btoy\s*lets?\b|\bto\s+let\b/gi, 'toilet'],
  [/\b(?:why|wi|wy)[\s-]?(?:fi|fy|fie)\b|\bwifey\b|\bwi-fi\b/gi, 'wifi'],
  [/\b(?:fight|flite)\b(?=\s+(?:number|no|qr|[a-z]{2}\s*\d|\d))/gi, 'flight'],
  [/\b(?:fight|flite)s?\b(?=\s+(?:to|from|for|is|status|time))/gi, 'flight'],
  [/\bin\s+formation\b/gi, 'information'],
  [/\bwheel\s+chair\b/gi, 'wheelchair'],
  [/\bsmoke\s+in(?:g)?\s+room\b/gi, 'smoking room'],
];
const GATE_LETTER = { a: 'A', ay: 'A', eh: 'A', b: 'B', bee: 'B', be: 'B', c: 'C', see: 'C', sea: 'C', si: 'C', d: 'D', dee: 'D', e: 'E', ee: 'E' };

/** Repair an (English or Latin-script) speech transcript. Non-Latin text is returned unchanged. */
export function repairTranscript(text) {
  let s = String(text ?? '');
  if (!/[A-Za-z]/.test(s)) return s;
  for (const [re, rep] of FIXES) s = s.replace(re, rep);
  // "gate see nine" → "gate C 9" (letter spoken as a word right after "gate")
  s = s.replace(new RegExp(`\\bgate\\s+(${LETTER})\\b${NUM_AHEAD}`, 'gi'), (m, l) => `gate ${GATE_LETTER[l.toLowerCase()]}`);
  s = convertNumberWords(s);
  // "QR 5 7 2" (digits spoken one by one) → "QR 572"
  s = s.replace(/\b([A-Z][A-Z0-9]|[A-Z0-9][A-Z])((?:\s+\d){2,4})\b/g, (m, code, ds) => `${code} ${ds.replace(/\s+/g, '')}`);
  return s;
}

// ---------------------------------------------------------------- fuzzy word matching (typos, accents)
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev[j - 2] + 1); // transposition
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Does any word in `text` closely match the single Latin-script keyword `kw`? (≥5 letters: 1 edit; ≥8 letters: 2 edits) */
export function fuzzyHasKeyword(text, kw) {
  const k = kw.toLowerCase();
  if (k.length < 5 || /\s/.test(k) || !/^[\p{Script=Latin}]+$/u.test(k)) return false;
  const max = k.length >= 8 ? 2 : 1;
  for (const w of text.toLowerCase().split(/[^\p{L}]+/u)) {
    if (w.length < 4 || w === k) continue;
    if (editDistance(w, k, max) <= max) return true;
  }
  return false;
}
