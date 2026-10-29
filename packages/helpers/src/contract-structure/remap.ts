import type { Llm } from "@leasing/llm";
import { sheetKeyInfo } from "./datasheet.ts";
import { contextParty, partyIn, proposeMappings, templateLines } from "./mapping.ts";
import { formatField, NEUTRAL_WHEN_ABSENT } from "./render.ts";
import type { TemplateBlank } from "./schema.ts";

export interface Remapped {
  blanks: TemplateBlank[];
  /** Blanks whose key changed: what the approver and the audit trail see. */
  changes: { id: string; label: string; from: string; to: string; source: "matched" | "model" }[];
  /** The model was needed for some blank and did not answer: the stored mapping stands for those. */
  modelUnavailable: boolean;
  model: string | null;
}

/**
 * Re-maps, for one lease, the blanks of an approved template that are `leave_empty` or whose key has no value now.
 * Code label rules first, then the model (keys and descriptions only, never a value). A new key is taken only when it
 * has a value in `values` now; otherwise the stored mapping stands. Admin-chosen blanks and signatures are kept.
 * The template itself is not edited: the result is used for this contract only. Never throws.
 */
export async function remapForData(
  llm: Llm,
  sections: Parameters<typeof templateLines>[0],
  blanks: TemplateBlank[],
  values: Record<string, unknown>,
): Promise<Remapped> {
  const hasValue = (key: string) =>
    !!sheetKeyInfo(key) && (formatField(key, values) !== null || NEUTRAL_WHEN_ABSENT[key] !== undefined);
  const lines = templateLines(sections);
  const lineOf = (id: string) => lines.findIndex((l) => l.includes(`{{${id}}}`));
  const todo = blanks.filter(
    (b) =>
      b.role === "field" &&
      b.source !== "admin" &&
      (b.field === "leave_empty" || b.field === "unmapped" || !hasValue(b.field)),
  );
  if (!todo.length) return { blanks, changes: [], modelUnavailable: false, model: null };
  const { proposals, model, asked } = await proposeMappings(
    llm,
    todo.map((b) => ({
      id: b.id,
      label: b.label,
      before: b.before,
      after: b.after,
      party: partyIn(b.label) ?? contextParty(lines, Math.max(0, lineOf(b.id))),
    })),
  );
  const changes: Remapped["changes"] = [];
  const out = blanks.map((b) => {
    const p = proposals.get(b.id);
    if (!p || p.field === "leave_empty" || p.field === b.field || !hasValue(p.field)) return b;
    changes.push({
      id: b.id,
      label: b.label,
      from: b.field,
      to: p.field,
      source: p.source === "model" ? "model" : "matched",
    });
    const next: TemplateBlank = {
      ...b,
      field: p.field,
      fieldType: sheetKeyInfo(p.field)?.type ?? null,
      source: p.source,
    };
    delete next.note;
    return next;
  });
  return { blanks: out, changes, modelUnavailable: asked > 0 && model === null, model };
}
