import { withTx } from "@leasing/db";
import { PgBoss } from "pg-boss";
import type { EngineContext, Scheduler } from "./context.ts";
import {
  APPLICATION_MAIL_JOB,
  type ApplicationMailKind,
  autoReleaseHeldOffer,
  HELD_OFFER_RELEASE_JOB,
  sendApplicationMail,
} from "./manager/applications.ts";
import {
  CONTRACT_FINISH_JOB,
  CONTRACT_PREPARE_JOB,
  defaultAddendumFor,
  finishContract,
  prepareContract,
  reportTemplateFailure,
} from "./manager/contracts.ts";
import {
  CONTRACT_STRUCTURE_JOB,
  CONTRACT_TEMPLATE_JOB,
  contractJobExpireSeconds,
  runContractStructure,
  runContractTemplateJob,
} from "./manager/contract-templates.ts";
import { INBOUND_JOB, processInbound } from "./manager/inbound.ts";
import { CHAT_CODE_JOB, sendChatCode } from "./manager/web-chat-status.ts";
import { LEASE_MAIL_JOB, type LeaseMailJob, sendLeaseMail } from "./manager/lease-mail.ts";
import { cancelEjari } from "./manager/deposit.ts";
import { DEADLINE_JOB, fireDeadline, sweepDueDeadlines } from "./manager/milestones.ts";
import { EJARI_CANCEL_JOB, EXIT_COMPARE_JOB, runComparison } from "./manager/move-out.ts";
import { NOTICE_SEND_JOB, sendRenewalNotice } from "./manager/outbound.ts";
import { EJARI_REVIEW_JOB, EJARI_SUBMIT_JOB, reviewEjariRejection, submitToEjari } from "./manager/registration.ts";

export const SWEEP_JOB = "deadline.sweep";

export function createBoss(databaseUrl: string): PgBoss {
  return new PgBoss({ connectionString: databaseUrl, schema: "pgboss" });
}

/** pg-boss scheduler: jobs are inserted through the caller's transaction (`db: tx.boss`). */
export function bossScheduler(boss: PgBoss): Scheduler {
  return {
    send: (tx, job) =>
      boss.send(job.name, job.data, {
        singletonKey: job.singletonKey,
        ...(job.startAfter ? { startAfter: job.startAfter } : {}),
        db: tx.boss,
      }),
  };
}

