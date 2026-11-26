import type { Helper as KernelHelper, HelperInput as KernelHelperInput } from "@platform/kernel/helper";
import { z } from "zod";

/** The helper contract lives in the shared kernel (S4); leasing fixes the entity kinds to its own. */
export { HelperOutput, type HelperResult } from "@platform/kernel/helper";

export const EntityKind = z.enum(["unit", "application", "lease", "rulebook", "conversation", "company", "settings"]);
export type EntityKind = z.infer<typeof EntityKind>;

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export type HelperInput<C> = KernelHelperInput<C, EntityKind>;
export type Helper<C, D> = KernelHelper<C, D, EntityKind>;
