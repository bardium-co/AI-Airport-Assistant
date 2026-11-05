import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDigits, detectScript, chooseLanguage, prepare, extractFlight, extractGate, matchPlace, hasKeyword, normArabic, hasIntentWord } from '../server/services/nlu.js';

test('normalizes native digits from many scripts', () => {
  assert.equal(normalizeDigits('٥٧٢'), '572'); // Arabic-Indic
  assert.equal(normalizeDigits('۵۷۲'), '572'); // Extended (Urdu/Persian)
  assert.equal(normalizeDigits('५७२'), '572'); // Devanagari
  assert.equal(normalizeDigits('৫৭২'), '572'); // Bengali
  assert.equal(normalizeDigits('൫൭൨'), '572'); // Malayalam
  assert.equal(normalizeDigits('５７２'), '572'); // full-width
});

test('detects language from script', () => {
  assert.equal(detectScript('QR 572 का गेट कौन सा है?'), 'hi');
  assert.equal(detectScript('أين البوابة؟'), 'ar');
  assert.equal(detectScript('میرا گیٹ کہاں ہے؟'), 'ur');
  assert.equal(detectScript('আমার গেট কোথায়?'), 'bn');
  assert.equal(detectScript('എന്റെ ഗേറ്റ് എവിടെ?'), 'ml');
  assert.equal(detectScript('我的登机口在哪里'), 'zh');
  assert.equal(detectScript('Где мой выход?'), 'ru');
  assert.equal(detectScript('Where is my gate?'), null);
});

test('chooses reply language: script wins, Latin keeps selection, unknown falls back to English', () => {
  const enabled = ['en', 'hi', 'ar', 'ur', 'fr'];
  assert.equal(chooseLanguage('QR 572 का गेट', 'en', enabled), 'hi');
  assert.equal(chooseLanguage('Où est ma porte ?', 'fr', enabled), 'fr');
  assert.equal(chooseLanguage('أين', 'ur', enabled), 'ur', 'Arabic script typed while Urdu selected keeps Urdu');
  assert.equal(chooseLanguage('hello', 'xx', enabled), 'en');
  assert.equal(chooseLanguage('我的登机口', 'en', enabled), 'en', 'disabled language is not chosen');
});

test('extracts flight numbers in many forms', () => {
  const cases = [
    ['Which gate is QR 572?', 'QR572'], ['qr572 gate', 'QR572'], ['QR-572', 'QR572'], ['Q R 572', 'QR572'], ['q.r. 572', 'QR572'],
    ['क्यूआर 572 का गेट', 'QR572'], ['क्यू आर ५७२ का गेट कौन सा है', 'QR572'], ['Qatar Airways 572', 'QR572'], ['कतर एयरवेज 572', 'QR572'],
    ['رحلة القطرية ٥٧٢', 'QR572'], ['flight 6E 1234', '6E1234'], ['EK 2', 'EK2'], ['QR0572', 'QR572'], ['航班QR858', 'QR858'],
  ];
  for (const [input, expected] of cases) assert.equal(extractFlight(prepare(input)), expected, input);
});

test('does not invent flight numbers from ordinary text', () => {
  for (const s of ['I arrive at 5 pm', 'gate C14 please', 'Is there wifi?', 'Airbus A320', 'in 20 minutes', 'see you at 10', 'my pin is 1234']) {
    assert.equal(extractFlight(prepare(s)), null, s);
  }
});

test('extracts gate codes only when clearly a gate', () => {
  assert.equal(extractGate(prepare('Where is gate C14?')), 'C14');
  assert.equal(extractGate(prepare('gate c 9')), 'C9');
  assert.equal(extractGate(prepare('take me to D4')), 'D4');
  assert.equal(extractGate(prepare('गेट C9 कहाँ है')), 'C9');
  assert.equal(extractGate(prepare('البوابة A3')), 'A3');
  assert.equal(extractGate(prepare('a 5 minute walk')), null);
  assert.equal(extractGate(prepare('Airbus A320')), null);
  assert.equal(extractGate(prepare('QR 572')), null);
});

