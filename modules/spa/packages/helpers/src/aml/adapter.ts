import { FAKE_LIST_VERSION, FAKE_PEPS, FAKE_SANCTIONS, type ListEntry } from "./lists.ts";
import { nameSimilarity } from "./similarity.ts";

export interface ScreeningSubject {
  name: string;
  kind: "person" | "company";
}
export interface ScreeningMatch {
  list: "sanctions" | "pep";
  entryId: string;
  score: number;
}
export interface ScreeningResult {
  listVersion: string;
  /** Best name similarity on each list (0..1). */
  sanctionsScore: number;
  pepScore: number;
  /** The name equals a sanctions entry (after normalising and sorting tokens). */
  exact: boolean;
  matches: ScreeningMatch[];
}

/**
 * Screens one name against the lists. Thresholds are not its business: they come from the rulebook (S36). C27 wraps a
 * real provider behind the same interface. A call that throws means "not screened", which is itself a flag.
 */
export interface ScreeningAdapter {
  readonly listVersion: string;
  screen(subject: ScreeningSubject): Promise<ScreeningResult>;
}

/** Matches below this are not worth showing compliance. A reporting floor, not a decision threshold. */
const REPORT_FLOOR = 0.6;

/** Invented lists (FICTIONAL, SIMULATED) and a pure similarity function. */
export class FakeScreening implements ScreeningAdapter {
  readonly listVersion: string;
  private readonly sanctions: readonly ListEntry[];
  private readonly peps: readonly ListEntry[];
  private readonly fails: (name: string) => boolean;
  constructor(
    opts: {
      sanctions?: readonly ListEntry[];
      peps?: readonly ListEntry[];
      listVersion?: string;
      /** Simulates the service being down for some names. */
      failFor?: (name: string) => boolean;
    } = {},
  ) {
    this.sanctions = opts.sanctions ?? FAKE_SANCTIONS;
    this.peps = opts.peps ?? FAKE_PEPS;
    this.listVersion = opts.listVersion ?? FAKE_LIST_VERSION;
    this.fails = opts.failFor ?? (() => false);
  }
  async screen(subject: ScreeningSubject): Promise<ScreeningResult> {
    if (this.fails(subject.name)) throw new Error("screening service unavailable");
    const matches: ScreeningMatch[] = [];
    let sanctionsScore = 0;
    let pepScore = 0;
    for (const e of this.sanctions) {
      const score = nameSimilarity(subject.name, e.name);
      sanctionsScore = Math.max(sanctionsScore, score);
      if (score >= REPORT_FLOOR) matches.push({ list: "sanctions", entryId: e.id, score: round(score) });
    }
    for (const e of this.peps) {
      const score = nameSimilarity(subject.name, e.name);
      pepScore = Math.max(pepScore, score);
      if (score >= REPORT_FLOOR) matches.push({ list: "pep", entryId: e.id, score: round(score) });
    }
    return {
      listVersion: this.listVersion,
      sanctionsScore: round(sanctionsScore),
      pepScore: round(pepScore),
      exact: sanctionsScore === 1,
      matches: matches.toSorted((a, b) => b.score - a.score),
    };
  }
}
const round = (n: number) => Math.round(n * 1000) / 1000;
