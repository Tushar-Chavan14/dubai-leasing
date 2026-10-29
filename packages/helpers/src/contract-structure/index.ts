import type { Helper } from "@leasing/core";
import type { Llm } from "@leasing/llm";
import { extractPdf } from "../contract-template/extract.ts";
import { detectBlanks, guessLabel, isSignatureBlank } from "./blanks.ts";
import { sheetKeyInfo } from "./datasheet.ts";
import { detectFilledValues } from "./filled.ts";
import { contextParty, partyIn, type ProposeItem, proposeMappings } from "./mapping.ts";
import { DEFAULT_STYLE, extractLook, hasAuthorityMarks, lineKey } from "./look.ts";
import { structureMessages } from "./prompt.ts";
import {
  ContractStructureContext,
  ContractStructureData,
  MAX_BLANKS,
  StructureModelOutput,
  type TemplateBlank,
} from "./schema.ts";
import { buildSections, sectionOfLines } from "./structure.ts";

export {
  catalogueForPrompt,
  FIELD_CATALOGUE,
  FIELD_NAMES,
  type FieldInfo,
  type FieldType,
  fieldType,
  isFieldName,
} from "./fields.ts";
export {
  isSheetKey,
  SHEET_KEY_NAMES,
  SHEET_KEYS,
  type SheetRecords,
  sheetExtras,
  sheetForPrompt,
  sheetKeyInfo,
} from "./datasheet.ts";
export { detectFilledValues, fixedValueKinds, isSampleOnlyText } from "./filled.ts";
export {
  askModel,
  contextParty,
  mappingMessages,
  matchBlank,
  matchLabel,
  partyIn,
  type Party,
  type Proposal,
  proposeMappings,
  redactValues,
  resuggestBlanks,
} from "./mapping.ts";
export { compatible, detectBlanks, guessLabel, inferBlankType, type RawBlank, validateMapping } from "./blanks.ts";
export { DEFAULT_STYLE, extractLook, hasAuthorityMarks, type Look, LOOK_MAX_PAGES } from "./look.ts";
export { encodePng } from "./png.ts";
export { structureMessages } from "./prompt.ts";
export * from "./render.ts";
export { remapForData, type Remapped } from "./remap.ts";
export * from "./schema.ts";
export { buildSections, detectNumbering, splitNumber, toParagraphs } from "./structure.ts";

export interface ContractStructureDeps {
  /** Returns the uploaded file's bytes. The helper never touches disk. */
  readFile: (docId: string) => Promise<Uint8Array>;
}

const cleanLabel = (s: string): string =>
  s
    .replace(/\p{Cc}/gu, " ")
    .replace(/\{\{|\}\}|<<<|>>>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+part\s+\d+$/i, "")
    .slice(0, 80);

/**
 * Contract-structure helper (slice 4). From a company's sample contract PDF it returns the
 * structure (sections, numbering, fixed wording), the blanks (found by code; the model proposes a
 * label and a field for each, code validates it against the field catalogue and the blank's type),
 * and the look (read from the PDF by code, never by the model). No legal or money value comes from
 * here: a blank is filled later only from a contract field an admin approved. Returns data only.
 */
