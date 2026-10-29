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
  contactSavedWeb: "Thank you, we have your details.",
  contactShow: (email: string, phone: string | null) =>
    `We have: ${email}${phone ? `, ${phone}` : ", no phone"}. To change them, send your email address again.`,
  askBedrooms: "How many bedrooms are you looking for?",
  results: (n: number) => `Here ${n === 1 ? "is 1 home" : `are ${n} homes`} for rent that match. Tap one for details:`,
  noResults: "Nothing matches that right now. Try another size, or send /agent to talk to a leasing officer.",
  noResultsWeb: "Nothing matches that right now. Try another size or area.",
  noSlotsWeb: "There are no free viewing times in the next few days. Please check again later.",
  noGeneralAnswerWeb: "I don't have that information here. A leasing officer can answer it when you view a home.",
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
  viewingRequested: "Thanks. A leasing officer will confirm your viewing time by email.",
  applyCta: "Apply now",
  applyDone: "Done. We emailed you a link to upload your Emirates ID and passport.",
  applyDoneCompany: "Done. We emailed you a link to upload your documents.",
  alreadyApplied: "You already applied for this unit. Check your email for the upload link.",
  alreadyViewing: "You already have a viewing booked for this unit. Check your email for the details.",
  askCompanyName: "What is your company's name?",
  badCompanyName: "Please send the company name (letters, digits, spaces, & - . ' only, up to 120 characters).",
  askContactPerson: "Thanks. And the name of the contact person?",
  tooManyApplications: "You have several open applications already. Please wait for an officer to follow up.",
  applyUnavailable: "Applying online isn't available for this property right now. Please book a viewing instead.",
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
  // Public web chat.
  autopilotCant:
    'I can help you find a home and book a viewing. For a problem in your home, use "Report an issue" in your My tenancy email.',
  agentTapToBook: "To book this time, please tap it below. Nothing is booked until you do.",
  agentTapToApply: "To apply for this home, please tap Apply below. Nothing is submitted until you do.",
  agentDailyCap:
    "I've reached the limit of bookings and applications I can make in this chat for today. Please try again tomorrow.",
  existingTenantWeb:
    "For your lease, payments or documents, please use the 'My tenancy' link in your latest email from us. I can help you find a home or book a viewing.",
  changeEmail: "Change email",
  // Public web chat: status check (decision D34).
  checkStatus: "Check my applications",
  /** Web quick-action pills when no home is in focus yet. */
  pillPickToBook: "Pick a home first, then I can book a viewing. ",
  pillPickToApply: "Pick a home first, then you can apply. ",
  statusCodeSent: (masked: string) =>
    `If this email has applications, we sent a 6-digit code to ${masked}. It works for 15 minutes. Type it here.`,
  statusCodeAsk: "Please type the 6-digit code from the email.",
  statusCodeBad: 'That code did not work or has expired. Tap "Check my applications" to get a new one.',
  statusIntro: (n: number) => (n === 1 ? "Here is your application:" : `Here are your ${n} applications:`),
  statusNone: "We have no open applications for this email.",
  statusShownStored: 'Your applications were shown here. Tap "Check my applications" to see them again.',
  statusStage: (stage: string, nextStep: string) => `${stage}: ${nextStep}`,
  statusOffer: (rent: string, cheques: number) =>
    `Offer: ${rent} a year, ${cheques} cheque${cheques === 1 ? "" : "s"}.`,
  statusRef: (ref: string, unit: string) => `${ref} (${unit})`,
  stageName: (n: "Viewing" | "Documents" | "Offer" | "Contract" | "Ejari") =>
    ({ Viewing: "Viewing", Documents: "Documents", Offer: "Offer", Contract: "Contract", Ejari: "Ejari" })[n],
  nextStep: (
    k:
      | "enquiry"
      | "viewing"
      | "documents"
      | "offer"
      | "offerPrep"
      | "reserved"
      | "contract"
      | "contractSigning"
      | "ejari"
      | "registered",
  ) =>
    ({
      enquiry: "We are arranging your viewing. Watch your email for the time.",
      viewing: "Your viewing is booked. We will follow up after it.",
      documents: "We are checking your documents. If we need more, we will email you.",
      offer: "We have sent you an offer. Please answer it using the link in your email.",
      offerPrep: "We are preparing your offer.",
      reserved: "Thank you for accepting. We are preparing your contract.",
      contract: "Your contract is being prepared.",
      contractSigning: "Your contract is ready to sign. Use the signing link in your email.",
      ejari: "We are registering your tenancy with Ejari.",
      registered: "Your tenancy is registered. Your Ejari certificate has been emailed to you.",
    })[k],
  actUpload: "Email me the upload link",
  actOffer: "Email me the offer",
  actSign: "Email me the signing link",
  actEjari: "Email me the Ejari certificate",
  actQueued: "Done. We emailed the link to the address on your application.",
  actAlready: "We already emailed that today. Please check your inbox and spam folder.",
  actPreparing: "Your offer is being prepared. We'll email it soon.",
  alreadyOpenNeutral: "If you already asked about this property, check your email for the details we sent.",
  actNotNow: "That is not available right now. Tap Check my applications to see the latest.",
  statusNeedsVerify: "To see your applications, we first need to check your email.",
  askArea: "Which area would you like to live in?",
  anyArea: "Any area",
  askFurnished: "Do you want it furnished?",
  furnishedYes: "Furnished: Yes",
  furnishedNo: "Furnished: No",
  furnishedAny: "Furnished: Any",
  findHome: "Find a home",
  findAnother: "Find another home",
  // Public web chat: emirate, category, size and budget steps.
  askEmirate: "Which emirate are you looking in?",
  emirateDubai: "Dubai",
  emirateAbuDhabi: "Abu Dhabi",
  emirateSharjah: "Sharjah",
  comingSoon: (label: string) => `${label} (Coming soon)`,
  onlyDubai: "We only list homes in Dubai for now.",
  askCategory: "What are you looking for?",
  categoryResidential: "Residential",
  categoryCommercial: "Commercial",
  categoryRetail: "Retail",
  askSize: "How much space do you need?",
  sizeSmall: "Up to 1,000 sq ft",
  sizeMedium: "1,000 to 3,000 sq ft",
  sizeLarge: "Over 3,000 sq ft",
  askBudget: "What is your yearly budget? You can skip this.",
  budgetAny: "Any budget",
  budgetUpTo: (aed: string) => `Up to AED ${aed}`,
  // Public web chat agent (decision D36): fixed lines the agent never writes itself.
  choiceExpired: "That choice is no longer available. Tell me what you'd like and I'll show the options again.",
  agentUnsure:
    "Sorry, I couldn't answer that reliably. Try asking in another way, or use the buttons below to browse homes.",
  agentError: "Sorry, I couldn't process that just now. Please try again in a moment.",
  agentBusy: "One moment, I'm busy with other visitors. Please try again in a minute.",
  statusCodeSentChat: (masked: string) =>
    `If ${masked} has applications with us, I've sent a 6-digit code there. It works for 15 minutes. Type it here and I'll show them.`,
  statusCheckBusy: "You've asked for a few codes already. Please wait a little before asking for another.",
  resultsProps: (n: number) =>
    `Here ${n === 1 ? "is 1 property" : `are ${n} properties`} for rent that match. Tap one for details:`,
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
  contactSavedWeb: "شكراً، حصلنا على بياناتك.",
  contactShow: (email: string, phone: string | null) =>
    `لدينا: ${email}${phone ? `، ${phone}` : "، بدون رقم هاتف"}. لتغييرها، أرسل بريدك الإلكتروني مرة أخرى.`,
  askBedrooms: "كم عدد غرف النوم التي تبحث عنها؟",
  results: (n: number) =>
    `هذه ${n === 1 ? "وحدة واحدة متاحة" : `${n} وحدات متاحة`} للإيجار تطابق طلبك. اضغط على إحداها للتفاصيل:`,
  noResults: "لا يوجد ما يطابق طلبك حالياً. جرّب حجماً آخر، أو أرسل /agent للتحدث مع موظف التأجير.",
  noResultsWeb: "لا يوجد ما يطابق طلبك حالياً. جرّب حجماً آخر أو منطقة أخرى.",
  noSlotsWeb: "لا توجد مواعيد معاينة متاحة في الأيام القليلة القادمة. يرجى المحاولة لاحقاً.",
  noGeneralAnswerWeb: "لا تتوفر لدي هذه المعلومة هنا. يمكن لموظف التأجير الإجابة عنها عند معاينة المنزل.",
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
  viewingRequested: "شكراً لك. سيؤكد لك موظف التأجير موعد المعاينة عبر البريد الإلكتروني.",
  applyCta: "قدّم الآن",
  applyDone: "تم. أرسلنا لك رابطاً عبر البريد الإلكتروني لرفع الهوية الإماراتية وجواز السفر.",
  applyDoneCompany: "تم. أرسلنا لك رابطاً عبر البريد الإلكتروني لرفع مستنداتك.",
  alreadyApplied: "لقد قدّمت طلباً لهذه الوحدة بالفعل. تحقق من بريدك الإلكتروني لرابط الرفع.",
  alreadyViewing: "لديك بالفعل موعد معاينة لهذه الوحدة. تحقق من بريدك الإلكتروني للتفاصيل.",
  askCompanyName: "ما اسم شركتك؟",
  badCompanyName: "يرجى إرسال اسم الشركة (حروف وأرقام ومسافات و & - . ' فقط، حتى 120 حرفاً).",
  askContactPerson: "شكراً لك. وما اسم الشخص المسؤول عن التواصل؟",
  tooManyApplications: "لديك عدة طلبات مفتوحة بالفعل. يرجى انتظار تواصل أحد الموظفين.",
  applyUnavailable: "التقديم عبر الإنترنت غير متاح لهذا العقار حالياً. يرجى حجز معاينة بدلاً من ذلك.",
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
  autopilotCant:
    'يمكنني مساعدتك في العثور على منزل وحجز معاينة. لأي مشكلة في منزلك، استخدم "الإبلاغ عن مشكلة" في رسالة "إيجارك" الإلكترونية.',
  agentTapToBook: "لحجز هذا الموعد، يرجى الضغط عليه أدناه. لن يتم أي حجز قبل ذلك.",
  agentTapToApply: "للتقديم على هذا المنزل، يرجى الضغط على قدّم أدناه. لن يُرسل أي طلب قبل ذلك.",
  agentDailyCap: "وصلت إلى الحد الأقصى للحجوزات والطلبات في هذه المحادثة لهذا اليوم. يرجى المحاولة غداً.",
  existingTenantWeb:
    'لعقدك أو دفعاتك أو مستنداتك، يرجى استخدام رابط "إيجارك" في آخر رسالة إلكترونية أرسلناها لك. يمكنني مساعدتك في العثور على منزل أو حجز معاينة.',
  changeEmail: "تغيير البريد الإلكتروني",
  checkStatus: "تحقق من طلباتي",
  pillPickToBook: "اختر منزلاً أولاً، ثم أحجز لك المعاينة. ",
  pillPickToApply: "اختر منزلاً أولاً، ثم يمكنك التقديم. ",
  statusCodeSent: (masked: string) =>
    `إذا كان لهذا البريد طلبات، فقد أرسلنا رمزاً من 6 أرقام إلى ${masked}. يعمل لمدة 15 دقيقة. اكتبه هنا.`,
  statusCodeAsk: "يرجى كتابة الرمز المكون من 6 أرقام من البريد الإلكتروني.",
  statusCodeBad: 'الرمز غير صحيح أو انتهت صلاحيته. اضغط "تحقق من طلباتي" للحصول على رمز جديد.',
  statusIntro: (n: number) => (n === 1 ? "هذا هو طلبك:" : `هذه طلباتك (${n}):`),
  statusNone: "لا توجد طلبات مفتوحة لهذا البريد الإلكتروني.",
  statusShownStored: 'عُرضت طلباتك هنا. اضغط "تحقق من طلباتي" لرؤيتها مرة أخرى.',
  statusStage: (stage: string, nextStep: string) => `${stage}: ${nextStep}`,
  statusOffer: (rent: string, cheques: number) => `العرض: ${rent} سنوياً، ${cheques} شيكات.`,
  statusRef: (ref: string, unit: string) => `${ref} (${unit})`,
  stageName: (n: "Viewing" | "Documents" | "Offer" | "Contract" | "Ejari") =>
    ({ Viewing: "المعاينة", Documents: "المستندات", Offer: "العرض", Contract: "العقد", Ejari: "إيجاري" })[n],
  nextStep: (
    k:
      | "enquiry"
      | "viewing"
      | "documents"
      | "offer"
      | "offerPrep"
      | "reserved"
      | "contract"
      | "contractSigning"
      | "ejari"
      | "registered",
  ) =>
    ({
      enquiry: "نرتب موعد معاينتك. ترقب بريدك الإلكتروني.",
      viewing: "تم حجز معاينتك. سنتواصل معك بعدها.",
      documents: "نراجع مستنداتك. إذا احتجنا المزيد سنراسلك.",
      offer: "أرسلنا لك عرضاً. يرجى الرد عليه عبر الرابط في بريدك الإلكتروني.",
      offerPrep: "نجهز عرضك.",
      reserved: "شكراً لقبولك. نجهز عقدك.",
      contract: "عقدك قيد الإعداد.",
      contractSigning: "عقدك جاهز للتوقيع. استخدم رابط التوقيع في بريدك الإلكتروني.",
      ejari: "نسجل عقد إيجارك في إيجاري.",
      registered: "تم تسجيل عقد إيجارك. أرسلنا شهادة إيجاري إلى بريدك الإلكتروني.",
    })[k],
  actUpload: "أرسل لي رابط الرفع بالبريد",
  actOffer: "أرسل لي العرض بالبريد",
  actSign: "أرسل لي رابط التوقيع بالبريد",
  actEjari: "أرسل لي شهادة إيجاري بالبريد",
  actQueued: "تم. أرسلنا الرابط إلى البريد المسجل في طلبك.",
  actAlready: "أرسلناه اليوم بالفعل. يرجى مراجعة بريدك الوارد والرسائل غير المرغوب فيها.",
  actPreparing: "عرضك قيد الإعداد. سنرسله إليك عبر البريد الإلكتروني قريباً.",
  alreadyOpenNeutral: "إذا سبق أن استفسرت عن هذا العقار، فتحقق من بريدك الإلكتروني للاطلاع على التفاصيل التي أرسلناها.",
  actNotNow: "هذا غير متاح الآن. اضغط على تحقق من طلباتي لرؤية آخر المستجدات.",
  statusNeedsVerify: "لعرض طلباتك، نحتاج أولاً إلى التحقق من بريدك الإلكتروني.",
  askArea: "في أي منطقة تفضل السكن؟",
  anyArea: "أي منطقة",
  askFurnished: "هل تريده مفروشاً؟",
  furnishedYes: "مفروش: نعم",
  furnishedNo: "مفروش: لا",
  furnishedAny: "مفروش: أي",
  findHome: "ابحث عن منزل",
  findAnother: "ابحث عن منزل آخر",
  askEmirate: "في أي إمارة تبحث؟",
  emirateDubai: "دبي",
  emirateAbuDhabi: "أبوظبي",
  emirateSharjah: "الشارقة",
  comingSoon: (label: string) => `${label} (قريباً)`,
  onlyDubai: "نعرض المنازل في دبي فقط حالياً.",
  askCategory: "ما الذي تبحث عنه؟",
  categoryResidential: "سكني",
  categoryCommercial: "تجاري",
  categoryRetail: "محلات تجزئة",
  askSize: "ما المساحة التي تحتاجها؟",
  sizeSmall: "حتى 1,000 قدم مربع",
  sizeMedium: "من 1,000 إلى 3,000 قدم مربع",
  sizeLarge: "أكثر من 3,000 قدم مربع",
  askBudget: "ما ميزانيتك السنوية؟ يمكنك تخطي هذا السؤال.",
  budgetAny: "أي ميزانية",
  budgetUpTo: (aed: string) => `حتى ${aed} درهم`,
  choiceExpired: "هذا الخيار لم يعد متاحاً. أخبرني بما تريده وسأعرض الخيارات مرة أخرى.",
  agentUnsure: "عذراً، لم أتمكن من الإجابة بشكل موثوق. جرّب صياغة أخرى، أو استخدم الأزرار أدناه لتصفح المنازل.",
  agentError: "عذراً، لم أتمكن من معالجة ذلك الآن. يرجى المحاولة بعد قليل.",
  agentBusy: "لحظة من فضلك، أنا مشغول مع زوار آخرين. يرجى المحاولة بعد دقيقة.",
  statusCodeSentChat: (masked: string) =>
    `إذا كان لدى ${masked} طلبات لدينا، فقد أرسلت رمزاً من 6 أرقام إليه. يعمل لمدة 15 دقيقة. اكتبه هنا وسأعرضها لك.`,
  statusCheckBusy: "لقد طلبت عدة رموز بالفعل. يرجى الانتظار قليلاً قبل طلب رمز آخر.",
  resultsProps: (n: number) =>
    `هذه ${n === 1 ? "وحدة واحدة متاحة" : `${n} وحدات متاحة`} للإيجار تطابق طلبك. اضغط على إحداها للتفاصيل:`,
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

/**
 * True for the stored stand-in line of a status panel ("Your applications were shown here…"). It is
 * kept only so the chat history reads sensibly; it is never an answer to a new status question.
 */
export const isStatusStandIn = (text: string): boolean =>
  text.trim() === enquiryCopy.en.statusShownStored || text.trim() === enquiryCopy.ar.statusShownStored;
