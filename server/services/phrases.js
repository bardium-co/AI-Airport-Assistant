import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

// Built-in multilingual phrase bank. These are hand-written, reviewed templates used for
// every factual answer, so the assistant never relies on a model to state gates, times or rules.
// Languages without a built-in template set fall back to English and, when a translation
// provider is configured, are machine-translated (and labelled as such).

export const BUILTIN_LANGS = ['en', 'ar', 'hi', 'ur', 'bn', 'ml', 'tl', 'zh', 'fr', 'es', 'ru', 'de'];

export const LANGUAGE_META = [
  { code: 'en', name: 'English', native: 'English', speech: 'en-GB', rtl: 0 },
  { code: 'ar', name: 'Arabic', native: 'العربية', speech: 'ar-QA', rtl: 1 },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', speech: 'hi-IN', rtl: 0 },
  { code: 'ur', name: 'Urdu', native: 'اردو', speech: 'ur-PK', rtl: 1 },
  { code: 'bn', name: 'Bengali', native: 'বাংলা', speech: 'bn-IN', rtl: 0 },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം', speech: 'ml-IN', rtl: 0 },
  { code: 'tl', name: 'Filipino', native: 'Filipino', speech: 'fil-PH', rtl: 0 },
  { code: 'zh', name: 'Chinese (Simplified)', native: '简体中文', speech: 'zh-CN', rtl: 0 },
  { code: 'fr', name: 'French', native: 'Français', speech: 'fr-FR', rtl: 0 },
  { code: 'es', name: 'Spanish', native: 'Español', speech: 'es-ES', rtl: 0 },
  { code: 'ru', name: 'Russian', native: 'Русский', speech: 'ru-RU', rtl: 0 },
  { code: 'de', name: 'German', native: 'Deutsch', speech: 'de-DE', rtl: 0 },
];

const STATUS_KEYS = ['scheduled', 'boarding', 'delayed', 'final_call', 'gate_closed', 'departed', 'cancelled'];

