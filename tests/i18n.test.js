import { test } from 'node:test';
import assert from 'node:assert/strict';
import { T, BUILTIN_LANGS, PLACES, INTENT_WORDS, LANGUAGE_META, t } from '../server/services/phrases.js';
import { PHRASEBOOK, phrasebookLookup } from '../server/services/translate.js';
import { FAQS } from '../server/seed.js';

const clientI18n = await import('../public/js/i18n.js');

test('every built-in language has every assistant template with the same placeholders', () => {
  const keys = Object.keys(T.en);
  const ph = s => (Array.isArray(s) ? '' : (s.match(/\{\w+\}/g) ?? []).sort().join());
  for (const lang of BUILTIN_LANGS) {
    for (const k of keys) {
      assert.ok(T[lang][k], `${lang}.${k} missing`);
      assert.equal(ph(T[lang][k]), ph(T.en[k]), `${lang}.${k} placeholders differ`);
    }
    assert.equal(T[lang].status.length, T.en.status.length, `${lang} statuses`);
  }
});

test('language metadata covers all built-in languages with speech codes', () => {
  for (const l of BUILTIN_LANGS) {
    const m = LANGUAGE_META.find(x => x.code === l);
    assert.ok(m, l);
    assert.match(m.speech, /^[a-z]{2,3}-[A-Z]{2}$/);
  }
  assert.equal(LANGUAGE_META.find(l => l.code === 'ar').rtl, 1);
  assert.equal(LANGUAGE_META.find(l => l.code === 'ur').rtl, 1);
});

test('place names and keywords exist for every language', () => {
  for (const [type, byLang] of Object.entries(PLACES)) for (const l of BUILTIN_LANGS) assert.ok(byLang[l]?.length, `${type}.${l}`);
  for (const [intent, byLang] of Object.entries(INTENT_WORDS)) for (const l of BUILTIN_LANGS) assert.ok(byLang[l]?.length, `${intent}.${l}`);
});

test('phrasebook: every phrase reviewed in all 12 languages; exact lookup works both ways', () => {
  for (const [id, row] of Object.entries(PHRASEBOOK)) for (const l of BUILTIN_LANGS) assert.ok(row[l], `${id}.${l}`);
  assert.equal(phrasebookLookup('please wait a moment', 'en', 'hi').text, 'कृपया एक पल रुकिए।');
  assert.equal(phrasebookLookup('कृपया एक पल रुकिए', 'hi', 'en').text, 'Please wait a moment.');
  assert.equal(phrasebookLookup('something else entirely', 'en', 'hi'), null);
});

test('client UI strings: every language has every key and placeholders match', () => {
  const S = clientI18n.STRINGS;
  const enKeys = Object.keys(S.en);
  assert.ok(enKeys.length > 80);
  const ph = v => (v.match(/\{\w+\}/g) ?? []).sort().join();
  // The 12 core languages are bundled; the other languages are lazy-loaded packs, checked in langpacks.test.js.
  for (const l of BUILTIN_LANGS.filter(code => !LANGUAGE_META.find(m => m.code === code)?.base && S[code])) {
    assert.ok(S[l], `UI language ${l}`);
    for (const k of enKeys) {
      assert.ok(typeof S[l][k] === 'string' && S[l][k].length, `${l}.${k} missing`);
      assert.equal(ph(S[l][k]), ph(S.en[k]), `${l}.${k} placeholders`);
    }
    assert.deepEqual(Object.keys(S[l]).filter(k => !(k in S.en)), [], `${l} has unknown keys`);
  }
});

test('every seeded FAQ has English, Hindi and Arabic text and a recognition keyword list', () => {
  for (const f of FAQS) {
    for (const l of ['en', 'hi', 'ar']) assert.ok(f.tr[l]?.[0] && f.tr[l]?.[1], `${f.tr.en[0]} ${l}`);
    assert.ok(f.keywords.split(',').length >= 3);
  }
});

test('templates render singular minutes correctly', () => {
  assert.match(t('en', 'route', { to: 'X', minutes: 1, meters: 50 }), /1 minute’s walk/);
  assert.match(t('en', 'route', { to: 'X', minutes: 2, meters: 50 }), /2 minutes’ walk/);
  assert.match(t('de', 'route', { to: 'X', minutes: 1, meters: 50 }), /1 Minute zu Fuß/);
});
