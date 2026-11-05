import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, startMock, llmReply, connectIntegration, DEMO } from './helpers.js';
import { groundedCheck } from '../server/services/assistant.js';
import { stripThinking } from '../server/services/llm.js';

let A;
before(async () => { A = await startApp(); });
after(async () => { await A.close(); });

const chat = (message, lang = 'en', extra = {}) => A.post('/api/assistant/chat', { message, lang, ...extra }).then(r => { assert.equal(r.status, 200, r.text); return r.json; });

describe('Hindi-speaking passenger asks for the gate for QR 572 (demo scenario)', () => {
  test('answers in Hindi with the SIMULATED gate, walking time and a simulated-data warning', async () => {
    const r = await chat('QR 572 का गेट कौन सा है?', 'hi');
    assert.equal(r.lang, 'hi');
    assert.equal(r.intent, 'flight_gate');
    assert.equal(r.speech, 'hi-IN');
    assert.match(r.text, /गेट C9/);
    assert.match(r.text, /सिम्युलेटेड/, 'spoken text itself states the data is simulated');
    assert.match(r.text, /मिनट/);
    const card = r.cards.find(c => c.type === 'flight');
    assert.equal(card.flight.flightNo, 'QR572');
    assert.equal(card.flight.simulated, true);
    assert.equal(card.source, 'simulated');
    assert.ok(card.route.minutes > 0 && card.route.path.at(-1) === 'GATE_C9');
    assert.ok(r.notices.some(n => n.kind === 'simulated_flight'));
  });
  test('works when spoken with transliterated airline and Devanagari digits', async () => {
    const r = await chat('क्यू आर ५७२ का गेट कौन सा है', 'en');
    assert.equal(r.lang, 'hi');
    assert.match(r.text, /C9/);
  });
  test('works even if the passenger selected English but speaks Hindi', async () => {
    const r = await chat('मेरी फ्लाइट QR572 है, गेट बताइए', 'en');
    assert.equal(r.lang, 'hi');
    assert.equal(r.intent, 'flight_gate');
  });
});

test('flight answers in every built-in language contain the gate and a simulated warning', async () => {
  const q = { en: 'Which gate for QR 572?', ar: 'ما هي بوابة الرحلة QR 572؟', hi: 'QR 572 का गेट', ur: 'QR 572 کا گیٹ کون سا ہے', bn: 'QR 572 এর গেট কোনটি', ml: 'QR 572 ഗേറ്റ് ഏതാണ്',
    tl: 'Anong gate ang QR 572?', zh: 'QR 572 在哪个登机口', fr: 'Quelle porte pour QR 572 ?', es: '¿Qué puerta tiene QR 572?', ru: 'Какой выход у QR 572?', de: 'Welches Gate hat QR 572?' };
  const simWord = { en: /SIMULATED/, ar: /محاكاة/, hi: /सिम्युलेटेड/, ur: /سمیولیٹڈ/, bn: /সিমুলেটেড/, ml: /സിമുലേറ്റഡ്/, tl: /SIMULATED/, zh: /模拟/, fr: /SIMULÉES/, es: /SIMULADOS/, ru: /СИМУЛИРОВАННЫЕ/, de: /SIMULIERTE/ };
  for (const [lang, text] of Object.entries(q)) {
    const r = await chat(text, lang);
    assert.equal(r.lang, lang, `${lang} reply language`);
    assert.match(r.text, /C9/, `${lang} contains gate`);
    assert.match(r.text, simWord[lang], `${lang} states simulated`);
    assert.ok(!/\{\w+\}/.test(r.text), `${lang} has no unfilled placeholders: ${r.text}`);
  }
});

test('flight without an assigned gate never invents one', async () => {
  const r = await chat('QR858', 'en');
  assert.equal(r.intent, 'flight_gate');
  assert.match(r.text, /not been assigned/);
  assert.equal(r.cards[0].flight.gate, null);
  assert.ok(!/\b[A-E]\d{1,2}\b/.test(r.text.replace('QR 858', '')));
});