export const T = {
  en: {
    greeting: "Hello! I'm your Hamad International Airport assistant. Ask me about your gate, flight, lounges, directions or airport services.",
    flight_found: 'Flight {flight} to {destination} is scheduled to depart at {time} from gate {gate}. Status: {status}.',
    flight_no_gate: 'Flight {flight} to {destination} is scheduled to depart at {time}. The gate has not been assigned yet — please check the departure screens.',
    sim_note: 'Note: this is SIMULATED demo data, not live flight information. Always confirm on the airport departure screens.',
    walk: 'From {from} it is about {minutes} minutes’ walk ({meters} m).',
    gate_closes: 'Boarding gates close 20 minutes before departure.',
    no_feed: "I can't see live flight information because no authorised flight data feed is connected. Please check the departure screens, your airline app, or ask at an information desk.",
    not_found: "I couldn't find flight {flight}. Please check the flight number on your boarding pass, look at the departure screens, or ask at an information desk.",
    ask_flight: "Please tell me your flight number (for example, QR 572) and I'll find your gate.",
    route: 'Route to {to}: about {minutes} minutes’ walk ({meters} m).',
    lounge_intro: 'These lounges are nearest to you. Entry depends on your ticket and membership and is always verified at the lounge reception.',
    faq_intro: "Here's what I found:",
    fallback: "Sorry, I didn't quite understand. You can ask me about your gate, flight, lounges, directions, Wi-Fi, prayer rooms or transfers — or speak to a staff member at any information desk.",
    staff_help: 'Airport staff at any information desk can help you. Show them this screen — they can use this app to translate for you.',
    train_note: "The time includes a ride on the passenger train.",
    feed_error: "Live flight information is temporarily unavailable. Please check the departure screens or ask at an information desk.",
    place_found: 'The nearest {place} is {name}, about {minutes} minutes’ walk ({meters} m).',
    place_not_found: "I couldn't find that place on the map. Please ask at an information desk.",
    gate_route: 'Gate {gate} is about {minutes} minutes’ walk ({meters} m) from {from}.',
    status: ['Scheduled', 'Boarding', 'Delayed', 'Final call', 'Gate closed', 'Departed', 'Cancelled'],
  },
  hi: {
    greeting: 'नमस्ते! मैं हमद अंतरराष्ट्रीय हवाई अड्डे पर आपका सहायक हूँ। अपने गेट, फ़्लाइट, लाउंज, रास्ते या हवाई अड्डे की सेवाओं के बारे में पूछिए।',
    flight_found: 'फ़्लाइट {flight} ({destination} के लिए) {time} बजे गेट {gate} से रवाना होने वाली है। स्थिति: {status}।',
    flight_no_gate: 'फ़्लाइट {flight} ({destination} के लिए) {time} बजे रवाना होने वाली है। गेट अभी तय नहीं हुआ है — कृपया प्रस्थान स्क्रीन देखें।',
    sim_note: 'ध्यान दें: यह सिम्युलेटेड डेमो डेटा है, लाइव फ़्लाइट जानकारी नहीं। कृपया हवाई अड्डे की प्रस्थान स्क्रीन पर ज़रूर पुष्टि करें।',
    walk: '{from} से लगभग {minutes} मिनट का पैदल रास्ता है ({meters} मीटर)।',
    gate_closes: 'बोर्डिंग गेट प्रस्थान से 20 मिनट पहले बंद हो जाते हैं।',
    no_feed: 'मैं लाइव फ़्लाइट जानकारी नहीं देख पा रहा हूँ क्योंकि कोई अधिकृत फ़्लाइट डेटा फ़ीड जुड़ी नहीं है। कृपया प्रस्थान स्क्रीन, अपनी एयरलाइन ऐप देखें या सूचना डेस्क पर पूछें।',
    not_found: 'मुझे फ़्लाइट {flight} नहीं मिली। कृपया अपने बोर्डिंग पास पर फ़्लाइट नंबर जाँचें, प्रस्थान स्क्रीन देखें या सूचना डेस्क पर पूछें।',
    ask_flight: 'कृपया अपना फ़्लाइट नंबर बताइए (जैसे QR 572), मैं आपका गेट ढूँढ दूँगा।',
    route: '{to} तक का रास्ता: लगभग {minutes} मिनट पैदल ({meters} मीटर)।',
    lounge_intro: 'ये लाउंज आपके सबसे पास हैं। प्रवेश आपके टिकट और सदस्यता पर निर्भर करता है और लाउंज रिसेप्शन पर हमेशा सत्यापित किया जाता है।',
    faq_intro: 'मुझे यह जानकारी मिली:',
    fallback: 'माफ़ कीजिए, मैं ठीक से समझ नहीं पाया। आप अपने गेट, फ़्लाइट, लाउंज, रास्ते, वाई-फ़ाई, प्रार्थना कक्ष या ट्रांसफ़र के बारे में पूछ सकते हैं — या किसी भी सूचना डेस्क पर स्टाफ़ से बात करें।',
    staff_help: 'किसी भी सूचना डेस्क पर हवाई अड्डे का स्टाफ़ आपकी मदद कर सकता है। उन्हें यह स्क्रीन दिखाइए — वे इस ऐप से आपके लिए अनुवाद कर सकते हैं।',
    train_note: "इस समय में पैसेंजर ट्रेन की यात्रा शामिल है।",
    feed_error: "लाइव फ़्लाइट जानकारी अभी अस्थायी रूप से उपलब्ध नहीं है। कृपया डिपार्चर स्क्रीन देखें या सूचना डेस्क पर पूछें।",
    place_found: 'सबसे नज़दीकी {place}: {name}, लगभग {minutes} मिनट पैदल ({meters} मीटर)।',
    place_not_found: 'मुझे वह जगह नक्शे पर नहीं मिली। कृपया सूचना डेस्क पर पूछें।',
    gate_route: 'गेट {gate}, {from} से लगभग {minutes} मिनट पैदल ({meters} मीटर) है।',
    status: ['समय पर निर्धारित', 'बोर्डिंग जारी', 'विलंबित', 'अंतिम कॉल', 'गेट बंद', 'रवाना हो चुकी', 'रद्द'],
  },
  ar: {
    greeting: 'مرحباً! أنا مساعدك في مطار حمد الدولي. اسألني عن بوابتك أو رحلتك أو الصالات أو الاتجاهات أو خدمات المطار.',
    flight_found: 'الرحلة {flight} إلى {destination} من المقرر أن تغادر الساعة {time} من البوابة {gate}. الحالة: {status}.',
    flight_no_gate: 'الرحلة {flight} إلى {destination} من المقرر أن تغادر الساعة {time}. لم يتم تحديد البوابة بعد — يرجى مراجعة شاشات المغادرة.',
    sim_note: 'ملاحظة: هذه بيانات تجريبية محاكاة وليست معلومات رحلات مباشرة. يرجى التأكد دائماً من شاشات المغادرة في المطار.',
    walk: 'المسافة من {from} حوالي {minutes} دقيقة سيراً على الأقدام ({meters} م).',
    gate_closes: 'تُغلق بوابات الصعود قبل 20 دقيقة من موعد المغادرة.',
    no_feed: 'لا يمكنني الاطلاع على معلومات الرحلات المباشرة لعدم ربط أي مصدر بيانات رحلات معتمد. يرجى مراجعة شاشات المغادرة أو تطبيق شركة الطيران أو السؤال في مكتب الاستعلامات.',
    not_found: 'لم أتمكن من العثور على الرحلة {flight}. يرجى التحقق من رقم الرحلة في بطاقة الصعود، أو مراجعة شاشات المغادرة، أو السؤال في مكتب الاستعلامات.',
    ask_flight: 'يرجى إخباري برقم رحلتك (مثلاً QR 572) وسأجد لك البوابة.',
    route: 'الطريق إلى {to}: حوالي {minutes} دقيقة سيراً ({meters} م).',
    lounge_intro: 'هذه أقرب الصالات إليك. يعتمد الدخول على تذكرتك وعضويتك ويتم التحقق منه دائماً في استقبال الصالة.',
    faq_intro: 'إليك ما وجدته:',
    fallback: 'عذراً، لم أفهم تماماً. يمكنك سؤالي عن بوابتك أو رحلتك أو الصالات أو الاتجاهات أو الواي فاي أو غرف الصلاة أو العبور — أو التحدث إلى أحد الموظفين في أي مكتب استعلامات.',
    staff_help: 'يمكن لموظفي المطار في أي مكتب استعلامات مساعدتك. أرهم هذه الشاشة — يمكنهم استخدام هذا التطبيق للترجمة لك.',
    train_note: "يشمل هذا الوقت ركوب قطار الركاب.",
    feed_error: "معلومات الرحلات المباشرة غير متاحة مؤقتاً. يرجى مراجعة شاشات المغادرة أو السؤال في مكتب الاستعلامات.",
    place_found: 'أقرب {place}: {name}، على بعد حوالي {minutes} دقيقة سيراً ({meters} م).',
    place_not_found: 'لم أجد هذا المكان على الخريطة. يرجى السؤال في مكتب الاستعلامات.',
    gate_route: 'البوابة {gate} على بعد حوالي {minutes} دقيقة سيراً ({meters} م) من {from}.',
    status: ['مجدولة', 'الصعود جارٍ', 'متأخرة', 'النداء الأخير', 'البوابة مغلقة', 'غادرت', 'ملغاة'],
  },
  ur: {
    greeting: 'السلام علیکم! میں حمد انٹرنیشنل ایئرپورٹ پر آپ کا معاون ہوں۔ اپنے گیٹ، فلائٹ، لاؤنج، راستے یا ایئرپورٹ کی سہولیات کے بارے میں پوچھیں۔',
    flight_found: 'فلائٹ {flight} ({destination} کے لیے) {time} بجے گیٹ {gate} سے روانہ ہوگی۔ صورتحال: {status}۔',
    flight_no_gate: 'فلائٹ {flight} ({destination} کے لیے) {time} بجے روانہ ہوگی۔ گیٹ ابھی مقرر نہیں ہوا — براہ کرم روانگی کی اسکرینیں دیکھیں۔',
    sim_note: 'نوٹ: یہ مصنوعی (سمیولیٹڈ) ڈیمو ڈیٹا ہے، لائیو فلائٹ معلومات نہیں۔ براہ کرم ایئرپورٹ کی روانگی اسکرینوں پر ضرور تصدیق کریں۔',
    walk: '{from} سے تقریباً {minutes} منٹ پیدل ({meters} میٹر)۔',
    gate_closes: 'بورڈنگ گیٹ روانگی سے 20 منٹ پہلے بند ہو جاتے ہیں۔',
    no_feed: 'میں لائیو فلائٹ معلومات نہیں دیکھ سکتا کیونکہ کوئی مجاز فلائٹ ڈیٹا فیڈ منسلک نہیں ہے۔ براہ کرم روانگی کی اسکرینیں، اپنی ایئرلائن ایپ دیکھیں یا معلوماتی ڈیسک سے پوچھیں۔',
    not_found: 'مجھے فلائٹ {flight} نہیں ملی۔ براہ کرم بورڈنگ پاس پر فلائٹ نمبر چیک کریں، روانگی کی اسکرینیں دیکھیں یا معلوماتی ڈیسک سے پوچھیں۔',
    ask_flight: 'براہ کرم اپنا فلائٹ نمبر بتائیں (مثلاً QR 572)، میں آپ کا گیٹ تلاش کر دوں گا۔',
    route: '{to} تک راستہ: تقریباً {minutes} منٹ پیدل ({meters} میٹر)۔',
    lounge_intro: 'یہ لاؤنج آپ کے سب سے قریب ہیں۔ داخلہ آپ کے ٹکٹ اور رکنیت پر منحصر ہے اور ہمیشہ لاؤنج ریسیپشن پر تصدیق کیا جاتا ہے۔',
    faq_intro: 'مجھے یہ معلومات ملیں:',
    fallback: 'معذرت، میں ٹھیک سے سمجھ نہیں سکا۔ آپ اپنے گیٹ، فلائٹ، لاؤنج، راستے، وائی فائی، نماز کے کمرے یا ٹرانسفر کے بارے میں پوچھ سکتے ہیں — یا کسی بھی معلوماتی ڈیسک پر عملے سے بات کریں۔',
    staff_help: 'کسی بھی معلوماتی ڈیسک پر ایئرپورٹ کا عملہ آپ کی مدد کر سکتا ہے۔ انہیں یہ اسکرین دکھائیں — وہ اس ایپ کے ذریعے آپ کے لیے ترجمہ کر سکتے ہیں۔',
    train_note: "اس وقت میں مسافر ٹرین کا سفر شامل ہے۔",
    feed_error: "لائیو فلائٹ معلومات عارضی طور پر دستیاب نہیں۔ براہ کرم ڈیپارچر اسکرینیں دیکھیں یا معلوماتی ڈیسک پر پوچھیں۔",
    place_found: 'قریب ترین {place}: {name}، تقریباً {minutes} منٹ پیدل ({meters} میٹر)۔',
    place_not_found: 'مجھے یہ جگہ نقشے پر نہیں ملی۔ براہ کرم معلوماتی ڈیسک سے پوچھیں۔',
    gate_route: 'گیٹ {gate}، {from} سے تقریباً {minutes} منٹ پیدل ({meters} میٹر) ہے۔',
    status: ['شیڈول کے مطابق', 'بورڈنگ جاری', 'تاخیر کا شکار', 'آخری کال', 'گیٹ بند', 'روانہ ہو چکی', 'منسوخ'],
  },
  bn: {
    greeting: 'নমস্কার! আমি হামাদ আন্তর্জাতিক বিমানবন্দরে আপনার সহকারী। আপনার গেট, ফ্লাইট, লাউঞ্জ, পথনির্দেশ বা বিমানবন্দরের পরিষেবা সম্পর্কে জিজ্ঞাসা করুন।',
    flight_found: 'ফ্লাইট {flight} ({destination} গামী) {time}-এ গেট {gate} থেকে ছাড়ার কথা। অবস্থা: {status}।',
    flight_no_gate: 'ফ্লাইট {flight} ({destination} গামী) {time}-এ ছাড়ার কথা। গেট এখনও নির্ধারিত হয়নি — অনুগ্রহ করে প্রস্থান স্ক্রিন দেখুন।',
    sim_note: 'দ্রষ্টব্য: এটি সিমুলেটেড ডেমো ডেটা, লাইভ ফ্লাইট তথ্য নয়। অনুগ্রহ করে বিমানবন্দরের প্রস্থান স্ক্রিনে নিশ্চিত হয়ে নিন।',
    walk: '{from} থেকে প্রায় {minutes} মিনিটের হাঁটা পথ ({meters} মিটার)।',
    gate_closes: 'বোর্ডিং গেট প্রস্থানের 20 মিনিট আগে বন্ধ হয়ে যায়।',
    no_feed: 'কোনো অনুমোদিত ফ্লাইট ডেটা ফিড সংযুক্ত না থাকায় আমি লাইভ ফ্লাইট তথ্য দেখতে পাচ্ছি না। অনুগ্রহ করে প্রস্থান স্ক্রিন, আপনার এয়ারলাইনের অ্যাপ দেখুন বা তথ্য ডেস্কে জিজ্ঞাসা করুন।',
    not_found: 'আমি ফ্লাইট {flight} খুঁজে পাইনি। অনুগ্রহ করে বোর্ডিং পাসে ফ্লাইট নম্বর যাচাই করুন, প্রস্থান স্ক্রিন দেখুন বা তথ্য ডেস্কে জিজ্ঞাসা করুন।',
    ask_flight: 'অনুগ্রহ করে আপনার ফ্লাইট নম্বর বলুন (যেমন QR 572), আমি আপনার গেট খুঁজে দেব।',
    route: '{to} পর্যন্ত পথ: প্রায় {minutes} মিনিট হাঁটা ({meters} মিটার)।',
    lounge_intro: 'এই লাউঞ্জগুলো আপনার সবচেয়ে কাছে। প্রবেশাধিকার আপনার টিকিট ও সদস্যপদের উপর নির্ভর করে এবং সবসময় লাউঞ্জ রিসেপশনে যাচাই করা হয়।',
    faq_intro: 'আমি যা পেয়েছি:',
    fallback: 'দুঃখিত, আমি ঠিক বুঝতে পারিনি। আপনি গেট, ফ্লাইট, লাউঞ্জ, পথনির্দেশ, ওয়াই-ফাই, নামাজের ঘর বা ট্রান্সফার সম্পর্কে জিজ্ঞাসা করতে পারেন — অথবা যেকোনো তথ্য ডেস্কে কর্মীদের সাথে কথা বলুন।',
    staff_help: 'যেকোনো তথ্য ডেস্কে বিমানবন্দরের কর্মীরা আপনাকে সাহায্য করতে পারবেন। তাঁদের এই স্ক্রিনটি দেখান — তাঁরা এই অ্যাপ দিয়ে আপনার জন্য অনুবাদ করতে পারবেন।',
    train_note: "এই সময়ের মধ্যে যাত্রী ট্রেনে যাত্রা অন্তর্ভুক্ত।",
    feed_error: "লাইভ ফ্লাইটের তথ্য সাময়িকভাবে পাওয়া যাচ্ছে না। অনুগ্রহ করে ডিপারচার স্ক্রিন দেখুন বা তথ্য ডেস্কে জিজ্ঞাসা করুন।",
    place_found: 'নিকটতম {place}: {name}, প্রায় {minutes} মিনিট হাঁটা ({meters} মিটার)।',
    place_not_found: 'আমি মানচিত্রে জায়গাটি খুঁজে পাইনি। অনুগ্রহ করে তথ্য ডেস্কে জিজ্ঞাসা করুন।',
    gate_route: 'গেট {gate}, {from} থেকে প্রায় {minutes} মিনিট হাঁটা পথ ({meters} মিটার)।',
    status: ['নির্ধারিত', 'বোর্ডিং চলছে', 'বিলম্বিত', 'শেষ ডাক', 'গেট বন্ধ', 'ছেড়ে গেছে', 'বাতিল'],
  },
  ml: {
    greeting: 'നമസ്കാരം! ഞാൻ ഹമദ് അന്താരാഷ്ട്ര വിമാനത്താവളത്തിലെ നിങ്ങളുടെ സഹായിയാണ്. നിങ്ങളുടെ ഗേറ്റ്, ഫ്ലൈറ്റ്, ലൗഞ്ച്, വഴി, വിമാനത്താവള സേവനങ്ങൾ എന്നിവയെക്കുറിച്ച് ചോദിക്കൂ.',
    flight_found: '{destination}-ലേക്കുള്ള ഫ്ലൈറ്റ് {flight} {time}-ന് ഗേറ്റ് {gate}-ൽ നിന്ന് പുറപ്പെടും. നില: {status}.',
    flight_no_gate: '{destination}-ലേക്കുള്ള ഫ്ലൈറ്റ് {flight} {time}-ന് പുറപ്പെടും. ഗേറ്റ് ഇതുവരെ നിശ്ചയിച്ചിട്ടില്ല — ദയവായി പുറപ്പെടൽ സ്ക്രീനുകൾ നോക്കുക.',
    sim_note: 'ശ്രദ്ധിക്കുക: ഇത് സിമുലേറ്റഡ് ഡെമോ ഡാറ്റയാണ്, തത്സമയ ഫ്ലൈറ്റ് വിവരമല്ല. ദയവായി വിമാനത്താവളത്തിലെ പുറപ്പെടൽ സ്ക്രീനുകളിൽ ഉറപ്പാക്കുക.',
    walk: '{from}-ൽ നിന്ന് ഏകദേശം {minutes} മിനിറ്റ് നടക്കണം ({meters} മീ).',
    gate_closes: 'പുറപ്പെടുന്നതിന് 20 മിനിറ്റ് മുമ്പ് ബോർഡിംഗ് ഗേറ്റുകൾ അടയ്ക്കും.',
    no_feed: 'അംഗീകൃത ഫ്ലൈറ്റ് ഡാറ്റ ഫീഡ് ബന്ധിപ്പിച്ചിട്ടില്ലാത്തതിനാൽ എനിക്ക് തത്സമയ ഫ്ലൈറ്റ് വിവരങ്ങൾ കാണാൻ കഴിയില്ല. ദയവായി പുറപ്പെടൽ സ്ക്രീനുകൾ, നിങ്ങളുടെ എയർലൈൻ ആപ്പ് പരിശോധിക്കുക അല്ലെങ്കിൽ വിവര ഡെസ്കിൽ ചോദിക്കുക.',
    not_found: 'ഫ്ലൈറ്റ് {flight} കണ്ടെത്താനായില്ല. ബോർഡിംഗ് പാസിലെ ഫ്ലൈറ്റ് നമ്പർ പരിശോധിക്കുക, പുറപ്പെടൽ സ്ക്രീനുകൾ നോക്കുക, അല്ലെങ്കിൽ വിവര ഡെസ്കിൽ ചോദിക്കുക.',
    ask_flight: 'ദയവായി നിങ്ങളുടെ ഫ്ലൈറ്റ് നമ്പർ പറയൂ (ഉദാ: QR 572), ഞാൻ നിങ്ങളുടെ ഗേറ്റ് കണ്ടെത്താം.',
    route: '{to}-ലേക്കുള്ള വഴി: ഏകദേശം {minutes} മിനിറ്റ് നടത്തം ({meters} മീ).',
    lounge_intro: 'ഈ ലൗഞ്ചുകളാണ് നിങ്ങൾക്ക് ഏറ്റവും അടുത്തുള്ളത്. പ്രവേശനം നിങ്ങളുടെ ടിക്കറ്റിനെയും അംഗത്വത്തെയും ആശ്രയിച്ചിരിക്കുന്നു, എപ്പോഴും ലൗഞ്ച് റിസപ്ഷനിൽ പരിശോധിക്കും.',
    faq_intro: 'ഞാൻ കണ്ടെത്തിയത്:',
    fallback: 'ക്ഷമിക്കണം, എനിക്ക് ശരിയായി മനസ്സിലായില്ല. ഗേറ്റ്, ഫ്ലൈറ്റ്, ലൗഞ്ച്, വഴി, വൈ-ഫൈ, പ്രാർത്ഥനാ മുറി, ട്രാൻസ്ഫർ എന്നിവയെക്കുറിച്ച് ചോദിക്കാം — അല്ലെങ്കിൽ ഏതെങ്കിലും വിവര ഡെസ്കിലെ ജീവനക്കാരോട് സംസാരിക്കാം.',
    staff_help: 'ഏതൊരു വിവര ഡെസ്കിലെയും വിമാനത്താവള ജീവനക്കാർക്ക് നിങ്ങളെ സഹായിക്കാനാകും. ഈ സ്ക്രീൻ അവരെ കാണിക്കൂ — അവർക്ക് ഈ ആപ്പ് ഉപയോഗിച്ച് നിങ്ങൾക്കായി വിവർത്തനം ചെയ്യാം.',
    train_note: "ഈ സമയത്തിൽ പാസഞ്ചർ ട്രെയിൻ യാത്രയും ഉൾപ്പെടുന്നു.",
    feed_error: "തത്സമയ ഫ്ലൈറ്റ് വിവരങ്ങൾ താൽക്കാലികമായി ലഭ്യമല്ല. ദയവായി ഡിപ്പാർച്ചർ സ്ക്രീനുകൾ നോക്കുക അല്ലെങ്കിൽ വിവര ഡെസ്കിൽ ചോദിക്കുക.",
    place_found: 'ഏറ്റവും അടുത്തുള്ള {place}: {name}, ഏകദേശം {minutes} മിനിറ്റ് നടത്തം ({meters} മീ).',
    place_not_found: 'ആ സ്ഥലം മാപ്പിൽ കണ്ടെത്താനായില്ല. ദയവായി വിവര ഡെസ്കിൽ ചോദിക്കുക.',
    gate_route: 'ഗേറ്റ് {gate}, {from}-ൽ നിന്ന് ഏകദേശം {minutes} മിനിറ്റ് നടത്തം ({meters} മീ).',
    status: ['ഷെഡ്യൂൾ ചെയ്തത്', 'ബോർഡിംഗ് നടക്കുന്നു', 'വൈകുന്നു', 'അവസാന വിളി', 'ഗേറ്റ് അടച്ചു', 'പുറപ്പെട്ടു', 'റദ്ദാക്കി'],
  },
  tl: {
    greeting: 'Kumusta! Ako ang iyong katulong sa Hamad International Airport. Magtanong tungkol sa iyong gate, flight, lounge, direksyon o mga serbisyo ng paliparan.',
    flight_found: 'Ang flight {flight} papuntang {destination} ay nakatakdang umalis nang {time} mula sa gate {gate}. Status: {status}.',
    flight_no_gate: 'Ang flight {flight} papuntang {destination} ay nakatakdang umalis nang {time}. Wala pang nakatalagang gate — pakitingnan ang mga departure screen.',
    sim_note: 'Paalala: ito ay SIMULATED na demo data, hindi live na impormasyon ng flight. Pakikumpirma palagi sa mga departure screen ng paliparan.',
    walk: 'Mula sa {from}, mga {minutes} minutong lakad ({meters} m).',
    gate_closes: 'Nagsasara ang mga boarding gate 20 minuto bago ang pag-alis.',
    no_feed: 'Hindi ko makita ang live na impormasyon ng flight dahil walang nakakonektang awtorisadong flight data feed. Pakitingnan ang mga departure screen, ang app ng iyong airline, o magtanong sa information desk.',
    not_found: 'Hindi ko mahanap ang flight {flight}. Pakisuri ang numero ng flight sa iyong boarding pass, tingnan ang mga departure screen, o magtanong sa information desk.',
    ask_flight: 'Pakisabi ang numero ng iyong flight (halimbawa, QR 572) at hahanapin ko ang iyong gate.',
    route: 'Daan papunta sa {to}: mga {minutes} minutong lakad ({meters} m).',
    lounge_intro: 'Ito ang mga lounge na pinakamalapit sa iyo. Nakadepende ang pagpasok sa iyong tiket at membership at palaging bine-verify sa reception ng lounge.',
    faq_intro: 'Ito ang nahanap ko:',
    fallback: 'Paumanhin, hindi ko lubos na naintindihan. Maaari kang magtanong tungkol sa iyong gate, flight, lounge, direksyon, Wi-Fi, prayer room o transfer — o makipag-usap sa staff sa anumang information desk.',
    staff_help: 'Matutulungan ka ng staff ng paliparan sa anumang information desk. Ipakita sa kanila ang screen na ito — magagamit nila ang app na ito para magsalin para sa iyo.',
    train_note: "Kasama sa oras na ito ang pagsakay sa passenger train.",
    feed_error: "Pansamantalang hindi available ang live na impormasyon ng flight. Tingnan ang mga departure screen o magtanong sa information desk.",
    place_found: 'Ang pinakamalapit na {place} ay {name}, mga {minutes} minutong lakad ({meters} m).',
    place_not_found: 'Hindi ko mahanap ang lugar na iyon sa mapa. Pakitanong sa information desk.',
    gate_route: 'Ang gate {gate} ay mga {minutes} minutong lakad ({meters} m) mula sa {from}.',
    status: ['Nakatakda', 'Nagbo-boarding', 'Naantala', 'Huling tawag', 'Sarado na ang gate', 'Nakaalis na', 'Kinansela'],
  },
  zh: {
    greeting: '您好！我是您在哈马德国际机场的智能助手。您可以询问登机口、航班、休息室、路线或机场服务。',
    flight_found: '飞往{destination}的航班 {flight} 计划于 {time} 从 {gate} 登机口出发。状态：{status}。',
    flight_no_gate: '飞往{destination}的航班 {flight} 计划于 {time} 出发。登机口尚未分配，请留意离港显示屏。',
    sim_note: '注意：这是模拟演示数据，并非实时航班信息。请务必以机场离港显示屏为准。',
    walk: '从{from}步行约 {minutes} 分钟（{meters} 米）。',
    gate_closes: '登机口在起飞前 20 分钟关闭。',
    no_feed: '由于未连接经授权的航班数据源，我无法查看实时航班信息。请查看离港显示屏、航空公司应用，或咨询问讯台。',
    not_found: '未找到航班 {flight}。请核对登机牌上的航班号、查看离港显示屏，或咨询问讯台。',
    ask_flight: '请告诉我您的航班号（例如 QR 572），我来帮您查找登机口。',
    route: '前往{to}的路线：步行约 {minutes} 分钟（{meters} 米）。',
    lounge_intro: '以下是离您最近的休息室。能否进入取决于您的机票和会员资格，并始终由休息室前台核实。',
    faq_intro: '我找到了以下信息：',
    fallback: '抱歉，我没有完全理解。您可以询问登机口、航班、休息室、路线、Wi-Fi、祈祷室或中转信息，也可以到任意问讯台咨询工作人员。',
    staff_help: '任意问讯台的机场工作人员都可以帮助您。请向他们出示此屏幕，他们可以用本应用为您翻译。',
    train_note: "该时间包含乘坐旅客列车。",
    feed_error: "实时航班信息暂时无法获取。请查看出发航班显示屏或咨询问讯台。",
    place_found: '最近的{place}：{name}，步行约 {minutes} 分钟（{meters} 米）。',
    place_not_found: '地图上没有找到该地点。请咨询问讯台。',
    gate_route: '{gate} 登机口距{from}步行约 {minutes} 分钟（{meters} 米）。',
    status: ['计划中', '正在登机', '延误', '最后召集', '登机口已关闭', '已起飞', '已取消'],
  },
  fr: {
    greeting: "Bonjour ! Je suis votre assistant à l'aéroport international Hamad. Posez-moi vos questions sur votre porte, votre vol, les salons, les itinéraires ou les services de l'aéroport.",
    flight_found: 'Le vol {flight} à destination de {destination} doit partir à {time} de la porte {gate}. Statut : {status}.',
    flight_no_gate: "Le vol {flight} à destination de {destination} doit partir à {time}. La porte n'est pas encore attribuée — veuillez consulter les écrans des départs.",
    sim_note: "Remarque : il s'agit de données de démonstration SIMULÉES, et non d'informations de vol en temps réel. Vérifiez toujours sur les écrans des départs de l'aéroport.",
    walk: 'Depuis {from}, environ {minutes} minutes à pied ({meters} m).',
    gate_closes: "Les portes d'embarquement ferment 20 minutes avant le départ.",
    no_feed: "Je ne peux pas consulter les informations de vol en temps réel, car aucun flux de données de vol autorisé n'est connecté. Veuillez consulter les écrans des départs, l'application de votre compagnie ou un comptoir d'information.",
    not_found: "Je n'ai pas trouvé le vol {flight}. Vérifiez le numéro de vol sur votre carte d'embarquement, consultez les écrans des départs ou adressez-vous à un comptoir d'information.",
    ask_flight: 'Indiquez-moi votre numéro de vol (par exemple QR 572) et je trouverai votre porte.',
    route: 'Itinéraire vers {to} : environ {minutes} minutes à pied ({meters} m).',
    lounge_intro: "Voici les salons les plus proches. L'accès dépend de votre billet et de votre statut de membre, et il est toujours vérifié à l'accueil du salon.",
    faq_intro: "Voici ce que j'ai trouvé :",
    fallback: "Désolé, je n'ai pas bien compris. Vous pouvez me demander votre porte, votre vol, les salons, un itinéraire, le Wi-Fi, les salles de prière ou les correspondances — ou vous adresser au personnel d'un comptoir d'information.",
    staff_help: "Le personnel de l'aéroport peut vous aider à n'importe quel comptoir d'information. Montrez-lui cet écran : il pourra utiliser cette application pour traduire.",
    train_note: "Ce temps inclut un trajet en train passagers.",
    feed_error: "Les informations de vol en direct sont momentanément indisponibles. Consultez les écrans des départs ou un comptoir d'information.",
    place_found: 'Le plus proche ({place}) : {name}, à environ {minutes} minutes à pied ({meters} m).',
    place_not_found: "Je n'ai pas trouvé ce lieu sur le plan. Veuillez vous adresser à un comptoir d'information.",
    gate_route: 'La porte {gate} est à environ {minutes} minutes à pied ({meters} m) depuis {from}.',
    status: ['Prévu', 'Embarquement', 'Retardé', 'Dernier appel', 'Porte fermée', 'Parti', 'Annulé'],
  },
  es: {
    greeting: '¡Hola! Soy su asistente en el Aeropuerto Internacional Hamad. Pregúnteme por su puerta, su vuelo, las salas VIP, cómo llegar o los servicios del aeropuerto.',
    flight_found: 'El vuelo {flight} con destino a {destination} tiene salida prevista a las {time} desde la puerta {gate}. Estado: {status}.',
    flight_no_gate: 'El vuelo {flight} con destino a {destination} tiene salida prevista a las {time}. Aún no tiene puerta asignada; consulte las pantallas de salidas.',
    sim_note: 'Nota: estos son datos de demostración SIMULADOS, no información de vuelos en tiempo real. Confirme siempre en las pantallas de salidas del aeropuerto.',
    walk: 'Desde {from}, unos {minutes} minutos a pie ({meters} m).',
    gate_closes: 'Las puertas de embarque cierran 20 minutos antes de la salida.',
    no_feed: 'No puedo ver información de vuelos en tiempo real porque no hay conectada ninguna fuente de datos de vuelos autorizada. Consulte las pantallas de salidas, la aplicación de su aerolínea o pregunte en un mostrador de información.',
    not_found: 'No encontré el vuelo {flight}. Compruebe el número de vuelo en su tarjeta de embarque, consulte las pantallas de salidas o pregunte en un mostrador de información.',
    ask_flight: 'Dígame su número de vuelo (por ejemplo, QR 572) y buscaré su puerta.',
    route: 'Ruta hacia {to}: unos {minutes} minutos a pie ({meters} m).',
    lounge_intro: 'Estas son las salas más cercanas. El acceso depende de su billete y su membresía, y siempre se verifica en la recepción de la sala.',
    faq_intro: 'Esto es lo que encontré:',
    fallback: 'Lo siento, no le entendí bien. Puede preguntarme por su puerta, su vuelo, las salas, cómo llegar, el Wi-Fi, las salas de oración o las conexiones, o hablar con el personal en cualquier mostrador de información.',
    staff_help: 'El personal del aeropuerto puede ayudarle en cualquier mostrador de información. Muéstreles esta pantalla: pueden usar esta aplicación para traducirle.',
    train_note: "Este tiempo incluye un trayecto en el tren de pasajeros.",
    feed_error: "La información de vuelos en directo no está disponible temporalmente. Consulte las pantallas de salidas o pregunte en un mostrador de información.",
    place_found: 'Lo más cercano ({place}): {name}, a unos {minutes} minutos a pie ({meters} m).',
    place_not_found: 'No encontré ese lugar en el mapa. Pregunte en un mostrador de información.',
    gate_route: 'La puerta {gate} está a unos {minutes} minutos a pie ({meters} m) desde {from}.',
    status: ['Programado', 'Embarcando', 'Retrasado', 'Última llamada', 'Puerta cerrada', 'Despegado', 'Cancelado'],
  },
  ru: {
    greeting: 'Здравствуйте! Я ваш помощник в международном аэропорту Хамад. Спросите меня о выходе на посадку, рейсе, бизнес-залах, маршрутах или услугах аэропорта.',
    flight_found: 'Рейс {flight} (направление: {destination}) отправляется по расписанию в {time} от выхода {gate}. Статус: {status}.',
    flight_no_gate: 'Рейс {flight} (направление: {destination}) отправляется по расписанию в {time}. Выход на посадку ещё не назначен — следите за табло вылета.',
    sim_note: 'Внимание: это СИМУЛИРОВАННЫЕ демонстрационные данные, а не информация о рейсах в реальном времени. Всегда сверяйтесь с табло вылета в аэропорту.',
    walk: 'Пешком примерно {minutes} мин ({meters} м). Отправная точка: {from}.',
    gate_closes: 'Выходы на посадку закрываются за 20 минут до вылета.',
    no_feed: 'Я не вижу информацию о рейсах в реальном времени, так как авторизованный источник данных о рейсах не подключён. Проверьте табло вылета, приложение авиакомпании или обратитесь к информационной стойке.',
    not_found: 'Не удалось найти рейс {flight}. Проверьте номер рейса в посадочном талоне, посмотрите табло вылета или обратитесь к информационной стойке.',
    ask_flight: 'Назовите номер вашего рейса (например, QR 572), и я найду ваш выход на посадку.',
    route: 'Маршрут — {to}: примерно {minutes} мин пешком ({meters} м).',
    lounge_intro: 'Вот ближайшие к вам залы ожидания. Доступ зависит от вашего билета и статуса в программе лояльности и всегда проверяется на стойке зала.',
    faq_intro: 'Вот что я нашёл:',
    fallback: 'Извините, я не совсем понял. Вы можете спросить о выходе на посадку, рейсе, залах ожидания, маршруте, Wi-Fi, молельных комнатах или трансфере — или обратиться к сотрудникам на любой информационной стойке.',
    staff_help: 'Сотрудники аэропорта на любой информационной стойке помогут вам. Покажите им этот экран — они смогут переводить с помощью этого приложения.',
    train_note: "Это время включает поездку на пассажирском поезде.",
    feed_error: "Онлайн-информация о рейсах временно недоступна. Смотрите табло вылета или обратитесь к информационной стойке.",
    place_found: 'Ближайшее ({place}): {name}, примерно {minutes} мин пешком ({meters} м).',
    place_not_found: 'Не удалось найти это место на карте. Обратитесь к информационной стойке.',
    gate_route: 'Выход {gate}: примерно {minutes} мин пешком ({meters} м). Отправная точка: {from}.',
    status: ['По расписанию', 'Идёт посадка', 'Задерживается', 'Последний вызов', 'Выход закрыт', 'Вылетел', 'Отменён'],
  },
  de: {
    greeting: 'Hallo! Ich bin Ihr Assistent am Hamad International Airport. Fragen Sie mich nach Ihrem Gate, Ihrem Flug, Lounges, Wegbeschreibungen oder Flughafenservices.',
    flight_found: 'Flug {flight} nach {destination} startet planmäßig um {time} von Gate {gate}. Status: {status}.',
    flight_no_gate: 'Flug {flight} nach {destination} startet planmäßig um {time}. Das Gate ist noch nicht zugewiesen – bitte beachten Sie die Abflugmonitore.',
    sim_note: 'Hinweis: Dies sind SIMULIERTE Demodaten, keine Live-Fluginformationen. Bitte prüfen Sie immer die Abflugmonitore am Flughafen.',
    walk: 'Von {from} sind es etwa {minutes} Minuten zu Fuß ({meters} m).',
    gate_closes: 'Die Flugsteige schließen 20 Minuten vor Abflug.',
    no_feed: 'Ich kann keine Live-Fluginformationen abrufen, da kein autorisierter Flugdaten-Feed verbunden ist. Bitte prüfen Sie die Abflugmonitore, die App Ihrer Fluggesellschaft oder fragen Sie an einem Informationsschalter.',
    not_found: 'Ich konnte Flug {flight} nicht finden. Bitte prüfen Sie die Flugnummer auf Ihrer Bordkarte, die Abflugmonitore oder fragen Sie an einem Informationsschalter.',
    ask_flight: 'Nennen Sie mir bitte Ihre Flugnummer (zum Beispiel QR 572), dann finde ich Ihr Gate.',
    route: 'Weg zu {to}: etwa {minutes} Minuten zu Fuß ({meters} m).',
    lounge_intro: 'Dies sind die nächstgelegenen Lounges. Der Zugang hängt von Ihrem Ticket und Ihrem Mitgliedsstatus ab und wird immer am Lounge-Empfang geprüft.',
    faq_intro: 'Folgendes habe ich gefunden:',
    fallback: 'Entschuldigung, das habe ich nicht ganz verstanden. Sie können nach Ihrem Gate, Flug, Lounges, Wegen, WLAN, Gebetsräumen oder Transfers fragen – oder sich an das Personal an einem Informationsschalter wenden.',
    staff_help: 'Das Flughafenpersonal an jedem Informationsschalter hilft Ihnen gern. Zeigen Sie diesen Bildschirm – das Personal kann mit dieser App für Sie übersetzen.',
    train_note: "Diese Zeit beinhaltet eine Fahrt mit dem Passagierzug.",
    feed_error: "Live-Fluginformationen sind vorübergehend nicht verfügbar. Bitte prüfen Sie die Abflugmonitore oder fragen Sie am Informationsschalter.",
    place_found: 'Nächstgelegen ({place}): {name}, etwa {minutes} Minuten zu Fuß ({meters} m).',
    place_not_found: 'Diesen Ort konnte ich auf der Karte nicht finden. Bitte fragen Sie an einem Informationsschalter.',
    gate_route: 'Gate {gate} ist etwa {minutes} Minuten zu Fuß ({meters} m) von {from} entfernt.',
    status: ['Planmäßig', 'Boarding', 'Verspätet', 'Letzter Aufruf', 'Gate geschlossen', 'Gestartet', 'Annulliert'],
  },
};

