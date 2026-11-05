import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { repairTranscript, wordsToDigits, fuzzyHasKeyword, editDistance } from '../server/services/speechfix.js';
import { prepare, matchPlace, extractFlight, extractGate, hasIntentWord } from '../server/services/nlu.js';
import { startApp } from './helpers.js';

test('common speech-engine mishearings are repaired', () => {
  const cases = [
    ['where is the launch', 'where is the lounge'],
    ['which lounges can I use', 'which lounge can I use'],
    ['which gate is queue are five seven two', 'which gate is QR 572'],
    ['cure five seven two', 'QR 572'],
    ['get see nine', 'gate C 9'],
    ['great bee twelve', 'gate B 12'],
    ['gate dee four', 'gate D 4'],
    ['Q R 5 7 2', 'QR 572'],
    ['where is the player room', 'where is the prayer room'],
    ['toy let please', 'toilet please'],
    ['is there free why fi', 'is there free wifi'],
    ['fight number QR 572', 'flight number QR 572'],
    ['Qatar five seven two', 'QR 572'],
  ];
  for (const [heard, fixed] of cases) assert.equal(repairTranscript(heard), fixed, heard);
});

test('ordinary speech is not changed', () => {
  for (const s of ['I have two bags', 'where can I have lunch', 'I want to go to the hotel', 'is it far', 'one moment please', 'क्या यहाँ वाई-फ़ाई है?', 'أين أقرب دورة مياه؟']) {
    assert.equal(repairTranscript(s), s, s);
  }
});

test('spoken numbers become digits', () => {
  assert.equal(wordsToDigits(['five', 'seven', 'two']), '572');
  assert.equal(wordsToDigits(['five', 'seventy', 'two']), '572');
  assert.equal(wordsToDigits(['five', 'hundred', 'seventy', 'two']), '572');
  assert.equal(wordsToDigits(['twelve', 'thirty', 'four']), '1234');
  assert.equal(wordsToDigits(['double', 'one']), '11');
  assert.equal(wordsToDigits(['eight']), '8');
  assert.equal(extractFlight(prepare('my flight is QR five seven two')), 'QR572');
  assert.equal(extractGate(prepare('take me to gate see fourteen')), 'C14');
});

test('small spelling and recognition errors are tolerated', () => {
  assert.equal(editDistance('lounje', 'lounge'), 1);
  assert.ok(fuzzyHasKeyword('where is the lounje', 'lounge'));
  assert.ok(!fuzzyHasKeyword('longer queue', 'lounge'));
  assert.equal(matchPlace(prepare('wheres the toilett'), 'en'), 'toilet');
  assert.equal(matchPlace(prepare('any restaurent nearby'), 'en'), 'food');
  assert.equal(matchPlace(prepare('where can I have lunch'), 'en'), 'food', '"lunch" is food, not lounge');
  assert.ok(hasIntentWord(prepare('show me the launch'), 'lounge', 'en'));
});

let A;
before(async () => { A = await startApp(); });
after(async () => { await A.close(); });

test('"launch" is understood as lounge, and the app says what it understood', async () => {
  const r = (await A.post('/api/assistant/chat', { message: 'where is the launch', lang: 'en' })).json;
  assert.equal(r.intent, 'lounge');
  assert.equal(r.heard, 'where is the lounge');
});

test('the best of the speech engine guesses is used', async () => {
  const r = (await A.post('/api/assistant/chat', { message: 'which great is cure five seven to', alternatives: ['which gate is QR 572', 'which gate is cure'], lang: 'en' })).json;
  assert.equal(r.intent, 'flight_gate');
  assert.match(r.text, /C9/);
  const plain = (await A.post('/api/assistant/chat', { message: 'is there free wifi', alternatives: ['is there free Wi-Fi'], lang: 'en' })).json;
  assert.equal(plain.heard, undefined, 'nothing to report when understood as typed');
  assert.equal((await A.post('/api/assistant/chat', { message: 'x', alternatives: 'not-an-array', lang: 'en' })).status, 200);
});
