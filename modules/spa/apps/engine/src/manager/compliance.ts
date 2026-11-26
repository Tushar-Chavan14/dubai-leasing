import { isComplianceRole, type SpaRole, rolesOf } from "@spa/core";
import { forbidden } from "./errors.ts";

/**
 * Every compliance route calls this first (S62): a compliance officer or the MLRO only. Admin is refused too (S57). The
 * answer is the plain 403 whatever the request was about, so a refusal never says whether a deal or a report exists.
 */
export function requireCompliance(user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined }): void {
  if (!isComplianceRole(rolesOf(user))) throw forbidden("you can't do this");
}