// Place types: localized display name + recognition keywords.
// Keyword rules: Latin/Cyrillic keywords of <=3 chars must match a whole word; longer ones match at a word start.
export const PLACES = {
  sleep: {
    en: ['sleep pods (paid)', 'sleep pod', 'sleeping pod', 'nap pod', 'sleepover', 'sleeping cabin', 'capsule'],
    ar: ['كبسولات النوم (مدفوعة)', 'كبسولة نوم', 'كبسولات النوم', 'كبسولة النوم', 'حجرة نوم'],
    hi: ['स्लीप पॉड (सशुल्क)', 'स्लीप पॉड', 'स्लीपिंग पॉड', 'कैप्सूल'],
    ur: ['سلیپ پوڈ (ادائیگی کے ساتھ)', 'سلیپ پوڈ', 'سونے کا کیبن'],
    bn: ['স্লিপ পড (সশুল্ক)', 'স্লিপ পড', 'ঘুমানোর কেবিন'],
    ml: ['സ്ലീപ്പ് പോഡ് (പണമടച്ച്)', 'സ്ലീപ്പ് പോഡ്', 'ഉറങ്ങാനുള്ള ക്യാബിൻ'],
    tl: ['sleep pods (may bayad)', 'sleep pod', 'sleeping pod', 'nap pod'],
    zh: ['睡眠舱（收费）', '睡眠舱', '胶囊'],
    fr: ['cabines de sommeil (payantes)', 'cabine de sommeil', 'capsule'],
    es: ['cápsulas para dormir (de pago)', 'cápsula para dormir', 'cápsula'],
    ru: ['капсулы для сна (платно)', 'капсул', 'спальная капсула'],
    de: ['Schlafkabinen (kostenpflichtig)', 'schlafkabine', 'schlafkapsel', 'kapsel'],
  },
  wellness: {
    en: ['gym, pool & spa', 'gym', 'swimming pool', 'pool', 'swim', 'spa', 'massage', 'fitness', 'squash', 'golf', 'shower'],
    ar: ['النادي الصحي والمسبح', 'نادي رياضي', 'صالة رياضية', 'مسبح', 'سباحة', 'السبا', 'مساج', 'تدليك', 'استحمام'],
    hi: ['जिम, पूल और स्पा', 'जिम', 'स्विमिंग पूल', 'तैराकी', 'स्पा', 'मालिश', 'शावर', 'नहाना'],
    ur: ['جم، پول اور سپا', 'جم', 'سوئمنگ پول', 'تیراکی', 'سپا', 'مساج', 'شاور', 'نہانا'],
    bn: ['জিম, পুল ও স্পা', 'জিম', 'সুইমিং পুল', 'সাঁতার', 'স্পা', 'ম্যাসাজ', 'শাওয়ার', 'গোসল'],
    ml: ['ജിം, പൂൾ, സ്പാ', 'ജിം', 'സ്വിമ്മിംഗ് പൂൾ', 'നീന്ത', 'സ്പാ', 'മസാജ്', 'ഷവർ', 'കുളിക്ക'],
    tl: ['gym, pool at spa', 'gym', 'swimming pool', 'pool', 'langoy', 'spa', 'masahe', 'shower', 'maligo'],
    zh: ['健身房、泳池和水疗', '健身', '游泳', '泳池', '水疗', '按摩', '淋浴', '洗澡'],
    fr: ['salle de sport, piscine et spa', 'salle de sport', 'gym', 'piscine', 'nager', 'spa', 'massage', 'douche'],
    es: ['gimnasio, piscina y spa', 'gimnasio', 'piscina', 'nadar', 'spa', 'masaje', 'ducha'],
    ru: ['спортзал, бассейн и спа', 'спортзал', 'фитнес', 'бассейн', 'плава', 'спа', 'массаж', 'душ'],
    de: ['Fitness, Pool & Spa', 'fitness', 'gym', 'schwimmbad', 'pool', 'schwimmen', 'spa', 'massage', 'dusche'],
  },
  prayer: {
    en: ['prayer room', 'prayer', 'pray', 'mosque', 'masjid', 'namaz', 'salah'],
    ar: ['غرفة الصلاة', 'صلاة', 'الصلاة', 'مصلى', 'مسجد'],
    hi: ['प्रार्थना कक्ष', 'प्रार्थना', 'नमाज़', 'नमाज', 'मस्जिद', 'पूजा'],
    ur: ['نماز کا کمرہ', 'نماز', 'مسجد', 'عبادت'],
    bn: ['নামাজের ঘর', 'নামাজ', 'প্রার্থনা', 'মসজিদ'],
    ml: ['പ്രാർത്ഥനാ മുറി', 'പ്രാർത്ഥന', 'നിസ്കാര', 'പള്ളി'],
    tl: ['prayer room', 'dasal', 'pagdarasal', 'prayer'],
    zh: ['祈祷室', '祈祷', '礼拜'],
    fr: ['salle de prière', 'prière', 'prier', 'mosquée'],
    es: ['sala de oración', 'oración', 'rezar', 'mezquita'],
    ru: ['молельная комната', 'молитв', 'молельн', 'мечеть'],
    de: ['Gebetsraum', 'gebet', 'beten', 'moschee'],
  },
  quiet: {
    en: ['quiet room', 'quiet', 'sleep', 'nap', 'relax'],
    ar: ['غرفة الهدوء', 'هدوء', 'هادئة', 'استراحة', 'نوم', 'أنام'],
    hi: ['शांत कक्ष', 'शांत', 'आराम', 'सोना', 'नींद'],
    ur: ['پرسکون کمرہ', 'پرسکون', 'آرام', 'سونا', 'نیند'],
    bn: ['নিরিবিলি কক্ষ', 'নিরিবিলি', 'বিশ্রাম', 'ঘুম'],
    ml: ['ശാന്ത മുറി', 'ശാന്ത', 'വിശ്രമ', 'ഉറങ്ങ'],
    tl: ['quiet room', 'tahimik', 'pahinga', 'matulog', 'tulog'],
    zh: ['安静休息区', '安静', '睡觉', '小睡'],
    fr: ['salle de repos', 'calme', 'repos', 'dormir', 'sieste'],
    es: ['sala de descanso', 'tranquila', 'descanso', 'descansar', 'dormir'],
    ru: ['тихая комната', 'тих', 'отдохн', 'поспать', 'сон'],
    de: ['Ruheraum', 'ruhe', 'ausruhen', 'schlafen'],
  },
  toilet: {
    en: ['toilet', 'restroom', 'bathroom', 'washroom', 'wc', 'loo', 'lavatory'],
    ar: ['دورة المياه', 'دورات المياه', 'حمام', 'الحمام', 'مرحاض'],
    hi: ['शौचालय', 'टॉयलेट', 'बाथरूम', 'वॉशरूम'],
    ur: ['بیت الخلا', 'واش روم', 'ٹوائلٹ', 'باتھ روم'],
    bn: ['শৌচাগার', 'টয়লেট', 'বাথরুম'],
    ml: ['ശുചിമുറി', 'ടോയ്‌ലറ്റ്', 'ടോയ്ലറ്റ്', 'ബാത്ത്റൂം'],
    tl: ['comfort room (CR)', 'banyo', 'cr', 'palikuran', 'comfort room', 'toilet'],
    zh: ['洗手间', '厕所', '卫生间'],
    fr: ['toilettes', 'toilette', 'wc'],
    es: ['baños', 'baño', 'aseo', 'servicios'],
    ru: ['туалет', 'уборн'],
    de: ['Toiletten', 'toilette', 'wc', 'klo'],
  },
  info: {
    en: ['information desk', 'information', 'info desk', 'help desk', 'enquiry', 'inquiry'],
    ar: ['مكتب الاستعلامات', 'استعلامات', 'الاستعلامات', 'مكتب المعلومات'],
    hi: ['सूचना डेस्क', 'सूचना', 'पूछताछ', 'हेल्प डेस्क'],
    ur: ['معلوماتی ڈیسک', 'معلوماتی', 'انفارمیشن', 'ہیلپ ڈیسک'],
    bn: ['তথ্য ডেস্ক', 'তথ্য', 'অনুসন্ধান', 'হেল্প ডেস্ক'],
    ml: ['വിവര ഡെസ്ക്', 'വിവര', 'ഇൻഫർമേഷൻ', 'ഹെൽപ്പ് ഡെസ്ക്'],
    tl: ['information desk', 'information', 'impormasyon'],
    zh: ['问讯台', '问讯', '咨询台', '服务台', '信息台'],
    fr: ["comptoir d'information", 'renseignement', 'accueil', 'information'],
    es: ['mostrador de información', 'información', 'informacion'],
    ru: ['информационная стойка', 'информац', 'справочн'],
    de: ['Informationsschalter', 'information', 'auskunft'],
  },
  transfer: {
    en: ['transfer desk', 'transfer', 'connection', 'connecting', 'transit'],
    ar: ['مكتب العبور', 'عبور', 'العبور', 'ترانزيت', 'رحلة متصلة', 'تحويل'],
    hi: ['ट्रांसफ़र डेस्क', 'ट्रांसफ़र', 'ट्रांसफर', 'ट्रांजिट', 'कनेक्टिंग'],
    ur: ['ٹرانسفر ڈیسک', 'ٹرانسفر', 'ٹرانزٹ', 'کنیکٹنگ'],
    bn: ['ট্রান্সফার ডেস্ক', 'ট্রান্সফার', 'ট্রানজিট', 'কানেক্টিং'],
    ml: ['ട്രാൻസ്ഫർ ഡെസ്ക്', 'ട്രാൻസ്ഫർ', 'ട്രാൻസിറ്റ്', 'കണക്ടിംഗ്'],
    tl: ['transfer desk', 'transfer', 'transit', 'connecting'],
    zh: ['中转柜台', '中转', '转机', '过境'],
    fr: ['comptoir de correspondance', 'correspondance', 'transit', 'transfert'],
    es: ['mostrador de conexiones', 'conexión', 'conexion', 'tránsito', 'transbordo'],
    ru: ['стойка трансфера', 'трансфер', 'пересадк', 'транзит', 'стыковк'],
    de: ['Transferschalter', 'transfer', 'umsteigen', 'anschluss', 'transit'],
  },
  smoking: {
    en: ['smoking room', 'smoking', 'smoke', 'cigarette'],
    ar: ['غرفة التدخين', 'تدخين', 'التدخين', 'سجائر', 'سيجارة'],
    hi: ['धूम्रपान कक्ष', 'धूम्रपान', 'सिगरेट', 'स्मोकिंग'],
    ur: ['سگریٹ نوشی کا کمرہ', 'سگریٹ', 'تمباکو نوشی', 'اسموکنگ'],
    bn: ['ধূমপান কক্ষ', 'ধূমপান', 'সিগারেট', 'স্মোকিং'],
    ml: ['പുകവലി മുറി', 'പുകവലി', 'സിഗരറ്റ്'],
    tl: ['smoking room', 'yosi', 'sigarilyo', 'manigarilyo', 'smoking'],
    zh: ['吸烟室', '吸烟', '抽烟'],
    fr: ['fumoir', 'fumer', 'cigarette'],
    es: ['sala de fumadores', 'fumar', 'fumadores', 'cigarro'],
    ru: ['курительная комната', 'курит', 'покурить', 'курени', 'сигарет'],
    de: ['Raucherraum', 'rauchen', 'raucher', 'zigarette'],
  },
  family: {
    en: ['family & play area', 'family', 'children', 'kids', 'play area', 'baby', 'nursing'],
    ar: ['منطقة العائلات', 'عائلة', 'العائلات', 'أطفال', 'الأطفال', 'منطقة لعب', 'رضاعة'],
    hi: ['पारिवारिक क्षेत्र', 'परिवार', 'बच्चों', 'बच्चे', 'खेल क्षेत्र'],
    ur: ['فیملی ایریا', 'فیملی', 'بچوں', 'بچے', 'کھیل'],
    bn: ['পরিবার এলাকা', 'পরিবার', 'শিশু', 'বাচ্চা', 'খেলার'],
    ml: ['ഫാമിലി ഏരിയ', 'കുടുംബ', 'കുട്ടി', 'ഫാമിലി'],
    tl: ['family area', 'pamilya', 'bata', 'anak', 'laruan'],
    zh: ['家庭及儿童游乐区', '家庭', '儿童', '孩子', '游乐', '母婴'],
    fr: ['espace famille', 'famille', 'enfant', 'bébé', 'jeux'],
    es: ['zona familiar', 'familia', 'niños', 'bebé', 'juegos'],
    ru: ['семейная зона', 'семей', 'детск', 'дети', 'ребён', 'ребен'],
    de: ['Familienbereich', 'familie', 'kinder', 'baby', 'spielbereich'],
  },
  hotel: {
    en: ['airport hotel', 'hotel', 'sleep pod'],
    ar: ['فندق المطار', 'فندق'],
    hi: ['एयरपोर्ट होटल', 'होटल'],
    ur: ['ایئرپورٹ ہوٹل', 'ہوٹل'],
    bn: ['বিমানবন্দর হোটেল', 'হোটেল'],
    ml: ['എയർപോർട്ട് ഹോട്ടൽ', 'ഹോട്ടൽ'],
    tl: ['airport hotel', 'hotel'],
    zh: ['机场酒店', '酒店', '宾馆'],
    fr: ["hôtel de l'aéroport", 'hôtel', 'hotel'],
    es: ['hotel del aeropuerto', 'hotel'],
    ru: ['отель аэропорта', 'отел', 'гостиниц'],
    de: ['Flughafenhotel', 'hotel'],
  },
  food: {
    en: ['food & dining', 'food', 'eat', 'restaurant', 'cafe', 'coffee', 'hungry', 'dining', 'lunch', 'dinner', 'breakfast', 'snack'],
    ar: ['المطاعم', 'مطعم', 'طعام', 'أكل', 'مقهى', 'قهوة', 'جائع'],
    hi: ['भोजन', 'खाना', 'रेस्टोरेंट', 'कॉफ़ी', 'कॉफी', 'भूख'],
    ur: ['کھانا', 'ریسٹورنٹ', 'کافی', 'بھوک'],
    bn: ['খাবার', 'রেস্তোরাঁ', 'কফি', 'খিদে'],
    ml: ['ഭക്ഷണം', 'ഭക്ഷണ', 'റസ്റ്റോറന്റ്', 'കാപ്പി', 'കോഫി', 'വിശക്കുന്നു'],
    tl: ['kainan', 'pagkain', 'kain', 'kape', 'gutom'],
    zh: ['餐饮区', '餐厅', '吃饭', '咖啡', '餐饮', '饿'],
    fr: ['restauration', 'manger', 'restaurant', 'café', 'faim'],
    es: ['restaurantes', 'comer', 'comida', 'restaurante', 'café', 'hambre'],
    ru: ['кафе и рестораны', 'еда', 'поесть', 'ресторан', 'кафе', 'кофе', 'голод'],
    de: ['Essen & Trinken', 'essen', 'restaurant', 'café', 'kaffee', 'hunger'],
  },
  assistance: {
    en: ['special assistance', 'wheelchair', 'special assistance', 'disabled', 'reduced mobility', 'accessibility'],
    ar: ['المساعدة الخاصة', 'كرسي متحرك', 'مساعدة خاصة', 'ذوي الإعاقة', 'احتياجات خاصة'],
    hi: ['विशेष सहायता', 'व्हीलचेयर', 'विशेष सहायता', 'दिव्यांग'],
    ur: ['خصوصی معاونت', 'وہیل چیئر', 'خصوصی معاونت', 'معذور'],
    bn: ['বিশেষ সহায়তা', 'হুইলচেয়ার', 'বিশেষ সহায়তা', 'প্রতিবন্ধী'],
    ml: ['പ്രത്യേക സഹായം', 'വീൽചെയർ', 'പ്രത്യേക സഹായ', 'ഭിന്നശേഷി'],
    tl: ['special assistance', 'wheelchair', 'kapansanan'],
    zh: ['特殊协助', '轮椅', '特殊协助', '无障碍', '残疾'],
    fr: ['assistance spéciale', 'fauteuil roulant', 'assistance', 'mobilité réduite', 'handicap'],
    es: ['asistencia especial', 'silla de ruedas', 'asistencia', 'movilidad reducida', 'discapacidad'],
    ru: ['особая помощь', 'инвалидн', 'коляск', 'особая помощь', 'маломобильн'],
    de: ['Sonderbetreuung', 'rollstuhl', 'assistenz', 'mobilitätseingeschränkt', 'behinderung'],
  },
};

