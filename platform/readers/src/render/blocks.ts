import { compatible, inferBlankType, replacePlaceholders } from "../structure/blanks.ts";
import { matchPlaceholder } from "../structure/mapping.ts";
import type { TemplateProfile } from "../structure/profile.ts";
import type { NumberingStyle, TemplateBlank, TemplateSections, TemplateStyle } from "../structure/schema.ts";

/**
 * The generic part of printing a company agreement template (S43, S46): block shapes, numbering in the template's own
 * style, the look actually used, how a blank is named and checked, and what an empty blank prints. Everything a
 * module decides (which keys are core, how a value is written, what is appended after the template's own wording)
 * comes in through `RenderProfile`. Pure code, no model, no storage.
 */

/** A block of the rendered document (same shapes as the PDF renderer's styled blocks). */
export type TemplateBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][]; widths?: number[] }
  | { kind: "sigline"; label: string; role?: string | null; slot?: number | null }
  | { kind: "small"; text: string };

/** What a module passes to print a template: its reader profile and its own value rules. */
export interface RenderProfile {
  /** The reader profile (data sheet, aliases): `sheet.keyInfo` says which key a blank may hold. */
  template: TemplateProfile;
  /** Legal and money keys that must have a value: a missing one stops the render (rule 1). */
  coreKeys: ReadonlySet<string>;
  /** Keys whose absence is a real answer, printed as a neutral word chosen by code. */
  neutralWhenAbsent: Readonly<Record<string, string>>;
  /** A data-sheet value as written in a blank, or null when it has none (or the key is unknown). */
  formatValue(key: string, values: Record<string, unknown>): string | null;
}

/** The render cannot go ahead: each entry says what to fix. The engine turns it into a 422. */
export class TemplateRenderError extends Error {
  constructor(readonly problems: string[]) {
    super(`The company template can't be filled: ${problems.join(" ")}`);
    this.name = "TemplateRenderError";
  }
}

/** What an empty blank prints: its own marker when it has one, else a plain line. */
export const emptyLine = (b: Pick<TemplateBlank, "marker" | "kind">): string =>
  // A placeholder's marker is its name ("{tenant name}"): never printed.
  b.marker.trim() && b.kind !== "placeholder" ? b.marker.trim() : "________";

export const blankName = (b: Pick<TemplateBlank, "id" | "label">) => `"${b.label}" (${b.id})`;

/**
 * Why a mapping on a field blank can't be used, or null when it can. A blank left empty (or the legacy
 * "unmapped") is fine: it prints as an empty line. Mappings are chosen by code, so this is a safety net.
 */
export function mappingProblem(b: TemplateBlank, profile: Pick<TemplateProfile, "sheet">): string | null {
  if (b.role !== "field") return null;
  if (b.field === "leave_empty" || b.field === "unmapped") return null;
  const info = profile.sheet.keyInfo(b.field);
  if (!info) return `Blank ${blankName(b)} is mapped to "${b.field}", which is not a data field.`;
  // D74: a placeholder's name says what it is; the words around it don't.
  if (b.kind === "placeholder") return null;
  const inferred = inferBlankType(b.label, b.before, b.after);
  if (!compatible(inferred, info.type)) {
    return `Blank ${blankName(b)} is mapped to ${info.label} (${info.type}) but asks for ${inferred}.`;
  }
  return null;
}

/** Blank ids still used by wording the admin has not dropped (`undefined` when there are no sections to ask). */
export function liveBlankIds(
  sections: TemplateSections | undefined,
  dropped: ReadonlySet<string>,
): Set<string> | undefined {
  if (!sections) return undefined;
  const ids = new Set<string>();
  const scan = (text: string | null | undefined) => {
    for (const m of (text ?? "").matchAll(/\{\{(b\d+)\}\}/g)) ids.add(m[1]!);
  };
  if (!dropped.has("title")) scan(sections.title);
  for (const s of sections.items) {
    if (!dropped.has(`${s.id}:h`)) scan(s.heading);
    s.paragraphs.forEach((p, i) => {
      if (!dropped.has(`${s.id}:${i}`)) scan(p);
    });
  }
  return ids;
}

/**
 * The look actually used: dropped parts removed. A sample with authority marks never gives an
 * accent colour (the neutral one is used), and a dropped logo is gone.
 */
export function effectiveStyle(
  style: TemplateStyle,
  review: { dropHeader: boolean; dropFooter: boolean; dropLogo: boolean },
  logoDocumentId: string | null,
): { style: TemplateStyle; logoDocumentId: string | null } {
  return {
    style: {
      ...style,
      header: review.dropHeader ? null : style.header,
      footer: review.dropFooter ? null : style.footer,
      accentColour: style.flags.authorityMarks ? null : style.accentColour,
    },
    logoDocumentId: review.dropLogo ? null : logoDocumentId,
  };
}

/** Characters the standard PDF fonts (WinAnsi) can't draw: the PDF renderer would print "?" for them. */
export function unprintable(s: string): boolean {
  return /[^\x20-\x7e\xa0-\xff\n]/.test(
    s
      .replace(/[−–—]/g, "-")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s/g, " "),
  );
}

const toRoman = (n: number): string => {
  const t: [number, string][] = [
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let r = "";
  for (const [v, sym] of t) {
    while (n >= v) {
      r += sym;
      n -= v;
    }
  }
  return r;
};

/** The number the next section takes, in the template's own numbering style (null for "none"). */
export function nextSectionNumber(style: NumberingStyle, lastNumber: string | null, count: number): string | null {
  const n = count + 1;
  switch (style) {
    case "none":
      return null;
    case "article":
      return `Article ${lastNumber && /[IVXLC]+$/.test(lastNumber) ? toRoman(n) : n}`;
    case "clause":
      return `${lastNumber?.toLowerCase().startsWith("section") ? "Section" : "Clause"} ${n}`;
    case "roman":
      return `${toRoman(n)}.`;
    case "alpha":
      return `${String.fromCharCode(64 + Math.min(n, 26))}.`;
    default:
      return `${n}.`;
  }
}

/**
 * D74: a header or footer with named placeholders (`{company name} | Tenancy Contract {contract no}`) filled from the same
 * values as the body (a name the sheet doesn't know prints as an empty line). Page markers stay for the PDF renderer.
 */
export function fillPlaceholderText(
  text: string,
  values: Record<string, unknown>,
  profile: RenderProfile,
  preview = false,
): string {
  return replacePlaceholders(text, (name) => {
    const key = matchPlaceholder(name, profile.template);
    const info = key && key !== "leave_empty" ? profile.template.sheet.keyInfo(key) : null;
    if (!key || !info) return "________";
    if (preview) return `«${info.label}»`;
    return profile.formatValue(key, values) ?? "________";
  });
}
