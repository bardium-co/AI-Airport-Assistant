import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { T, BUILTIN_LANGS, PLACES, INTENT_WORDS, LANGUAGE_META, LANG_PACKS, AREAS, t } from '../server/services/phrases.js';
import { PHRASEBOOK } from '../server/services/translate.js';
import { matchPlace, prepare, hasIntentWord, chooseLanguage } from '../server/services/nlu.js';

const S = (await import('../public/js/i18n.js')).STRINGS;
const DIR = new URL('../public/lang/', import.meta.url);
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
const packs = files.map(f => [f, JSON.parse(fs.readFileSync(new URL(f, DIR), 'utf8'))]);
const ph = v => (typeof v === 'string' ? (v.match(/\{\w+\}/g) ?? []).sort().join() : '');

test('there are many language packs, all loaded by the server', () => {
  assert.ok(packs.length >= 35, `only ${packs.length} packs`);
  assert.ok(BUILTIN_LANGS.length >= 45, `only ${BUILTIN_LANGS.length} languages`);
  for (const [, p] of packs) assert.ok(BUILTIN_LANGS.includes(p.code), p.code);
  assert.equal(LANG_PACKS.length, packs.length);
  assert.equal(new Set(BUILTIN_LANGS).size, BUILTIN_LANGS.length, 'no duplicate language codes');
});

for (const [file, p] of packs) {
  test(`language pack ${file} is complete and consistent`, () => {
    assert.equal(file, `${p.code}.json`);
    assert.match(p.code, /^[a-z]{2,3}(-[A-Z]{2})?$/);
    assert.ok(p.name && p.native, 'names');
    assert.match(p.speech, /^[a-z]{2,3}-[A-Z]{2}$/, 'BCP-47 speech code');
    if (p.base) { assert.ok(T[p.base], `base ${p.base}`); return; }
    assert.ok([0, 1, true, false].includes(p.rtl ?? 0));
    assert.ok(p.review, 'review status recorded');
    // Interface
    for (const k of Object.keys(S.en)) {
      assert.ok(typeof p.ui[k] === 'string' && p.ui[k].trim(), `ui.${k} missing`);
      assert.equal(ph(p.ui[k]), ph(S.en[k]), `ui.${k} placeholders`);
    }
    assert.deepEqual(Object.keys(p.ui).filter(k => !(k in S.en)), [], 'unknown ui keys');
    for (const k of ['how_help', 'disclaimer', 'verified_at_desk', 'error_generic']) assert.notEqual(p.ui[k], S.en[k], `ui.${k} untranslated`);
    // Spoken answer templates
    for (const k of Object.keys(T.en)) {
      assert.ok(p.t[k], `t.${k} missing`);
      if (k === 'status') { assert.equal(p.t.status.length, T.en.status.length); continue; }
      assert.equal(ph(p.t[k]), ph(T.en[k]), `t.${k} placeholders`);
    }
    for (const k of ['greeting', 'fallback', 'gate_closes']) assert.notEqual(p.t[k], T.en[k], `t.${k} untranslated`);
    assert.match(p.t.gate_closes, /20/, 'gate-closing time kept');
    // Keywords and phrasebook
    for (const type of Object.keys(PLACES)) assert.ok(p.places[type]?.length, `places.${type}`);
    for (const intent of Object.keys(INTENT_WORDS)) assert.ok(p.intents[intent]?.length, `intents.${intent}`);
    for (const id of Object.keys(PHRASEBOOK)) assert.ok(p.phrasebook[id], `phrasebook.${id}`);
    // Server merge
    assert.equal(t(p.code, 'greeting'), p.t.greeting);
    assert.equal(AREAS[p.code][1], p.ui.area_south);
    assert.ok(LANGUAGE_META.find(l => l.code === p.code));
    assert.equal(PHRASEBOOK.wait[p.code], p.phrasebook.wait);
  });
}

test('every pack recognises its own words for toilet, prayer room and gate', () => {
  for (const [, p] of packs) {
    if (p.base) continue;
    assert.equal(matchPlace(prepare(p.places.toilet[0]), p.code), 'toilet', `${p.code} toilet "${p.places.toilet[0]}"`);
    assert.equal(matchPlace(prepare(p.places.prayer[0]), p.code), 'prayer', `${p.code} prayer "${p.places.prayer[0]}"`);
    assert.ok(hasIntentWord(prepare(p.intents.gate[0]), 'gate', p.code), `${p.code} gate word`);
  }
});

test('script detection picks the right language and respects a chosen language that shares the script', () => {
  const all = BUILTIN_LANGS;
  const cases = [
    ['QR 572のゲートはどこですか', 'en', 'ja'], ['QR 572 게이트가 어디예요', 'en', 'ko'], ['ประตูขึ้นเครื่อง QR 572 อยู่ไหน', 'en', 'th'],
    ['השער של QR 572', 'en', 'he'], ['Πού είναι η πύλη;', 'en', 'el'], ['የQR 572 በር የት ነው', 'en', 'am'],
    ['گیت پرواز QR 572 کجاست', 'en', 'fa'], ['ګېټ چیرته دی', 'en', 'ps'], ['Де вихід на посадку', 'en', 'uk'], ['Қақпа қайда', 'en', 'kk'],
    ['登機門在哪裡', 'zh-TW', 'zh-TW'], ['搭乗口', 'ja', 'ja'], ['गेट कहाँ छ', 'ne', 'ne'], ['ಗೇಟ್ ಎಲ್ಲಿದೆ', 'en', 'kn'], ['ਗੇਟ ਕਿੱਥੇ ਹੈ', 'en', 'pa'],
    ['గేట్ ఎక్కడ ఉంది', 'en', 'te'], ['ગેટ ક્યાં છે', 'en', 'gu'], ['ගේට්ටුව කොහෙද', 'en', 'si'], ['Kapı nerede?', 'tr', 'tr'],
  ];
  for (const [text, requested, expected] of cases) assert.equal(chooseLanguage(text, requested, all), expected, text);
});