// Localized area names: [central, south, north, concourse template]
export const AREAS = {
  en: ['ORCHARD (Central Concourse)', 'South Plaza (Lamp Bear)', 'North Node', 'Concourse {c}'],
  ar: ['الأوركارد (الردهة المركزية)', 'الساحة الجنوبية (الدب والمصباح)', 'العقدة الشمالية', 'الردهة {c}'],
  hi: ['ऑर्चर्ड (सेंट्रल कॉनकोर्स)', 'साउथ प्लाज़ा (लैम्प बेयर)', 'नॉर्थ नोड', 'कॉनकोर्स {c}'],
  ur: ['آرچرڈ (سینٹرل کانکورس)', 'ساؤتھ پلازہ (لیمپ بیئر)', 'نارتھ نوڈ', 'کانکورس {c}'],
  bn: ['অর্চার্ড (সেন্ট্রাল কনকোর্স)', 'সাউথ প্লাজা (ল্যাম্প বেয়ার)', 'নর্থ নোড', 'কনকোর্স {c}'],
  ml: ['ഓർച്ചാർഡ് (സെൻട്രൽ കോൺകോഴ്സ്)', 'സൗത്ത് പ്ലാസ (ലാമ്പ് ബെയർ)', 'നോർത്ത് നോഡ്', 'കോൺകോഴ്സ് {c}'],
  tl: ['ORCHARD (Central Concourse)', 'South Plaza (Lamp Bear)', 'North Node', 'Concourse {c}'],
  zh: ['ORCHARD 中央大厅', '南广场（台灯熊）', '北区枢纽', '{c} 区'],
  fr: ['ORCHARD (hall central)', 'place Sud (Lamp Bear)', 'pôle Nord (North Node)', 'hall {c}'],
  es: ['ORCHARD (vestíbulo central)', 'plaza Sur (Lamp Bear)', 'nodo Norte (North Node)', 'vestíbulo {c}'],
  ru: ['ORCHARD (центральный зал)', 'Южная площадь (Lamp Bear)', 'Северный узел (North Node)', 'зал {c}'],
  de: ['ORCHARD (zentrale Halle)', 'Südplaza (Lamp Bear)', 'Nordknoten (North Node)', 'Bereich {c}'],
};