test('matches places across languages', () => {
  const cases = [
    ['Where is the nearest toilet?', 'en', 'toilet'], ['restroom', 'en', 'toilet'], ['أين أقرب دورة مياه؟', 'ar', 'toilet'], ['أين الحمام', 'ar', 'toilet'],
    ['सबसे नज़दीकी प्रार्थना कक्ष', 'hi', 'prayer'], ['नमाज़ कहाँ पढ़ें', 'hi', 'prayer'], ['نماز کہاں پڑھوں', 'ur', 'prayer'], ['নামাজের ঘর কোথায়', 'bn', 'prayer'],
    ['പ്രാർത്ഥനാ മുറി എവിടെ', 'ml', 'prayer'], ['saan ang CR?', 'tl', 'toilet'], ['洗手间在哪里', 'zh', 'toilet'], ['où sont les toilettes ?', 'fr', 'toilet'],
    ['¿dónde está el baño?', 'es', 'toilet'], ['где туалет', 'ru', 'toilet'], ['Wo ist die Toilette?', 'de', 'toilet'],
    ['I need a wheelchair', 'en', 'assistance'], ['where can I eat', 'en', 'food'], ['smoking room', 'en', 'smoking'], ['I want to sleep', 'en', 'quiet'],
  ];
  for (const [text, lang, type] of cases) assert.equal(matchPlace(prepare(text), lang), type, text);
});

test('new place types from the official facility pages: sleep pods vs free quiet rooms, gym/pool/spa', () => {
  const cases = [
    ['where are the sleep pods', 'en', 'sleep'], ['I want to sleep', 'en', 'quiet'], ['كبسولة نوم', 'ar', 'sleep'], ['睡眠舱在哪里', 'zh', 'sleep'],
    ['is there a swimming pool', 'en', 'wellness'], ['where is the gym', 'en', 'wellness'], ['I want a shower', 'en', 'wellness'],
    ['أين المسبح', 'ar', 'wellness'], ['أين يمكنني الاستحمام', 'ar', 'wellness'], ['أين الحمام', 'ar', 'toilet'],
    ['जिम कहाँ है', 'hi', 'wellness'], ['où est la piscine', 'fr', 'wellness'], ['где бассейн', 'ru', 'wellness'], ['Wo ist die Dusche?', 'de', 'wellness'],
    ['I need a spanner', 'en', null], ['carpool', 'en', null],
  ];
  for (const [text, lang, type] of cases) assert.equal(matchPlace(prepare(text), lang), type, text);
});

test('keyword matching respects word boundaries in Latin scripts', () => {
  assert.equal(hasKeyword('crew room', 'cr'), false);
  assert.equal(hasKeyword('saan ang cr', 'cr'), true);
  assert.equal(hasKeyword('restaurant', 'eat'), false);
  assert.equal(hasKeyword('can i eat here', 'eat'), true);
  assert.equal(hasKeyword('молитвенная', 'молитв'), true);
});

test('Arabic normalisation strips article, diacritics and alef variants', () => {
  assert.equal(normArabic('الصَّلاة'), 'صلاه');
  assert.equal(normArabic('أين البوابة'), 'اين بوابه');
  assert.ok(hasKeyword('اين اقرب دوره مياه', 'دورة المياه'));
});

test('intent words', () => {
  assert.ok(hasIntentWord(prepare('which gate?'), 'gate', 'en'));
  assert.ok(hasIntentWord(prepare('मेरी फ्लाइट'), 'flight', 'hi'));
  assert.ok(hasIntentWord(prepare('lounge please'), 'lounge', 'en'));
  assert.ok(!hasIntentWord(prepare('volcano'), 'flight', 'fr'), '"vol" must be a whole word');
});
