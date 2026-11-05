import { LANGUAGE_META, LANG_PACKS } from './phrases.js';
import { joinUrl } from './integrations.js';

// Reviewed counter phrases. These are always exact — no machine translation involved.
export const PHRASEBOOK = {
  welcome: { en: 'Hello, how can I help you?', ar: 'مرحباً، كيف يمكنني مساعدتك؟', hi: 'नमस्ते, बताइए, आपकी क्या मदद करूँ?', ur: 'السلام علیکم، فرمائیے، میں آپ کی کیا مدد کروں؟', bn: 'নমস্কার, আমি আপনাকে কীভাবে সাহায্য করতে পারি?', ml: 'നമസ്കാരം, ഞാൻ എങ്ങനെ സഹായിക്കണം?', tl: 'Kumusta, paano kita matutulungan?', zh: '您好，请问有什么可以帮您？', fr: 'Bonjour, comment puis-je vous aider ?', es: 'Hola, ¿en qué puedo ayudarle?', ru: 'Здравствуйте, чем я могу вам помочь?', de: 'Hallo, wie kann ich Ihnen helfen?' },
  boarding_pass: { en: 'May I see your boarding pass, please?', ar: 'هل يمكنني رؤية بطاقة الصعود من فضلك؟', hi: 'कृपया अपना बोर्डिंग पास दिखाइए।', ur: 'براہ کرم اپنا بورڈنگ پاس دکھائیں۔', bn: 'অনুগ্রহ করে আপনার বোর্ডিং পাসটি দেখাবেন?', ml: 'ദയവായി നിങ്ങളുടെ ബോർഡിംഗ് പാസ് കാണിക്കാമോ?', tl: 'Maaari ko bang makita ang iyong boarding pass?', zh: '请出示您的登机牌。', fr: "Puis-je voir votre carte d'embarquement, s'il vous plaît ?", es: '¿Me permite ver su tarjeta de embarque, por favor?', ru: 'Покажите, пожалуйста, ваш посадочный талон.', de: 'Darf ich bitte Ihre Bordkarte sehen?' },
  passport: { en: 'May I see your passport, please?', ar: 'هل يمكنني رؤية جواز سفرك من فضلك؟', hi: 'कृपया अपना पासपोर्ट दिखाइए।', ur: 'براہ کرم اپنا پاسپورٹ دکھائیں۔', bn: 'অনুগ্রহ করে আপনার পাসপোর্টটি দেখাবেন?', ml: 'ദയവായി നിങ്ങളുടെ പാസ്‌പോർട്ട് കാണിക്കാമോ?', tl: 'Maaari ko bang makita ang iyong pasaporte?', zh: '请出示您的护照。', fr: "Puis-je voir votre passeport, s'il vous plaît ?", es: '¿Me permite ver su pasaporte, por favor?', ru: 'Покажите, пожалуйста, ваш паспорт.', de: 'Darf ich bitte Ihren Reisepass sehen?' },
  membership: { en: 'Please show me your membership card or app.', ar: 'يرجى إظهار بطاقة العضوية أو التطبيق.', hi: 'कृपया अपना सदस्यता कार्ड या ऐप दिखाइए।', ur: 'براہ کرم اپنا ممبرشپ کارڈ یا ایپ دکھائیں۔', bn: 'অনুগ্রহ করে আপনার সদস্যপদ কার্ড বা অ্যাপ দেখান।', ml: 'ദയവായി നിങ്ങളുടെ അംഗത്വ കാർഡ് അല്ലെങ്കിൽ ആപ്പ് കാണിക്കുക.', tl: 'Pakipakita ang iyong membership card o app.', zh: '请出示您的会员卡或会员应用。', fr: 'Veuillez me montrer votre carte de membre ou votre application.', es: 'Por favor, muéstreme su tarjeta de socio o la aplicación.', ru: 'Покажите, пожалуйста, карту участника программы или приложение.', de: 'Bitte zeigen Sie mir Ihre Mitgliedskarte oder App.' },
  wait: { en: 'Please wait a moment.', ar: 'يرجى الانتظار لحظة.', hi: 'कृपया एक पल रुकिए।', ur: 'براہ کرم ایک لمحہ انتظار کریں۔', bn: 'অনুগ্রহ করে একটু অপেক্ষা করুন।', ml: 'ദയവായി ഒരു നിമിഷം കാത്തിരിക്കുക.', tl: 'Sandali lang po.', zh: '请稍等。', fr: 'Veuillez patienter un instant.', es: 'Espere un momento, por favor.', ru: 'Подождите, пожалуйста, минутку.', de: 'Bitte warten Sie einen Moment.' },
  checking: { en: 'I am checking this for you now.', ar: 'أتحقق من ذلك لك الآن.', hi: 'आपके लिए अभी इसकी जाँच की जा रही है।', ur: 'آپ کے لیے ابھی اس کی جانچ کی جا رہی ہے۔', bn: 'আমি এখনই আপনার জন্য এটি দেখে নিচ্ছি।', ml: 'ഞാൻ ഇപ്പോൾ നിങ്ങൾക്കായി ഇത് പരിശോധിക്കുന്നു.', tl: 'Tinitingnan ko na ito para sa iyo.', zh: '我正在为您查询。', fr: 'Je vérifie cela pour vous tout de suite.', es: 'Lo estoy comprobando para usted ahora mismo.', ru: 'Сейчас я это для вас проверю.', de: 'Ich prüfe das gerade für Sie.' },
  follow_me: { en: 'Please follow me.', ar: 'يرجى اتباعي.', hi: 'कृपया मेरे साथ आइए।', ur: 'براہ کرم میرے ساتھ آئیں۔', bn: 'অনুগ্রহ করে আমার সাথে আসুন।', ml: 'ദയവായി എന്നോടൊപ്പം വരൂ.', tl: 'Pakisundan po ako.', zh: '请跟我来。', fr: 'Veuillez me suivre.', es: 'Sígame, por favor.', ru: 'Пожалуйста, следуйте за мной.', de: 'Bitte folgen Sie mir.' },
  wheelchair: { en: 'Do you need wheelchair assistance?', ar: 'هل تحتاج إلى مساعدة بكرسي متحرك؟', hi: 'क्या आपको व्हीलचेयर सहायता चाहिए?', ur: 'کیا آپ کو وہیل چیئر کی مدد چاہیے؟', bn: 'আপনার কি হুইলচেয়ার সহায়তা প্রয়োজন?', ml: 'നിങ്ങൾക്ക് വീൽചെയർ സഹായം ആവശ്യമുണ്ടോ?', tl: 'Kailangan mo ba ng tulong sa wheelchair?', zh: '您需要轮椅协助吗？', fr: "Avez-vous besoin d'un fauteuil roulant ?", es: '¿Necesita asistencia con silla de ruedas?', ru: 'Вам нужна помощь с инвалидной коляской?', de: 'Benötigen Sie Unterstützung mit einem Rollstuhl?' },
  repeat: { en: 'Could you please repeat that?', ar: 'هل يمكنك تكرار ذلك من فضلك؟', hi: 'क्या आप कृपया फिर से बोल सकते हैं?', ur: 'کیا آپ براہ کرم دوبارہ کہہ سکتے ہیں؟', bn: 'আপনি কি অনুগ্রহ করে আবার বলবেন?', ml: 'ദയവായി ഒന്നുകൂടി പറയാമോ?', tl: 'Maaari mo bang ulitin iyon?', zh: '请您再说一遍好吗？', fr: "Pourriez-vous répéter, s'il vous plaît ?", es: '¿Podría repetirlo, por favor?', ru: 'Повторите, пожалуйста.', de: 'Könnten Sie das bitte wiederholen?' },
  speak_slowly: { en: 'Please speak slowly, close to the microphone.', ar: 'يرجى التحدث ببطء وبالقرب من الميكروفون.', hi: 'कृपया माइक्रोफ़ोन के पास धीरे-धीरे बोलिए।', ur: 'براہ کرم مائیکروفون کے قریب آہستہ بولیں۔', bn: 'অনুগ্রহ করে মাইক্রোফোনের কাছে ধীরে ধীরে কথা বলুন।', ml: 'ദയവായി മൈക്രോഫോണിനടുത്ത് പതുക്കെ സംസാരിക്കുക.', tl: 'Pakisalita nang dahan-dahan, malapit sa mikropono.', zh: '请靠近麦克风慢慢说。', fr: 'Veuillez parler lentement, près du micro.', es: 'Hable despacio y cerca del micrófono, por favor.', ru: 'Говорите, пожалуйста, медленно и ближе к микрофону.', de: 'Bitte sprechen Sie langsam und nah am Mikrofon.' },
  needs_approval: { en: 'Your request needs approval from a supervisor. Please wait.', ar: 'يحتاج طلبك إلى موافقة المشرف. يرجى الانتظار.', hi: 'आपके अनुरोध के लिए सुपरवाइज़र की मंज़ूरी ज़रूरी है। कृपया प्रतीक्षा करें।', ur: 'آپ کی درخواست کے لیے سپروائزر کی منظوری ضروری ہے۔ براہ کرم انتظار کریں۔', bn: 'আপনার অনুরোধের জন্য সুপারভাইজারের অনুমোদন প্রয়োজন। অনুগ্রহ করে অপেক্ষা করুন।', ml: 'നിങ്ങളുടെ അഭ്യർത്ഥനയ്ക്ക് സൂപ്പർവൈസറുടെ അംഗീകാരം ആവശ്യമാണ്. ദയവായി കാത്തിരിക്കുക.', tl: 'Kailangan ng pag-apruba ng supervisor ang iyong kahilingan. Pakihintay.', zh: '您的请求需要主管批准，请稍候。', fr: 'Votre demande doit être approuvée par un superviseur. Veuillez patienter.', es: 'Su solicitud necesita la aprobación de un supervisor. Espere, por favor.', ru: 'Ваш запрос должен одобрить руководитель смены. Пожалуйста, подождите.', de: 'Ihre Anfrage muss von einer Aufsichtsperson genehmigt werden. Bitte warten Sie.' },
  thank_you: { en: 'Thank you. Have a pleasant journey.', ar: 'شكراً لك. رحلة سعيدة.', hi: 'धन्यवाद। आपकी यात्रा मंगलमय हो।', ur: 'شکریہ۔ آپ کا سفر خوشگوار ہو۔', bn: 'ধন্যবাদ। আপনার যাত্রা শুভ হোক।', ml: 'നന്ദി. നിങ്ങളുടെ യാത്ര സുഖകരമാകട്ടെ.', tl: 'Salamat. Maligayang paglalakbay.', zh: '谢谢，祝您旅途愉快。', fr: 'Merci. Bon voyage.', es: 'Gracias. Que tenga un buen viaje.', ru: 'Спасибо. Приятного путешествия.', de: 'Vielen Dank. Gute Reise.' },
  yes: { en: 'Yes', ar: 'نعم', hi: 'हाँ', ur: 'جی ہاں', bn: 'হ্যাঁ', ml: 'അതെ', tl: 'Oo', zh: '是的', fr: 'Oui', es: 'Sí', ru: 'Да', de: 'Ja' },
  coming: { en: 'A staff member is on the way to you. Please stay where you are.', hi: 'एक स्टाफ़ सदस्य आपके पास आ रहा है। कृपया वहीं रहें।', ar: 'أحد الموظفين في طريقه إليك. يرجى البقاء في مكانك.', ur: 'عملے کا ایک رکن آپ کے پاس آ رہا ہے۔ براہ کرم وہیں رہیں۔', bn: 'একজন কর্মী আপনার কাছে আসছেন। অনুগ্রহ করে যেখানে আছেন সেখানেই থাকুন।', ml: 'ഒരു ജീവനക്കാരൻ നിങ്ങളുടെ അടുത്തേക്ക് വരുന്നു. ദയവായി അവിടെത്തന്നെ നിൽക്കുക.', tl: 'May staff na papunta sa iyo. Pakihintay kung nasaan ka.', zh: '工作人员正在前往您的位置，请留在原地。', fr: 'Un agent arrive vers vous. Merci de rester où vous êtes.', es: 'Un miembro del personal va hacia usted. Por favor, quédese donde está.', ru: 'Сотрудник идёт к вам. Пожалуйста, оставайтесь на месте.', de: 'Ein Mitarbeiter ist auf dem Weg zu Ihnen. Bitte bleiben Sie, wo Sie sind.' },
  go_desk: { en: 'Please go to the nearest information desk — we will help you there.', hi: 'कृपया नज़दीकी सूचना डेस्क पर जाएँ — हम वहाँ आपकी मदद करेंगे।', ar: 'يرجى التوجه إلى أقرب مكتب استعلامات — سنساعدك هناك.', ur: 'براہ کرم قریبی معلوماتی ڈیسک پر جائیں — ہم وہاں آپ کی مدد کریں گے۔', bn: 'অনুগ্রহ করে নিকটতম তথ্য ডেস্কে যান — আমরা সেখানে আপনাকে সাহায্য করব।', ml: 'ദയവായി അടുത്തുള്ള വിവര ഡെസ്കിലേക്ക് പോകുക — ഞങ്ങൾ അവിടെ സഹായിക്കും.', tl: 'Pumunta sa pinakamalapit na information desk — tutulungan ka namin doon.', zh: '请前往最近的问讯台，我们会在那里帮助您。', fr: 'Veuillez vous rendre au comptoir d\'information le plus proche — nous vous aiderons là-bas.', es: 'Diríjase al mostrador de información más cercano; allí le ayudaremos.', ru: 'Пожалуйста, подойдите к ближайшей информационной стойке — там вам помогут.', de: 'Bitte gehen Sie zum nächsten Informationsschalter – dort helfen wir Ihnen.' },
  no: { en: 'No', ar: 'لا', hi: 'नहीं', ur: 'جی نہیں', bn: 'না', ml: 'ഇല്ല', tl: 'Hindi', zh: '不是', fr: 'Non', es: 'No', ru: 'Нет', de: 'Nein' },
};