export function areaName(loc, lang) {
  const a = AREAS[lang] ?? AREAS.en;
  if (loc.concourse) return a[3].replace('{c}', loc.concourse);
  if (/_S$/.test(loc.id) || /south plaza|lamp bear/i.test(loc.name)) return a[1];
  if (/_N$/.test(loc.id) || /north node|north plaza/i.test(loc.name)) return a[2];
  return a[0];
}

// Location types in the map that satisfy each place keyword group.
export const PLACE_TO_LOCATION_TYPE = {
  prayer: 'prayer', quiet: 'quiet', toilet: 'toilet', info: 'info', transfer: 'transfer',
  smoking: 'smoking', family: 'family', hotel: 'hotel', food: 'food', assistance: 'assistance',
  sleep: 'sleep', wellness: 'wellness',
};

export const INTENT_WORDS = {
  gate: {
    en: ['gate', 'boarding'], ar: ['بوابة', 'البوابة', 'بوابتي', 'الصعود'], hi: ['गेट', 'बोर्डिंग', 'द्वार'],
    ur: ['گیٹ', 'بورڈنگ'], bn: ['গেট', 'বোর্ডিং'], ml: ['ഗേറ്റ്', 'ബോർഡിംഗ്'], tl: ['gate', 'boarding', 'sakayan'],
    zh: ['登机口', '登机', '闸口'], fr: ['porte', 'embarquement'], es: ['puerta', 'embarque'],
    ru: ['выход', 'посадк', 'гейт'], de: ['gate', 'flugsteig', 'boarding'],
  },
  flight: {
    en: ['flight', 'my plane'], ar: ['رحلة', 'الرحلة', 'رحلتي', 'طيران'], hi: ['फ़्लाइट', 'फ्लाइट', 'उड़ान', 'विमान'],
    ur: ['فلائٹ', 'پرواز'], bn: ['ফ্লাইট', 'উড়ান'], ml: ['ഫ്ലൈറ്റ്', 'വിമാന'], tl: ['flight', 'lipad', 'eroplano'],
    zh: ['航班', '班机'], fr: ['vol'], es: ['vuelo'], ru: ['рейс'], de: ['flug'],
  },
  lounge: {
    en: ['lounge'], ar: ['صالة', 'الصالة', 'صالات', 'الصالات'], hi: ['लाउंज', 'विश्राम कक्ष'], ur: ['لاؤنج', 'لاونج'],
    bn: ['লাউঞ্জ'], ml: ['ലൗഞ്ച്', 'ലോഞ്ച്'], tl: ['lounge'], zh: ['休息室', '贵宾室'], fr: ['salon'],
    es: ['sala vip', 'salas vip', 'salón'], ru: ['бизнес-зал', 'зал ожидания', 'лаунж', 'зал'], de: ['lounge'],
  },
  greeting: {
    en: ['hello', 'hi', 'hey', 'good morning', 'good evening', 'good afternoon', 'salam'],
    ar: ['مرحبا', 'مرحباً', 'السلام عليكم', 'أهلا', 'أهلاً'], hi: ['नमस्ते', 'नमस्कार', 'हैलो', 'हेलो'],
    ur: ['السلام علیکم', 'ہیلو', 'آداب'], bn: ['নমস্কার', 'হ্যালো', 'আসসালামু আলাইকুম'], ml: ['നമസ്കാരം', 'ഹലോ'],
    tl: ['kumusta', 'kamusta', 'hello', 'magandang'], zh: ['你好', '您好'], fr: ['bonjour', 'salut', 'bonsoir'],
    es: ['hola', 'buenos días', 'buenas'], ru: ['здравствуй', 'привет', 'добрый'], de: ['hallo', 'guten tag', 'moin', 'servus'],
  },
  staff: {
    en: ['staff', 'human', 'agent', 'real person', 'someone'], ar: ['موظف', 'شخص', 'إنسان'], hi: ['स्टाफ़', 'स्टाफ', 'कर्मचारी', 'इंसान'],
    ur: ['عملہ', 'اسٹاف', 'ملازم'], bn: ['কর্মী', 'স্টাফ'], ml: ['ജീവനക്കാര', 'സ്റ്റാഫ്'], tl: ['staff', 'empleyado', 'tao'],
    zh: ['工作人员', '人工', '客服'], fr: ['personnel', 'agent', 'humain'], es: ['personal', 'empleado', 'humano', 'agente'],
    ru: ['сотрудник', 'человек', 'оператор'], de: ['personal', 'mitarbeiter', 'mensch'],
  },
};

