import type { PropertyCategory } from "./listings";

/** Grid copy in the chat's language. Stage names and unit data come from the engine as given. */
export const gridText = (ar: boolean) =>
  ar
    ? {
        title: "عقارات يمكنك معاينتها هذا الأسبوع",
        close: "إغلاق",
        anyArea: "كل المناطق",
        startOver: "ابدأ من جديد",
        removeBudget: "إزالة فلتر الميزانية",
        upTo: (aed: string) => `حتى ${aed} في السنة`,
        details: "عرض التفاصيل",
        category: { residential: "سكني", commercial: "تجاري", retail: "تجزئة" } as Record<PropertyCategory, string>,
        beds: (b: number) => (b === 0 ? "استوديو" : b >= 4 ? "4+ غرف" : `${b} غرف`),
        sizes: { small: "حتى 1,000 قدم مربع", medium: "1,001 إلى 3,000 قدم مربع", large: "أكثر من 3,000 قدم مربع" },
        count: (n: number, homes: boolean) =>
          `${n} ${homes ? (n === 1 ? "منزل" : "منازل") : n === 1 ? "عقار" : "عقارات"}`,
        show: (c: string) => `عرض ${c}`,
        nothing: "لا شيء يطابق هذه الفلاتر.",
      }
    : {
        title: "Properties you can view this week",
        close: "Close",
        anyArea: "Any area",
        startOver: "Start over",
        removeBudget: "Remove budget filter",
        upTo: (aed: string) => `Up to ${aed} a year`,
        details: "View details",
        category: { residential: "Residential", commercial: "Commercial", retail: "Retail" } as Record<
          PropertyCategory,
          string
        >,
        beds: (b: number) => (b === 0 ? "Studio" : b >= 4 ? "4+ bed" : `${b} bed`),
        sizes: { small: "Up to 1,000 sqft", medium: "1,001 to 3,000 sqft", large: "Over 3,000 sqft" },
        count: (n: number, homes: boolean) =>
          homes ? `${n} ${n === 1 ? "home" : "homes"}` : `${n} ${n === 1 ? "property" : "properties"}`,
        show: (c: string) => `Show ${c}`,
        nothing: "Nothing matches those filters.",
      };
