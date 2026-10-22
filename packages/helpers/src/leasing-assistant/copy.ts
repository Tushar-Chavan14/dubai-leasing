import type { EnquiryLanguage } from "@leasing/core";

/**
 * Every fixed reply of the Telegram enquiry bot, in English and Arabic. Code picks the line;
 * no model writes these. The Arabic needs a native speaker's review before a client pitch.
 */
type Line = string | ((...args: never[]) => string);
type Copy = Record<string, Line>;

const en = {
  welcome:
    "Hello! I'm the Dubai Leasing enquiry assistant. I can show you homes for rent and book a viewing.\nHow many bedrooms are you looking for?",
  help: "What I can do:\n/units – find a home\n/book – book a viewing of the home you picked\n/mybooking – your booked viewing\n/contact – your email and phone\n/agent – talk to a leasing officer\n/language – English or Arabic",
  askContactEmail:
    "Hello! I'm the Dubai Leasing enquiry assistant. Before we start, what's your email address? We'll send viewing details there and use it to follow up on your enquiry.",
  askContactEmailAgain: "Please send your email address first, for example name@example.com.",
  askPhone:
    "Thanks. If you'd like a call back, send your phone number with the country code (for example +971 50 123 4567), or tap Skip.",
  badPhone: "That doesn't look like a phone number. Send it with the country code, or tap Skip.",
  skipCta: "Skip",
  contactSaved: "Thank you, we have your details. How many bedrooms are you looking for?",
  contactShow: (email: string, phone: string | null) =>
    `We have: ${email}${phone ? `, ${phone}` : ", no phone"}. To change them, send your email address again.`,
  askBedrooms: "How many bedrooms are you looking for?",
  results: (n: number) => `Here ${n === 1 ? "is 1 home" : `are ${n} homes`} for rent that match. Tap one for details:`,
  noResults: "Nothing matches that right now. Try another size, or send /agent to talk to a leasing officer.",
  unit: (facts: string) => `${facts}\n\nPick a viewing time below, or ask me a question about this home.`,
  unitGone: "Sorry, that home is no longer available. Here's what is:",
  pickUnitFirst: "Pick a home first, then I can book a viewing. How many bedrooms are you looking for?",
  slots: "Pick a viewing time (Dubai time):",
  noSlots: "There are no free viewing times in the next few days. Send /agent and a leasing officer will arrange one.",
  slotTaken: "Sorry, that time was just taken. These times are still free:",
  askName: "What is your full name?",
  badName: "Please send your full name (letters only, up to 120 characters).",
  askEmail: (name: string) =>
    `Thanks, ${name}. What is your email address? The viewing details and every next step come by email.`,
  badEmail: "That doesn't look like an email address. Please send it again, for example name@example.com.",
  booked: (when: string, where: string) =>
    `Your viewing is booked: ${when} at ${where}.\nWe've emailed you the details. From here on, everything (documents, offer, contract) happens by email.`,
  alreadyBooked: (when: string) => `You already have a viewing of this home booked: ${when}.`,
  noBooking: "You have no viewing booked yet. Send /units to find a home.",
  myBooking: (when: string, where: string, ref: string) => `Your viewing: ${when} at ${where}. Reference ${ref}.`,
  handoff: "Thank you. I've passed your message to a leasing officer, who will reply here.",
  inHandoff: "A leasing officer has your conversation and will reply here.",
  existingTenant:
    "If you already rent from us, please use the link in your latest email from us for repairs, payments or renewal. I've also passed your message to a leasing officer.",
  media: "Please don't send photos or documents here. If we need your ID, we'll email you a secure upload link.",
  rateLimited: "You've sent a lot of messages. Please wait a little before writing again.",
  pickLanguage: "Choose a language:",
  languageSet: "I'll reply in English.",
  noAnswer: "I don't have that detail in the listing. A leasing officer will confirm it when you view the home.",
  noGeneralAnswer: "I don't have that information here. Send /agent and a leasing officer will answer.",
  greeting: "Hello! How many bedrooms are you looking for?",
  bookCta: "Book a viewing",
  backCta: "Other homes",
  bedrooms: (n: number) => (n === 0 ? "Studio" : n >= 4 ? "4+ bedrooms" : `${n} bedroom${n === 1 ? "" : "s"}`),
  perYear: (rent: string) => `${rent} a year`,
} satisfies Copy;