// Airline names/transliterations spoken in various languages → IATA code.
export const AIRLINE_ALIASES = [
  [/qatar\s*airways|qatar\s*airline|क़तर\s*एयरवेज़?|कतर\s*एयरवेज़?|الخطوط\s*(الجوية\s*)?القطرية|القطرية|قطر\s*ایئرویز|কাতার\s*এয়ারওয়েজ|ഖത്തർ\s*എയർവേയ്സ്|卡塔尔航空|卡達航空|卡航|катарск\S*\s*авиалини\S*|カタール航空|카타르\s*항공|กาตาร์\s*แอร์เวย์|katar\s*hava\s*yollar\S*|qatar\s*havayollar\S*|הקטארית|קטאר\s*איירווייז|Κατάρ\s*Airways/giu, 'QR'],
  [/क्यू\s*-?\s*आर|क्यूआर|كيو\s*آر|کیو\s*آر|কিউ\s*-?\s*আর|ക്യു\s*-?\s*ആർ|ക്യൂ\s*ആർ|кью\s*ар|キュー\s*アール|큐\s*알|คิว\s*อาร์|קיו\s*אר/giu, 'QR'],
  [/emirates|अमीरात|एमिरेट्स|طيران\s*الإمارات|ایمریٹس|阿联酋航空/giu, 'EK'],
  [/air\s*india\s*express/giu, 'IX'],
  [/air\s*india|एयर\s*इंडिया|ایئر\s*انڈیا|এয়ার\s*ইন্ডিয়া|എയർ\s*ഇന്ത്യ/giu, 'AI'],
  [/indigo|इंडिगो|ഇൻഡിഗോ/giu, '6E'],
  [/british\s*airways/giu, 'BA'],
  [/philippine\s*airlines/giu, 'PR'],
];

