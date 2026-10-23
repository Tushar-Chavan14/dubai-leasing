import { PgBoss } from "pg-boss";
import type { EngineContext, Scheduler } from "./context.ts";
import { APPLICATION_MAIL_JOB, type ApplicationMailKind, sendApplicationMail } from "./manager/applications.ts";
import {
  CONTRACT_FINISH_JOB,
  CONTRACT_PREPARE_JOB,
  DEFAULT_ADDENDUM,
  finishContract,
  prepareContract,
} from "./manager/contracts.ts";
import { INBOUND_JOB, processInbound } from "./manager/inbound.ts";
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
  opts: { onSweep?: () => Promise<void> } = {},
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

  await boss.createQueue(LEASE_MAIL_JOB, { policy: "exclusive", retryLimit: 4, retryDelay: 60, retryBackoff: true });
  await boss.createQueue(CONTRACT_PREPARE_JOB, { policy: "exclusive", retryLimit: 2, retryDelay: 30 });
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
  await boss.work<{ applicationId: string; kind: ApplicationMailKind; seq: number }>(
    APPLICATION_MAIL_JOB,
    async (jobs) => {
      for (const job of jobs) await sendApplicationMail(ctx, job.data.applicationId, job.data.kind, job.data.seq);
    },
  );
  await boss.work<LeaseMailJob>(LEASE_MAIL_JOB, async (jobs) => {
    for (const job of jobs) await sendLeaseMail(ctx, job.data);
  });
  await boss.work<{ leaseId: string }>(CONTRACT_PREPARE_JOB, async (jobs) => {
    for (const job of jobs)
      await prepareContract(ctx, job.data.leaseId, { addendum: DEFAULT_ADDENDUM, actor: "system", onlyIfNone: true });
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
  await boss.work<{ inboundEventId: string }>(INBOUND_JOB, async (jobs) => {
    for (const job of jobs) await processInbound(ctx, job.data.inboundEventId);
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
