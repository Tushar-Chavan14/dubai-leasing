/** Pure parts of the signing page's "mark changes on the contract" flow (no React, no browser APIs). */

/** A box on a page as fractions (0..1) of the page image's width and height, so it survives resizing. */
export interface MarkRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Mark {
  id: string;
  /** 1-based, always the position in the list. */
  n: number;
  page: number;
  quote: string;
  note: string;
  /** What the engine's anchor check called the place (e.g. "4.5 Maintenance"), or null when unknown. */
  label: string | null;
  rects: MarkRect[];
}

export type MarkDraft = Omit<Mark, "n">;

export type MarksAction =
  | { type: "load"; marks: Mark[] }
  | { type: "add"; mark: MarkDraft }
  | { type: "edit"; id: string; note: string }
  | { type: "remove"; id: string }
  | { type: "clear" };

const renumber = (marks: Mark[]): Mark[] => marks.map((m, i) => (m.n === i + 1 ? m : { ...m, n: i + 1 }));

export function marksReducer(marks: Mark[], a: MarksAction): Mark[] {
  switch (a.type) {
    case "load":
      return renumber(a.marks);
    case "add":
      return renumber([...marks, { ...a.mark, n: marks.length + 1 }]);
    case "edit":
      return marks.map((m) => (m.id === a.id ? { ...m, note: a.note } : m));
    case "remove":
      return renumber(marks.filter((m) => m.id !== a.id));
    case "clear":
      return [];
  }
}

/** Unsent marks are kept per signing link. */
export const marksKey = (token: string) => `marks:${token}`;

/** Reads saved marks back, dropping anything that does not look like a mark. */
export function parseStoredMarks(raw: string | null): Mark[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const ok = v.filter(
      (m): m is Mark =>
        !!m &&
        typeof m.id === "string" &&
        Number.isInteger(m.page) &&
        typeof m.quote === "string" &&
        typeof m.note === "string" &&
        Array.isArray(m.rects),
    );
    return renumber(ok);
  } catch {
    return [];
  }
}

export const MARK_REFUSAL_FALLBACK = "This is set in the offer or the records and can't be changed here.";
export const MARK_REMINDER = "Rent, cheques, deposit and dates are set in the offer and can't be changed here.";

/** "Send 1 change", "Send 3 changes". */
export const sendLabel = (n: number) => `Send ${n} ${n === 1 ? "change" : "changes"}`;

/** Collapses the whitespace a selection picks up between text spans. */
export const normaliseQuote = (s: string) => s.replace(/\s+/g, " ").trim();

/** Boxes (client coordinates) relative to the page box, as fractions; empty or off-page boxes are dropped. */
export function rectsRelativeTo(
  rects: { left: number; top: number; width: number; height: number }[],
  box: { left: number; top: number; width: number; height: number },
): MarkRect[] {
  if (box.width <= 0 || box.height <= 0) return [];
  return rects
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => ({
      x: (r.left - box.left) / box.width,
      y: (r.top - box.top) / box.height,
      w: r.width / box.width,
      h: r.height / box.height,
    }));
}

/** A selection reports a box per span and per text run, so boxes lying inside another box are dropped. */
export function dedupeRects(rects: MarkRect[]): MarkRect[] {
  const eps = 0.002;
  const inside = (a: MarkRect, b: MarkRect) =>
    a.x >= b.x - eps && a.y >= b.y - eps && a.x + a.w <= b.x + b.w + eps && a.y + a.h <= b.y + b.h + eps;
  return rects.filter((r, i) => rects.every((o, j) => j === i || !inside(r, o) || (inside(o, r) && j > i)));
}

export interface TextItem {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** A space between two text items only when the next starts on a new line or sits clear of this one. */
export function spaceAfter(items: TextItem[], i: number): boolean {
  const a = items[i];
  const b = items[i + 1];
  if (!a || !b) return false;
  const newLine = b.y > a.y + a.h * 0.5 || b.y + b.h < a.y + a.h * 0.5;
  return newLine || b.x - (a.x + a.w) > a.h * 0.25;
}