test('unknown flight → not found, no fabricated details', async () => {
  const r = await chat('Where is flight QR 9999?', 'en');
  assert.equal(r.intent, 'flight_not_found');
  assert.equal(r.cards.length, 0);
});

test('places: nearest prayer room / toilet with a route, in several languages', async () => {
  for (const [msg, lang, type] of [['Nearest prayer room', 'en', 'prayer'], ['أين أقرب دورة مياه؟', 'ar', 'toilet'], ['सबसे नज़दीकी शौचालय कहाँ है', 'hi', 'toilet'], ['où puis-je prier ?', 'fr', 'prayer']]) {
    const r = await chat(msg, lang);
    assert.equal(r.intent, `place_${type}`, msg);
    const route = r.cards.find(c => c.type === 'route');
    assert.ok(route, msg);
    assert.ok(route.to.startsWith(type.toUpperCase()), `${msg} → ${route.to}`);
  }
});

test('route from the passenger location changes the answer', async () => {
  const a = await chat('gate A1', 'en', { from: 'TRANSFER_A' });
  const b = await chat('gate A1', 'en', { from: 'GATE_E8' });
  assert.ok(a.cards[0].route.meters < b.cards[0].route.meters);
});

test('FAQ answers come from approved content (Wi-Fi, gate closing, transfers)', async () => {
  const wifi = await chat('Is there free wifi?');
  assert.equal(wifi.intent, 'faq');
  assert.match(wifi.text, /Complimentary wireless internet/);
  const close = await chat('When does the boarding gate close?');
  assert.match(close.text, /20 minutes/);
  const hiWifi = await chat('क्या यहाँ वाई-फ़ाई है?', 'hi');
  assert.equal(hiWifi.lang, 'hi');
  assert.match(hiWifi.text, /वायरलेस इंटरनेट/);
});

test('lounge question returns nearest lounges flagged as simulated with verification notice', async () => {
  const r = await chat('Which lounge can I use?');
  assert.equal(r.intent, 'lounge');
  const list = r.cards.find(c => c.type === 'lounges');
  assert.ok(list.items.length > 0);
  assert.ok(list.items.every(l => l.simulated === true));
  assert.match(r.text, /verified/);
});

test('greeting, staff help and graceful fallback', async () => {
  assert.equal((await chat('hello')).intent, 'greeting');
  assert.equal((await chat('مرحبا', 'ar')).intent, 'greeting');
  assert.equal((await chat('I want to talk to a human')).intent, 'staff_help');
  const fb = await chat('purple elephants dancing');
  assert.equal(fb.intent, 'fallback');
  assert.match(fb.text, /information desk/);
});

test('message length is bounded and empty messages are rejected', async () => {
  const empty = await A.post('/api/assistant/chat', { message: '   ', lang: 'en' });
  assert.equal(empty.status, 400);
  const long = await A.post('/api/assistant/chat', { message: 'x'.repeat(501), lang: 'en' });
  assert.equal(long.status, 400);
});

test('grounding guard rejects invented gates, flights and numbers', () => {
  const facts = 'Boarding gates close 20 minutes before departure. Gate C9.';
  assert.equal(groundedCheck('Gates close 20 minutes before departure.', facts).ok, true);
  assert.equal(groundedCheck('Your gate is B7.', facts).ok, false);
  assert.equal(groundedCheck('Entry costs 150 QAR.', facts).ok, false);
  assert.equal(groundedCheck('Flight EK 202 leaves soon.', facts).ok, false);
  assert.equal(groundedCheck('بوابات الصعود تغلق قبل ٢٠ دقيقة', facts).ok, true, 'Arabic-Indic digits normalised');
});

test('strips reasoning traces from open models', () => {
  assert.equal(stripThinking('<think>internal</think>Hello'), 'Hello');
  assert.equal(stripThinking('<think>unfinished'), '');
});

