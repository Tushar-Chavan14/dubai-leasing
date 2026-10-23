import { formatAed, type Helper } from "@leasing/core";
import type { Llm } from "@leasing/llm";
import { comparePrompt } from "./prompt.ts";
import {
  ExitDepositContext,
  ExitDepositData,
  RoomComparisonContext,
  RoomComparisonData,
  type StatementItem,
  type Suggestion,
  VisionComparison,
} from "./schema.ts";

export { comparePrompt } from "./prompt.ts";
export * from "./schema.ts";

/**
 * The deposit statement, in pure code (step 10). Every deduction is a price-list item × a
 * quantity at the list price, or an "other" amount an officer typed (which always needs finance's
 * approval). Deductions are capped at the deposit; anything beyond is reported as owed for a
 * manager, never claimed. Throws on an item id that isn't on the price list.
 */
export function computeStatement(c: ExitDepositContext): ExitDepositData {
  const items: StatementItem[] = c.findings.map((f) => {
    if (f.itemId === "other") {
      return {
        findingId: f.id,
        room: f.room,
        itemId: "other",
        label: f.otherLabel!,
        unit: "other",
        quantity: f.quantity,
        unitPriceFils: f.otherAmountFils!,
        amountFils: f.otherAmountFils! * f.quantity,
        fromPriceList: false,
      };
    }
    const p = c.priceList.find((x) => x.id === f.itemId);
    if (!p) throw new Error(`"${f.itemId}" is not on the price list`);
    return {
      findingId: f.id,
      room: f.room,
      itemId: p.id,
      label: p.label,
      unit: p.unit,
      quantity: f.quantity,
      unitPriceFils: p.priceFils,
      amountFils: p.priceFils * f.quantity,
      fromPriceList: true,
    };
  });
  const total = items.reduce((s, i) => s + i.amountFils, 0);
  const deductionsFils = Math.min(total, c.depositFils);
  const refundFils = c.depositFils - deductionsFils;
  const approvalReasons: string[] = [];
  if (items.some((i) => !i.fromPriceList))
    approvalReasons.push("includes an amount that is not on the company price list");
  if (refundFils > c.refundThresholdFils)
    approvalReasons.push(
      `refund ${formatAed(refundFils)} is above the ${formatAed(c.refundThresholdFils)} approval threshold`,
    );
  return {
    depositFils: c.depositFils,
    items,
    deductionsFils,
    refundFils,
    owedFils: total - deductionsFils,
    approvalReasons,
  };
}

/** The deposit statement as a helper run (recorded in `helper_runs`); an unknown item goes to a person. */
export const exitDepositHelper: Helper<ExitDepositContext, ExitDepositData> = {
  name: "exit_deposit",
  async run(input) {
    const c = input.context;
    let data: ExitDepositData;
    try {
      data = computeStatement(c);
    } catch (e) {
      return { status: "needs_human", reasons: [e instanceof Error ? e.message : String(e)], sourceDocIds: [] };
    }
    return {
      status: "ok",
      data,
      reasons: [
        data.items.length
          ? `${data.items.length} confirmed item(s) total ${formatAed(data.deductionsFils + data.owedFils)} at company prices.`
          : "No damage confirmed: the full deposit is refunded.",
        ...(data.owedFils
          ? [`${formatAed(data.owedFils)} is beyond the deposit; a manager decides whether to claim it.`]
          : []),
        ...data.approvalReasons.map((r) => `Finance must approve: ${r}.`),
      ],
      sourceDocIds: [],
    };
  },
};

export const ExitDepositSchemas = { context: ExitDepositContext, data: ExitDepositData };

/**
 * Compares one room's move-in and move-out photos with the local vision model (D29). Suggestions
 * only: an item id the price list doesn't have, `none`, or a confidence below the policy threshold
 * is dropped, and the model never gives an amount. Retried once if the answer doesn't parse; then
 * a person compares the photos.
 */
export function roomComparisonHelper(
  llm: Llm,
  readImage: (docId: string) => Promise<Uint8Array>,
): Helper<RoomComparisonContext, RoomComparisonData> {
  return {
    name: "exit_compare",
    async run(input) {
      const c = input.context;
      const sourceDocIds = [...c.moveInDocIds, ...c.moveOutDocIds];
      let images: Uint8Array[];
      try {
        images = await Promise.all(sourceDocIds.map(readImage));
      } catch {
        return { status: "needs_human", reasons: ["a photo file is missing"], sourceDocIds };
      }
      const prompt = comparePrompt(c.room, c.moveInDocIds.length, c.moveOutDocIds.length, c.priceList);
      let read: VisionComparison | null = null;
      let error = "";
      for (let attempt = 0; attempt < 2 && !read; attempt++) {
        try {
          const parsed = VisionComparison.safeParse(await llm.vision(images, prompt, VisionComparison));
          if (parsed.success) read = parsed.data;
          else error = "the comparison didn't have the expected fields";
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
      }
      if (!read) {
        return {
          status: "needs_human",
          reasons: [`no usable comparison for the ${c.room.toLowerCase()} (${error}); compare the photos yourself`],
          sourceDocIds,
        };
      }
      const labels = new Map(c.priceList.map((p) => [p.id, p.label]));
      const suggestions: Suggestion[] = read.differences
        .filter((d) => labels.has(d.itemId) && d.confidence >= c.minConfidence)
        .map((d) => ({
          room: c.room,
          itemId: d.itemId,
          label: labels.get(d.itemId)!,
          quantity: d.quantity,
          description: d.description,
          confidence: d.confidence,
        }));
      const dropped = read.differences.length - suggestions.length;
      return {
        status: "ok",
        data: { room: c.room, suggestions, dropped },
        reasons: [
          suggestions.length
            ? `${suggestions.length} possible difference(s) in the ${c.room.toLowerCase()}; an officer confirms or ignores each.`
            : `No clear damage seen in the ${c.room.toLowerCase()}.`,
          ...(dropped ? [`${dropped} uncertain observation(s) left out; check the photos side by side.`] : []),
        ],
        sourceDocIds,
        model: {
          name: "vision",
          ...(suggestions.length ? { confidence: Math.min(...suggestions.map((s) => s.confidence)) } : {}),
        },
      };
    },
  };
}

export const RoomComparisonSchemas = { context: RoomComparisonContext, data: RoomComparisonData };