const ar: typeof en = {
  welcome:
    "مرحباً! أنا مساعد الاستفسارات في Dubai Leasing. يمكنني أن أعرض عليك منازل للإيجار وأن أحجز لك موعد معاينة.\nكم عدد غرف النوم التي تبحث عنها؟",
  help: "ما يمكنني فعله:\n/units – البحث عن منزل\n/book – حجز معاينة للمنزل الذي اخترته\n/mybooking – موعد معاينتك\n/contact – بريدك الإلكتروني وهاتفك\n/agent – التحدث مع موظف التأجير\n/language – العربية أو الإنجليزية",
  askContactEmail:
    "مرحباً! أنا مساعد الاستفسارات في Dubai Leasing. قبل أن نبدأ، ما عنوان بريدك الإلكتروني؟ سنرسل إليه تفاصيل المعاينة ونتابع استفسارك من خلاله.",
  askContactEmailAgain: "يرجى إرسال بريدك الإلكتروني أولاً، مثلاً name@example.com.",
  askPhone: "شكراً. إذا رغبت في أن نتصل بك، أرسل رقم هاتفك مع رمز الدولة (مثلاً ‎+971 50 123 4567)، أو اضغط تخطي.",
  badPhone: "يبدو أن هذا ليس رقم هاتف. أرسله مع رمز الدولة، أو اضغط تخطي.",
  skipCta: "تخطي",
  contactSaved: "شكراً، حصلنا على بياناتك. كم عدد غرف النوم التي تبحث عنها؟",
  contactShow: (email: string, phone: string | null) =>
    `لدينا: ${email}${phone ? `، ${phone}` : "، بدون رقم هاتف"}. لتغييرها، أرسل بريدك الإلكتروني مرة أخرى.`,
  askBedrooms: "كم عدد غرف النوم التي تبحث عنها؟",
  results: (n: number) =>
    `هذه ${n === 1 ? "وحدة واحدة متاحة" : `${n} وحدات متاحة`} للإيجار تطابق طلبك. اضغط على إحداها للتفاصيل:`,
  noResults: "لا يوجد ما يطابق طلبك حالياً. جرّب حجماً آخر، أو أرسل /agent للتحدث مع موظف التأجير.",
  unit: (facts: string) => `${facts}\n\nاختر موعد معاينة من الأسفل، أو اسألني عن هذا المنزل.`,
  unitGone: "عذراً، هذا المنزل لم يعد متاحاً. إليك المتاح حالياً:",
  pickUnitFirst: "اختر منزلاً أولاً، ثم أحجز لك المعاينة. كم عدد غرف النوم التي تبحث عنها؟",
  slots: "اختر موعد المعاينة (بتوقيت دبي):",
  noSlots: "لا توجد مواعيد معاينة متاحة في الأيام القليلة القادمة. أرسل /agent وسيرتّب لك موظف التأجير موعداً.",
  slotTaken: "عذراً، تم حجز هذا الموعد للتو. هذه المواعيد ما زالت متاحة:",
  askName: "ما اسمك الكامل؟",
  badName: "يرجى إرسال اسمك الكامل (أحرف فقط، حتى 120 حرفاً).",
  askEmail: (name: string) =>
    `شكراً ${name}. ما عنوان بريدك الإلكتروني؟ ستصلك تفاصيل المعاينة وكل الخطوات التالية بالبريد الإلكتروني.`,
  badEmail: "يبدو أن هذا ليس عنوان بريد إلكتروني صحيحاً. يرجى إرساله مرة أخرى، مثلاً name@example.com.",
  booked: (when: string, where: string) =>
    `تم حجز موعد المعاينة: ${when} في ${where}.\nأرسلنا لك التفاصيل بالبريد الإلكتروني. من الآن فصاعداً، تتم كل الخطوات (المستندات، العرض، العقد) عبر البريد الإلكتروني.`,
  alreadyBooked: (when: string) => `لديك بالفعل موعد معاينة لهذا المنزل: ${when}.`,
  noBooking: "لم تحجز أي معاينة بعد. أرسل /units للبحث عن منزل.",
  myBooking: (when: string, where: string, ref: string) => `موعد معاينتك: ${when} في ${where}. الرقم المرجعي ${ref}.`,
  handoff: "شكراً لك. أحلت رسالتك إلى موظف التأجير، وسيرد عليك هنا.",
  inHandoff: "محادثتك الآن مع موظف التأجير، وسيرد عليك هنا.",
  existingTenant:
    "إذا كنت مستأجراً لدينا حالياً، يرجى استخدام الرابط في آخر رسالة بريد إلكتروني منا للإصلاحات أو الدفعات أو التجديد. كما أحلت رسالتك إلى موظف التأجير.",
  media: "يرجى عدم إرسال صور أو مستندات هنا. إذا احتجنا إلى هويتك، سنرسل لك رابط رفع آمناً بالبريد الإلكتروني.",
  rateLimited: "لقد أرسلت رسائل كثيرة. يرجى الانتظار قليلاً قبل الكتابة مجدداً.",
  pickLanguage: "اختر اللغة:",
  languageSet: "سأرد عليك بالعربية.",
  noAnswer: "هذه المعلومة غير موجودة في الإعلان. سيؤكدها لك موظف التأجير عند المعاينة.",
  noGeneralAnswer: "لا تتوفر لدي هذه المعلومة هنا. أرسل /agent وسيجيبك موظف التأجير.",
  greeting: "مرحباً! كم عدد غرف النوم التي تبحث عنها؟",
  bookCta: "احجز معاينة",
  backCta: "منازل أخرى",
  bedrooms: (n: number) =>
    n === 0 ? "ستوديو" : n >= 4 ? "4 غرف نوم أو أكثر" : n === 1 ? "غرفة نوم واحدة" : `${n} غرف نوم`,
  perYear: (rent: string) => `${rent} سنوياً`,
};

export const enquiryCopy: Record<EnquiryLanguage, typeof en> = { en, ar };

/** A viewing slot in Dubai time, in the enquirer's language. */
export function formatSlot(at: Date, lang: EnquiryLanguage): string {
  return new Intl.DateTimeFormat(lang === "ar" ? "ar-AE" : "en-GB", {
    timeZone: "Asia/Dubai",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}
