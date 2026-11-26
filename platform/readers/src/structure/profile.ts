import type { RawBlank } from "./blanks.ts";
import type { FieldInfo } from "./types.ts";

/**
 * Everything module-specific the shared contract-structure reader needs (S4, S5, S43): its helper name, how the
 * prompts name the document, the parties a blank can belong to, the data sheet, placeholder aliases, label rules and
 * the words that make a "Label:" line, plus optional hooks for filled samples and post-mapping fixes. The reader has
 * no default: each module passes its own (leasing: `leasingTemplateProfile`; SPA: `spaTemplateProfile`).
 */
export interface TemplateParty {
  /** The party key prefix and the `party` the model sees ("landlord"). */
  role: string;
  /** Lower-case words that name the party in a contract ("landlord", "owner", "lessor"); a plural `s` also counts. */
  words: readonly string[];
}

export interface TemplateSheet {
  isKey(key: string): boolean;
  keyNames: readonly string[];
  keyInfo(key: string): FieldInfo | null;
  /** The key list the model sees: key | type | description, never a value. */
  forPrompt(): string;
}

/** A blank code made from a filled sample's value: a proposed key and a fixed label, both from code. */
export interface FilledBlank extends RawBlank {
  proposedField?: string;
  fixedLabel?: string;
}

export interface TemplateProfile {
  helperName: string;
  /** First line of the structure prompt. */
  structureIntro: string;
  /** Example labels in the structure prompt, e.g. `"Annual rent", "Landlord nationality"`. */
  labelExamples: string;
  /** First line of the mapping prompt. */
  mappingIntro: string;
  /** The mapping prompt's rule about parties' keys. */
  partyKeyRule: string;
  /** Parties in order; a text naming exactly one of them belongs to it. */
  parties: readonly TemplateParty[];
  sheet: TemplateSheet;
  /** Compact placeholder name (lower case, no spaces or punctuation) to data-sheet key (D74). */
  placeholderAliases: Readonly<Record<string, string>>;
  /** Code label rules: a data-sheet key, "leave_empty", or null when the label says nothing certain. */
  matchLabel(label: string, party: string | null): string | null;
  /** Code rule on the words right after a blank ("____ cheques"): a data-sheet key, or null. */
  matchAfter?(after: string): string | null;
  /** Lower-case words that make a short "Label:" line a blank of the agreement. */
  labelWords: ReadonlySet<string>;
  /**
   * A filled sample's people, numbers and dates become blanks before any model sees the text. Default: only the
   * value patterns (`sweepValuePatterns`).
   */
  detectFilled?(
    lines: string[],
    startIndex: number,
    placeholderIds: ReadonlySet<string>,
  ): { lines: string[]; blanks: FilledBlank[] };
  /**
   * Whether a key may fill a blank of this party (null: the party is unknown). Checked by code on every proposal, the
   * model's included. Default: any key fits (leasing's party rule is in its label rules).
   */
  keyFitsParty?(key: string, party: string | null): boolean;
  /** A fix after mapping, by code (leasing numbers cheque-date runs). */
  afterMapping?<B extends { id: string; field: string; label: string; fieldType: string | null; role: string }>(
    texts: readonly (string | null | undefined)[],
    blanks: B[],
  ): B[];
}