const norm = s => String(s).toLowerCase().normalize('NFC').replace(/[\s.,!?¿¡।۔。，？！:;"'’]+/g, ' ').trim();

for (const p of LANG_PACKS) {
  for (const [id, row] of Object.entries(PHRASEBOOK)) {
    const txt = p.base ? row[p.base] : p.phrasebook?.[id];
    if (txt) row[p.code] = txt;
  }
}

export function phrasebookLookup(text, from, to) {
  const n = norm(text);
  for (const [id, row] of Object.entries(PHRASEBOOK)) {
    const src = row[from];
    if (src && norm(src) === n && row[to]) return { id, text: row[to] };
  }
  return null;
}

export function langName(code) {
  return LANGUAGE_META.find(l => l.code === code)?.name ?? code;
}

export class Translator {
  constructor(integrations, llm) { this.integrations = integrations; this.llm = llm; }

  status() {
    const t = this.integrations.config('translation');
    if (t?.provider === 'libretranslate' && this.integrations.active('translation')) return 'libretranslate';
    if (t?.provider === 'llm' && t.enabled && t.authorised && this.llm.available()) return 'llm';
    return 'phrasebook';
  }

  /** Returns {text, engine, machine:boolean} — text is null if no translation was possible. */
  async translate(text, from, to) {
    const src = String(text ?? '').trim();
    if (!src) return { text: '', engine: 'none', machine: false };
    if (from === to) return { text: src, engine: 'identity', machine: false };
    const pb = phrasebookLookup(src, from, to);
    if (pb) return { text: pb.text, engine: 'phrasebook', machine: false, phraseId: pb.id };
    const mode = this.status();
    try {
      if (mode === 'libretranslate') {
        const c = this.integrations.active('translation');
        const res = await fetch(joinUrl(c.config.baseUrl, 'translate'), {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: src, source: from, target: to, format: 'text', api_key: c.config.apiKey || undefined }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) throw new Error(`LibreTranslate HTTP ${res.status}`);
        const data = await res.json();
        if (typeof data.translatedText !== 'string') throw new Error('Bad LibreTranslate response');
        return { text: data.translatedText, engine: 'libretranslate', machine: true };
      }
      if (mode === 'llm') {
        const r = await this.llm.complete([
          { role: 'system', content: `You are a professional airport interpreter. Translate the user's message from ${langName(from)} to ${langName(to)}. Output ONLY the translation — no notes, quotes or explanations. Keep flight numbers, gate codes, numbers, names and times exactly as written. Use polite, simple language.` },
          { role: 'user', content: src },
        ], { temperature: 0, maxTokens: 400 });
        if (r?.text) return { text: r.text, engine: `llm:${r.model}`, machine: true };
      }
    } catch (e) {
      return { text: null, engine: mode, machine: true, error: 'provider_error', detail: e.message };
    }
    return { text: null, engine: 'none', machine: false, error: 'not_configured' };
  }
}

export async function testLibreTranslate(cfg) {
  const res = await fetch(joinUrl(cfg.config.baseUrl, 'languages'), { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const langs = await res.json();
  return `${Array.isArray(langs) ? langs.length : '?'} languages available`;
}
