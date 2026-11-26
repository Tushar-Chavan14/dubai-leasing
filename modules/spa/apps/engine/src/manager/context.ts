import type { Mailer } from "@platform/adapters";
import type { Clock } from "@platform/kernel/clock";
import type { SpaGateId } from "@spa/core";
import type { SpaDatabase, SpaTx } from "@spa/db";
import type { SalesRulebook } from "@spa/rulebook";
import type { FactsLoader } from "./facts.ts";
import type { HeldDecision } from "./helper-modes.ts";

/** Outbound mail (rule 10): the module's only channel to buyers, sellers and brokers (S54). */
export interface SpaMailConfig {
  mailer: Mailer;
  /** Where the buyer pages live, without a trailing slash: links in mail are `<webBaseUrl>/b/<token>/...`. */
  webBaseUrl: string;
  /** Minutes after which a `sending` mail that never finished may be claimed again (default 15). A `sent` one is final. */
  staleClaimMinutes?: number;
}

/** What SpaManager needs: the SPA database, the SPA Clock (never leasing's) and the facts its guards read. */
export interface SpaContext {
  database: SpaDatabase;
  clock: Clock;
  facts: FactsLoader;
  /** Looks a rulebook version up (default: the registry). Tests pass one with every value confirmed (S36). */
  /** The screening adapter's current list version, when one is registered (S50): older screenings count as stale. */
  amlListVersion?: string | null;
  /**
   * Called inside a deal step's transaction with the state the deal just entered, so the process can queue work
   * (re-screening before the agreement and before the transfer, S50). Its failure must not undo the step.
   */
  onDealEntered?: (e: { dealId: string; to: string }, tx: SpaTx) => Promise<void>;
  /**
   * Called after the transaction that approved a registry submission gate has committed (S53), so the process can queue
   * the submission job. Its failure must not undo the decision: the request route queues it again.
   */
  onGateApproved?: (e: { approvalId: string; gate: SpaGateId; dealId: string }) => Promise<void>;
  /**
   * Called after the transaction that released a held helper result has committed (S59): the process drives the deal and,
   * for the registry's auto-fix, queues the resubmission. Its failure must not undo the decision.
   */
  onHelperReleased?: (e: HeldDecision) => Promise<void>;
  /** Without it nothing can be emailed: offers and signing refuse (503) instead of showing a link to staff. */
  mail?: SpaMailConfig;
  rulebook?: (version: string) => SalesRulebook | null;
  /**
   * Keys the visitor's cancel link (S79): the link's token is an HMAC of the viewing id, so the invitation, the reminder
   * and the cancel page all agree without the raw token being stored (only its hash is). Without it nothing can be booked.
   */
  viewingLinkSecret?: string;
  /**
   * Queues one viewing email job (S79): `<viewingId>:<milestone>` is the job's singleton key. May run before the
   * caller's transaction has committed, so a job started from inside one passes a short `delaySeconds`. The delay is relative to the queue's own wall clock, never a date. Its failure
   * never undoes a booking: the mail is then sent at once instead.
   */
  queueViewingMail?: (e: {
    viewingId: string;
    milestone: ViewingMailMilestone;
    delaySeconds?: number;
  }) => Promise<void>;
}
export type ViewingMailMilestone = "invite" | "reminder" | "cancel";