export function contractStructureHelper(
  llm: Llm,
  deps: ContractStructureDeps,
): Helper<ContractStructureContext, ContractStructureData> {
  return {
    name: "contract_structure",
    async run(input) {
      const docId = input.context.docId;
      const ids = [docId];
      let bytes: Uint8Array;
      try {
        bytes = await deps.readFile(docId);
      } catch (e) {
        const missing = (e as { code?: string } | null)?.code === "ENOENT";
        return {
          status: "failed",
          reasons: [missing ? "The uploaded file is missing." : "The uploaded file couldn't be read."],
          sourceDocIds: ids,
        };
      }
      const ex = await extractPdf(bytes);
      if (!ex.ok) {
        return { status: ex.kind === "not_pdf" ? "failed" : "needs_human", reasons: [ex.message], sourceDocIds: ids };
      }
      const look = await extractLook(bytes);
      const reasons: string[] = [];
      if (!look.ok) reasons.push(`${look.message} Default styling is used.`);
      // Repeated header and footer lines are not contract wording: drop them from the body.
      const repeated = look.ok ? look.repeated : new Set<string>();
      const kept = ex.text.split("\n").filter((l) => !repeated.has(lineKey(l)));
      const det0 = detectBlanks(kept.join("\n"), MAX_BLANKS + 1);
      // A filled sample: its people, numbers and dates become blanks here, by code, before any model sees the text.
      const maxId = det0.blanks.reduce((m, b) => Math.max(m, Number(b.id.slice(1))), 0);
      const filled = detectFilledValues(det0.lines, maxId);
      const det = { lines: filled.lines, blanks: [...det0.blanks, ...filled.blanks] };
      const fixed = new Map(filled.blanks.map((b) => [b.id, b]));
      if (!det.blanks.length) {
        return {
          status: "needs_human",
          reasons: ["No blanks found: this looks like a finished contract, not a template with blanks."],
          sourceDocIds: ids,
        };
      }
      if (det.blanks.length > MAX_BLANKS) {
        return {
          status: "needs_human",
          reasons: [`More than ${MAX_BLANKS} blanks found; upload a shorter sample.`],
          sourceDocIds: ids,
        };
      }
      const r = await llm.chat(structureMessages(det.lines, det.blanks), { schema: StructureModelOutput });
      // An answer that doesn't parse throws: the runner retries once, then asks a person.
      const out = StructureModelOutput.parse(r.parsed);
      const built = buildSections(
        det.lines,
        out.sections.map((s) => s.heading),
        look.ok ? look.headings : undefined,
      );
      if (!built.sections.items.some((s) => s.heading !== null)) {
        return {
          status: "needs_human",
          reasons: ["No section headings could be confirmed in the text."],
          sourceDocIds: ids,
        };
      }
      const hasPreamble = built.sections.items[0]?.id === "s0";
      const sectionOf = sectionOfLines(det.lines.length, built.headingLines, hasPreamble);
      const proposed = new Map(out.blanks.map((b) => [b.id, b]));
      // Mapping, in order: a code rule (synonyms, party-scoped), then the local decision model for what is left,
      // then "leave empty". The chat model's own field guesses are not used.
      const labelOf = new Map<string, string>();
      const signatureIds = new Set<string>();
      const items: ProposeItem[] = [];
      for (const b of det.blanks) {
        const p = proposed.get(b.id);
        const fx = fixed.get(b.id);
        const label = fx?.fixedLabel ?? (cleanLabel(p?.label ?? "") || guessLabel(b));
        labelOf.set(b.id, label);
        if (isSignatureBlank(b, label) || isSignatureBlank(b, guessLabel(b))) {
          signatureIds.add(b.id);
          continue;
        }
        items.push({
          id: b.id,
          label,
          before: b.before,
          after: b.after,
          party: partyIn(label) ?? contextParty(det.lines, b.line),
          known: fx?.proposedField ?? null,
        });
      }
      const { proposals, model: modelName } = await proposeMappings(llm, items);
      const unmapped = 0;
      const blanks: TemplateBlank[] = det.blanks.map((b) => {
        const signature = signatureIds.has(b.id);
        const prop = proposals.get(b.id);
        const map = signature
          ? { field: "unmapped" as const, fieldType: null, source: undefined }
          : prop?.field === "leave_empty" || !prop
            ? { field: "leave_empty" as const, fieldType: null, source: prop?.source ?? ("empty" as const) }
            : { field: prop.field, fieldType: sheetKeyInfo(prop.field)?.type ?? null, source: prop.source };
        return {
          id: b.id,
          kind: b.kind,
          marker: b.marker.slice(0, 40),
          label: labelOf.get(b.id) ?? "Blank",
          field: map.field,
          fieldType: map.fieldType,
          ...(map.source ? { source: map.source } : {}),
          role: signature ? "signature" : "field",
          sectionIndex: sectionOf[b.line] ?? 0,
          before: b.before.slice(-200),
          after: b.after.slice(0, 100),
        };
      });
      const empty = blanks.filter((b) => b.role === "field" && b.field === "leave_empty").length;
      // An unreadable look can't say where the words sit.
      // Without positions, the first four and last two lines of the text stand in for letterhead and footer.
      const edge = ex.text.split("\n").filter((l) => l.trim());
      const textMarks = !look.ok && hasAuthorityMarks([...edge.slice(0, 4), ...edge.slice(-2)].join("\n"));
      const style = look.ok
        ? look.style
        : { ...DEFAULT_STYLE, flags: { authorityMarks: textMarks, areas: textMarks ? ["logo_area" as const] : [] } };
      const data: ContractStructureData = {
        sections: built.sections,
        blanks,
        style,
        logo: look.ok ? look.logo : null,
        pages: ex.pages,
        droppedSections: built.dropped,
        unmappedBlanks: unmapped,
      };
      reasons.push(
        `${built.sections.items.length} sections, ${blanks.filter((b) => b.role === "field").length} fields to fill (${empty} left empty for hand-filling), ${blanks.filter((b) => b.role === "signature").length} signature lines.` +
          (built.dropped ? ` ${built.dropped} proposed headings dropped because they are not in the text.` : ""),
      );
      if (style.flags.authorityMarks) {
        reasons.push(
          "DLD, RERA or Ejari wording found in the sample: it is not reused, and an admin must confirm the logo.",
        );
      }
      return { status: "ok", data, reasons, sourceDocIds: ids, model: { name: modelName ?? r.model } };
    },
  };
}