describe('with an AI model connected (mock OpenAI-compatible server, e.g. Ollama + Qwen)', () => {
  let mock, admin;
  let mode = 'nlu_flight';
  before(async () => {
    mock = await startMock({
      'POST /v1/chat/completions': ({ body }) => {
        const sys = body.messages[0].content;
        if (/Reply with the single word OK/.test(sys)) return llmReply('<think>test</think>OK');
        if (/You classify/.test(sys)) {
          if (mode === 'nlu_flight') return llmReply('{"intent":"flight","flight":"QR572","gate":null,"place":null}');
          if (mode === 'nlu_invent') return llmReply('{"intent":"flight","flight":"QR999","gate":"B7","place":null}');
          return llmReply('{"intent":"other","flight":null,"gate":null,"place":null}');
        }
        if (/professional airport interpreter/.test(sys)) return llmReply('Translated: ' + body.messages[1].content);
        if (mode === 'free_bad') return llmReply('Your gate is B7 and the lounge costs 200 QAR.');
        return llmReply('Hand baggage is screened before you enter the terminal; please follow security staff instructions.');
      },
    });
    admin = await A.login(...DEMO.admin);
    const r = await connectIntegration(admin, 'llm_primary', 'ollama', { baseUrl: mock.url + '/v1', model: 'qwen3:8b' });
    assert.equal(r.status, 'connected');
  });
  after(async () => { await admin.put('/api/admin/integrations/llm_primary', { provider: 'none', enabled: false }); await mock.close(); });

  test('model is used only to understand; facts still come from data', async () => {
    mode = 'nlu_flight';
    const r = await chat('uh the doha to delhi one, number 572, which door?');
    assert.equal(r.intent, 'flight_gate');
    assert.match(r.engine, /^rules\+nlu:ollama:qwen3:8b$/);
    assert.match(r.text, /C9/);
  });
  test('model cannot supply a flight number whose digits are not literally in the message', async () => {
    mode = 'nlu_flight';
    const r = await chat('uh the doha to delhi one, five seven two, which door?');
    assert.equal(r.intent, 'ask_flight', 'asks the passenger for the number instead of trusting the model');
  });
  test('model-suggested numbers not present in the message are ignored', async () => {
    mode = 'nlu_invent';
    const r = await chat('tell me something about my trip');
    assert.notEqual(r.intent, 'flight_not_found');
    assert.ok(!/B7|QR 999/.test(r.text));
  });
  test('grounded free-form answer is labelled AI-generated', async () => {
    mode = 'other';
    const r = await chat('what should I know about bags at the checkpoint thing');
    assert.equal(r.intent, 'open_question');
    assert.ok(r.notices.some(n => n.kind === 'ai_generated'));
  });
  test('ungrounded model answer is discarded in favour of the safe fallback', async () => {
    mode = 'free_bad';
    const r = await chat('random musings about doha');
    assert.equal(r.intent, 'fallback');
    assert.ok(!/B7|200 QAR/.test(r.text));
  });
});

describe('map v2 facts from the official airport pages', () => {
  test('long trips use the passenger train and say so (spoken text + card)', async () => {
    const r = await chat('gate E8', 'en', { from: 'GATE_A1' });
    assert.equal(r.intent, 'gate_route');
    assert.match(r.text, /passenger train/);
    assert.equal(r.cards[0].route.train, true);
    const hi = await chat('गेट E8', 'hi', { from: 'GATE_A1' });
    assert.match(hi.text, /पैसेंजर ट्रेन/);
  });
  test('sleep pods and gym/pool are found in the passenger language', async () => {
    const ar = await chat('أين أقرب كبسولة نوم؟', 'ar');
    assert.equal(ar.intent, 'place_sleep');
    assert.ok(ar.cards.find(c => c.type === 'route').to.startsWith('SLEEP_'));
    const hi = await chat('जिम कहाँ है?', 'hi');
    assert.equal(hi.intent, 'place_wellness');
    assert.equal(hi.cards.find(c => c.type === 'route').to, 'WELLNESS_S');
    assert.match(hi.text, /साउथ प्लाज़ा/);
  });
  test('medical emergency answer gives the official airport medical number', async () => {
    const en = await chat('I need a doctor');
    assert.equal(en.intent, 'faq');
    assert.ok(en.text.includes("+974 4010 9222"));
    const ar = await chat('أحتاج إلى طبيب', 'ar');
    assert.match(ar.text, /4010 9222/);
  });
});
