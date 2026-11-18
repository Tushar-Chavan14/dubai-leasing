import { z } from "zod";

/** One line of the company's deduction price list (`companyPolicy.deductionPriceList`). */
export const PriceItem = z.object({
  id: z.string(),
  label: z.string(),
  unit: z.enum(["item", "room", "sqm"]),
  priceFils: z.number().int().positive(),
});
export type PriceItem = z.infer<typeof PriceItem>;

/**
 * A damage item an officer confirmed at the move-out inspection: a price-list item × a quantity,
 * or (`itemId: "other"`) a described amount that only finance can approve.
 */
export const Finding = z
  .object({
    id: z.string(),
    room: z.string().nullable(),
    itemId: z.string(),
    quantity: z.number().int().min(1).max(999),
    /** Only for `other`. */
    otherLabel: z.string().trim().min(3).max(120).optional(),
    otherAmountFils: z.number().int().positive().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((f) => f.itemId !== "other" || (!!f.otherLabel && !!f.otherAmountFils), {
    message: "an 'other' item needs a description and an amount",
  });
export type Finding = z.infer<typeof Finding>;

export const ExitDepositContext = z.object({
  leaseRef: z.string(),
  depositFils: z.number().int().min(0),
  refundThresholdFils: z.number().int().min(0),
  priceList: z.array(PriceItem).min(1),
  findings: z.array(Finding).max(100),
});
export type ExitDepositContext = z.infer<typeof ExitDepositContext>;

export const StatementItem = z.object({
  findingId: z.string(),
  room: z.string().nullable(),
  itemId: z.string(),
  label: z.string(),
  unit: z.enum(["item", "room", "sqm", "other"]),
  quantity: z.number().int().min(1),
  unitPriceFils: z.number().int().positive(),
  amountFils: z.number().int().positive(),
  fromPriceList: z.boolean(),
});
export type StatementItem = z.infer<typeof StatementItem>;

export const ExitDepositData = z.object({
  depositFils: z.number().int().min(0),
  items: z.array(StatementItem),
  /** Sum of the items, capped at the deposit. */
  deductionsFils: z.number().int().min(0),
  refundFils: z.number().int().min(0),
  /** Items beyond the deposit: a manager decides; never claimed automatically. */
  owedFils: z.number().int().min(0),
  /** Why the `refund` approval is needed before the tenant is answered (empty = finance confirms the payout only). */
  approvalReasons: z.array(z.string()),
});
export type ExitDepositData = z.infer<typeof ExitDepositData>;

/** One room: the move-in and move-out photos to compare, and the price-list items the model may name. */
export const RoomComparisonContext = z.object({
  room: z.string(),
  moveInDocIds: z.array(z.string()).min(1).max(3),
  moveOutDocIds: z.array(z.string()).min(1).max(3),
  priceList: z.array(PriceItem.pick({ id: true, label: true })).min(1),
  minConfidence: z.number().min(0).max(1),
});
export type RoomComparisonContext = z.infer<typeof RoomComparisonContext>;

/** What the vision model returns. Item ids are checked against the price list afterwards. */
export const VisionComparison = z.object({
  differences: z
    .array(
      z.object({
        description: z.string().max(300),
        itemId: z.string(),
        quantity: z.number().int().min(1).max(20),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(8),
});
export type VisionComparison = z.infer<typeof VisionComparison>;

export const Suggestion = z.object({
  room: z.string(),
  itemId: z.string(),
  label: z.string(),
  quantity: z.number().int().min(1),
  description: z.string(),
  confidence: z.number().min(0).max(1),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const RoomComparisonData = z.object({
  room: z.string(),
  suggestions: z.array(Suggestion),
  /** Differences the model saw but left below the confidence threshold or outside the price list. */
  dropped: z.number().int().min(0),
});
export type RoomComparisonData = z.infer<typeof RoomComparisonData>;