export const KNOWN_AIRLINES = new Set(['QR', 'EK', 'EY', 'AI', 'IX', '6E', 'BA', 'LH', 'AF', 'KL', 'TK', 'SQ', 'CX', 'PR', '5J', 'PK', 'BG', 'UL',
  'WY', 'GF', 'KU', 'SV', 'MS', 'RJ', 'ET', 'KQ', 'CZ', 'MU', 'CA', 'JL', 'NH', 'QF', 'AA', 'UA', 'DL', 'LX', 'OS', 'AZ', 'IB', 'SU', 'G9',
  'FZ', 'J9', 'XY', 'SG', 'BS', 'MH', 'AY', 'TG', 'GA', 'VN', 'KE', 'OZ', 'NZ', 'AC', 'WS', 'S7', 'PC', 'XQ', 'W6', 'OV']);

const SINGULAR = {
  en: [[/\b1 minutes’ walk/g, '1 minute’s walk'], [/\b1 minutes\b/g, '1 minute']],
  fr: [[/\b1 minutes\b/g, '1 minute']],
  es: [[/\b1 minutos\b/g, '1 minuto']],
  de: [[/\b1 Minuten\b/g, '1 Minute']],
};

// ---------------------------------------------------------------- language packs
// Additional languages live in public/lang/<code>.json (shared with the browser). Each pack carries the full
// passenger interface ("ui"), the answer templates ("t"), place/intent keywords and the staff phrasebook.
// A pack with "base" (e.g. es-MX → es) is a regional variant that reuses its base language with its own voice.
export const PACK_DIR = new URL('../../public/lang/', import.meta.url);
// When bundled for serverless hosting the files are copied next to the bundle instead (netlify.toml: included_files).
const PACK_DIRS = [PACK_DIR, ...[process.env.LAMBDA_TASK_ROOT, process.cwd()].filter(Boolean).map(d => pathToFileURL(path.join(d, 'public', 'lang') + path.sep))];
export const LANG_PACKS = loadPacks();