export async function startWorkers(
  boss: PgBoss,
  ctx: EngineContext,
  opts: { onSweep?: () => Promise<void>; backgroundModelTimeoutSeconds?: number } = {},
): Promise<void> {
  // `exclusive`: at most one queued or active job per singletonKey.
  await boss.createQueue(DEADLINE_JOB, { policy: "exclusive", retryLimit: 5, retryBackoff: true });
  await boss.createQueue(SWEEP_JOB, { policy: "exclusive" });
  // Mail can fail transiently; a sent notice is never resent (outbound_messages is the guard).
  await boss.createQueue(NOTICE_SEND_JOB, { policy: "exclusive", retryLimit: 4, retryDelay: 60, retryBackoff: true });
  await boss.createQueue(INBOUND_JOB, { policy: "exclusive", retryLimit: 3, retryDelay: 30, retryBackoff: true });
  await boss.createQueue(APPLICATION_MAIL_JOB, {
    policy: "exclusive",
    retryLimit: 4,
    retryDelay: 60,
    retryBackoff: true,
  });

  // Completed code jobs are deleted after an hour (the payload holds the code sealed, not readable).
  // A held offer nobody sent after N hours (switch `held_offer_auto_release`); the send re-checks the limits.
  await boss.createQueue(HELD_OFFER_RELEASE_JOB, {
    policy: "exclusive",
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
  });
  await boss.createQueue(CHAT_CODE_JOB, {
    policy: "exclusive",
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    deleteAfterSeconds: 3600,
  });
  await boss.createQueue(LEASE_MAIL_JOB, { policy: "exclusive", retryLimit: 4, retryDelay: 60, retryBackoff: true });
  await boss.createQueue(CONTRACT_PREPARE_JOB, { policy: "exclusive", retryLimit: 2, retryDelay: 30 });
  // The local chat model reads a sample contract; one attempt more if it is busy (a read error is stored as a status).
  // Its pg-boss expiry is longer than the code's own deadline and the model timeout, so the clear reason is stored first.
  const modelTimeout = opts.backgroundModelTimeoutSeconds ?? 300;
  await boss.createQueue(CONTRACT_TEMPLATE_JOB, {
    policy: "exclusive",
    retryLimit: 1,
    retryDelay: 60,
    expireInSeconds: contractJobExpireSeconds(modelTimeout),
  });
  // createQueue keeps an existing queue's settings; make an older install pick the new expiry up too.
  await boss.updateQueue(CONTRACT_TEMPLATE_JOB, { expireInSeconds: contractJobExpireSeconds(modelTimeout) });
  // Same local model reading the same sample: structure, blanks and look (slice 4).
  await boss.createQueue(CONTRACT_STRUCTURE_JOB, { policy: "exclusive", retryLimit: 1, retryDelay: 60 });
  await boss.createQueue(CONTRACT_FINISH_JOB, {
    policy: "exclusive",
    retryLimit: 4,
    retryDelay: 30,
    retryBackoff: true,
  });
  // The registry may be down: retried with backoff; `ejariMaxAttempts` (policy) decides when a person is told.
  await boss.createQueue(EJARI_SUBMIT_JOB, { policy: "exclusive", retryLimit: 9, retryDelay: 60, retryBackoff: true });
  await boss.createQueue(EJARI_REVIEW_JOB, { policy: "exclusive", retryLimit: 2, retryDelay: 30 });
  // Move-out (step 10): the local vision model compares a room; Ejari is cancelled once (retried while the registry is down).
  await boss.createQueue(EXIT_COMPARE_JOB, { policy: "exclusive", retryLimit: 1, retryDelay: 30 });
  await boss.createQueue(EJARI_CANCEL_JOB, { policy: "exclusive", retryLimit: 9, retryDelay: 60, retryBackoff: true });

  await boss.work<{ deadlineId: string }>(DEADLINE_JOB, async (jobs) => {
    for (const job of jobs) await fireDeadline(ctx, job.data.deadlineId);
  });
  await boss.work<{ approvalId: string }>(NOTICE_SEND_JOB, async (jobs) => {
    for (const job of jobs) await sendRenewalNotice(ctx, job.data.approvalId);
  });
  await boss.work<{ applicationId: string; kind: ApplicationMailKind; seq: number; variant?: string }>(
    APPLICATION_MAIL_JOB,
    async (jobs) => {
      for (const job of jobs)
        await sendApplicationMail(ctx, job.data.applicationId, job.data.kind, job.data.seq, job.data.variant);
    },
  );
  await boss.work<{ applicationId: string; revision: number }>(HELD_OFFER_RELEASE_JOB, async (jobs) => {
    for (const job of jobs) await autoReleaseHeldOffer(ctx, job.data.applicationId, job.data.revision);
  });
  await boss.work<{ verificationId: string; sealed: string }>(CHAT_CODE_JOB, async (jobs) => {
    for (const job of jobs) await sendChatCode(ctx, job.data.verificationId, job.data.sealed);
  });
  await boss.work<LeaseMailJob>(LEASE_MAIL_JOB, async (jobs) => {
    for (const job of jobs) await sendLeaseMail(ctx, job.data);
  });
  await boss.work<{ leaseId: string }>(CONTRACT_PREPARE_JOB, async (jobs) => {
    for (const job of jobs) {
      const addendum = await withTx(ctx.database, (tx) => defaultAddendumFor(tx, job.data.leaseId));
      try {
        await prepareContract(ctx, job.data.leaseId, { addendum, actor: "system", onlyIfNone: true });
      } catch (e) {
        if (!(await reportTemplateFailure(ctx, job.data.leaseId, e))) throw e;
      }
    }
  });
  await boss.work<{ documentId: string }>(CONTRACT_TEMPLATE_JOB, async (jobs) => {
    for (const job of jobs) await runContractTemplateJob(ctx, job.data.documentId, modelTimeout);
  });
  await boss.work<{ documentId: string; force?: boolean }>(CONTRACT_STRUCTURE_JOB, async (jobs) => {
    for (const job of jobs) await runContractStructure(ctx, job.data.documentId, job.data.force === true);
  });
  await boss.work<{ contractId: string }>(CONTRACT_FINISH_JOB, async (jobs) => {
    for (const job of jobs) await finishContract(ctx, job.data.contractId);
  });
  await boss.work<{ submissionId: string }>(EJARI_SUBMIT_JOB, async (jobs) => {
    for (const job of jobs) await submitToEjari(ctx, job.data.submissionId);
  });
  await boss.work<{ submissionId: string }>(EJARI_REVIEW_JOB, async (jobs) => {
    for (const job of jobs) await reviewEjariRejection(ctx, job.data.submissionId);
  });
  await boss.work<{ leaseId: string; room: string; seq: number }>(EXIT_COMPARE_JOB, async (jobs) => {
    for (const job of jobs) await runComparison(ctx, job.data);
  });
  await boss.work<{ leaseId: string }>(EJARI_CANCEL_JOB, async (jobs) => {
    for (const job of jobs) await cancelEjari(ctx, job.data.leaseId);
  });
  await boss.work<{ inboundEventId: string; attempt?: number }>(INBOUND_JOB, async (jobs) => {
    for (const job of jobs) await processInbound(ctx, job.data.inboundEventId, job.data.attempt ?? 1);
  });
  await boss.work(SWEEP_JOB, async () => {
    await opts.onSweep?.();
    await sweepDueDeadlines(ctx);
  });
  // Safety net in every mode: catch anything a missed job left behind.
  await boss.schedule(SWEEP_JOB, "5 * * * *", null, { tz: "Asia/Dubai", singletonKey: "hourly" });
}

export async function requestSweep(boss: PgBoss): Promise<void> {
  await boss.send(SWEEP_JOB, {}, { singletonKey: "sweep" });
}