function loadPacks() {
  let files = [], dir = PACK_DIR;
  for (const d of PACK_DIRS) { try { files = fs.readdirSync(d).filter(f => f.endsWith('.json')); dir = d; if (files.length) break; } catch { /* try the next place */ } }
  const packs = [];
  for (const f of files) {
    try { packs.push(JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'))); } catch (e) { console.error(`[lang] could not load ${f}: ${e.message}`); }
  }
  const full = packs.filter(p => !p.base).sort((a, b) => a.name.localeCompare(b.name));
  const variants = packs.filter(p => p.base);
  for (const p of full) {
    if (BUILTIN_LANGS.includes(p.code)) continue;
    LANGUAGE_META.push({ code: p.code, name: p.name, native: p.native, speech: p.speech, rtl: p.rtl ? 1 : 0, review: p.review ?? null });
    BUILTIN_LANGS.push(p.code);
    T[p.code] = p.t;
    for (const [type, words] of Object.entries(p.places ?? {})) if (PLACES[type]) PLACES[type][p.code] = words;
    for (const [intent, words] of Object.entries(p.intents ?? {})) if (INTENT_WORDS[intent]) INTENT_WORDS[intent][p.code] = words;
    AREAS[p.code] = [p.ui.area_central, p.ui.area_south, p.ui.area_north, p.ui.area_conc];
  }
  for (const v of variants) {
    if (!T[v.base] || BUILTIN_LANGS.includes(v.code)) continue;
    LANGUAGE_META.push({ code: v.code, name: v.name, native: v.native, speech: v.speech, rtl: LANGUAGE_META.find(l => l.code === v.base).rtl, base: v.base });
    BUILTIN_LANGS.push(v.code);
    T[v.code] = { ...T[v.base], ...(v.t ?? {}) };
    for (const g of Object.values(PLACES)) g[v.code] = g[v.base];
    for (const g of Object.values(INTENT_WORDS)) g[v.code] = g[v.base];
    AREAS[v.code] = AREAS[v.base];
  }
  return [...full, ...variants];
}

export function t(lang, key, vars = {}) {
  const table = T[lang] ?? T.en;
  let s = (table[key] ?? T.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
  if (vars.minutes === 1) for (const [re, rep] of SINGULAR[lang] ?? []) s = s.replace(re, rep);
  return s;
}

export function statusText(lang, status) {
  const i = STATUS_KEYS.indexOf(status);
  if (i < 0) return status ? String(status) : '—'; // unknown status (e.g. not in the provider plan) is shown as "—", never guessed
  return (T[lang] ?? T.en).status[i];
}

export function placeName(lang, type) {
  const p = PLACES[type];
  if (!p) return type;
  return (p[lang] ?? p.en)[0];
}

export { STATUS_KEYS };
