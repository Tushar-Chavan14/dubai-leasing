import { PgBoss } from "pg-boss";
import type { Clock } from "@platform/kernel";
import { startOfDubaiDay } from "@platform/kernel/dates";

/** Proves the SPA queue runs: a no-op job, at most one per Dubai day (S2; same singletonKey rule as D2). */
export const HEARTBEAT_JOB = "spa.heartbeat";
export const heartbeatKey = (today: string) => `engine:heartbeat:${today}`;

/** pg-boss in the `spa` database only, in its own `pgboss` schema (never leasing's queue). */
export function createBoss(databaseUrl: string): PgBoss {
  return new PgBoss({ connectionString: databaseUrl, schema: "pgboss" });
}

export interface Jobs {
  boss: PgBoss;
  /** When the last heartbeat job ran (wall clock), or null before the first. */
  lastHeartbeat(): Date | null;
  stop(): Promise<void>;
}

/** The daily advertising-permit sweep (S17, S38). */
export const PERMIT_EXPIRE_JOB = "spa.permit.expire";
/** The daily offer sweep (S18, S39). */
export const OFFER_EXPIRE_JOB = "spa.offer.expire";

/** The daily NOC sweep (S47): warns 7 days before a NOC expires and re-checks open ones. */
export const NOC_EXPIRY_JOB = "spa.noc.expiry";

/** Reads one party's documents (S49). One job per party and set of documents; the handler is safe to run twice. */
export const KYC_RUN_JOB = "spa.kyc.run";

/** Screens one deal's parties against the lists (S50). One job per deal, trigger and Dubai day; safe to run twice. */
export const AML_SCREEN_JOB = "spa.aml.screen";

/** Prepares one deal's agreement (S51). One job per deal and set of values; the handler is safe to run twice. */
export const AGREEMENT_PREPARE_JOB = "spa.prepare";

/** Reviews one prepared agreement for legal: flags only (S60). One job per agreement; key `<agreementId>:review`. */
export const AGREEMENT_REVIEW_JOB = "spa.agreement.review";

/**
 * Chasing parties (S60, C25): the daily sweep at 08:30 Dubai queues one `spa.chase` job per open deal (key
 * `<dealId>:chase:<date>`); each sends what is due from the admin-approved template. Safe to run twice (each chase is
 * recorded once per party, item and step).
 */
export const CHASE_SWEEP_JOB = "spa.chase.sweep";
export const CHASE_JOB = "spa.chase";
export const chaseSweepKey = (today: string) => `chase-sweep:${today}`;
export const chaseKey = (dealId: string, today: string) => `${dealId}:chase:${today}`;

/** Reads one uploaded document (S52). One job per document; the handler is safe to run twice. */
export const DOCUMENT_READ_JOB = "spa.document.read";

/**
 * Reads one uploaded sample agreement into a template version (C34, S66). One job per template and file hash (key
 * `<templateId>:<docHash>`); the handler is safe to run twice.
 */
export const TEMPLATE_READ_JOB = "spa.template.read";
export const templateReadKey = (templateId: string, docHash: string) => `${templateId}:${docHash}`;

/** Checks one company party's licence, signer and owners (S52). One job per party and set of documents. */
export const COMPANY_CHECK_JOB = "spa.company.check";

/** Checks a resale's ownership document against its sellers (S52). One job per deal and set of documents. */
export const OWNERSHIP_CHECK_JOB = "spa.ownership.check";

/**
 * Submits one approved Oqood registration (S53). The singleton key is `<dealId>:<kind>:<approvalId>`: one job per
 * approved gate; the handler is safe to run twice (one attempt per approval, the registry replays a request id).
 */
export const OQOOD_SUBMIT_JOB = "spa.oqood.submit";
/** Submits one approved resale transfer, trustee or Oqood (S53). Same key rule as the Oqood job. */
export const TRANSFER_SUBMIT_JOB = "spa.transfer.submit";

/** Emails every signer of an envelope their link (S54). One job per envelope; the handler is safe to run twice. */
export const SIGNING_INVITE_JOB = "spa.signing.invite";
/** Reminds one signer, every 48 hours until they sign (S54). Key `<signatureId>:remind:<n>`. */
export const SIGNING_REMIND_JOB = "spa.signing.remind";
/** Stamps and stores the signed PDF once everyone signed, then advances `ALL_SIGNED` (S54). Key `<envelopeId>:finish`. */
export const SIGNING_FINISH_JOB = "spa.signing.finish";

/**
 * Viewing emails (S79): the visitor's confirmation and the agent's "new viewing" (`invite`), the reminder 24 hours before
 * (`reminder`, queued with `startAfter`) and the cancellation notice (`cancel`). Key `<viewingId>:<milestone>`; the
 * handler is safe to run twice (each mail is claimed once per milestone, and a viewing that is no longer booked sends no reminder).
 */
export const VIEWING_MAIL_JOB = "spa.viewing.mail";
export const viewingMailKey = (viewingId: string, milestone: string) => `${viewingId}:${milestone}`;

/** The daily default check (S55): flags a deal whose dated instalment is overdue past the policy's days. Key `default-check:<date>`. */
export const DEFAULT_CHECK_JOB = "spa.default.check";
export const defaultCheckKey = (today: string) => `default-check:${today}`;

/**
 * The daily instalment reminders (S56, C21): emails buyers before and after a dated instalment is due and tasks an
 * overdue one. 08:00 Dubai time; key `instalments-remind:<date>`. Safe to run twice (each reminder is recorded once).
 */
export const INSTALMENT_REMIND_JOB = "spa.instalment.remind";
export const instalmentsRemindKey = (today: string) => `instalments-remind:${today}`;

/**
 * Staff alerts for waiting gates (S30, S62): hourly. One job per hour bucket (`alerts:<yyyy-mm-ddThh>`, UTC); each
 * (approval, level, user) is alerted once, so the handler is safe to run twice.
 */
export const ALERTS_JOB = "spa.alerts";
export const alertsKey = (now: Date) => `alerts:${now.toISOString().slice(0, 13)}`;

/**
 * Compliance records (S29, S62): the retention list on the 1st at 01:00 Dubai (key `retention:<yyyy-mm>`) and the
 * previous month's compliance report at 02:00 (key `report:<yyyy-mm>`). Both are safe to run twice: one list and one
 * report per month.
 */
export const RETENTION_REVIEW_JOB = "spa.retention.review";
export const MONTHLY_REPORT_JOB = "spa.report.monthly";
export const retentionKey = (today: string) => `retention:${today.slice(0, 7)}`;
export const reportKey = (today: string) => `report:${today.slice(0, 7)}`;

/** Dubai is UTC+4 all year (no daylight saving). */
const dubaiHour = (d: Date) => (d.getUTCHours() + 4) % 24;

export interface RegistrySubmitData {
  dealId: string;
  approvalId: string;
  kind: "oqood_register" | "oqood_transfer" | "trustee_transfer";
  /** Set on a retry after an "unavailable" answer (S56): the attempt to try again under its own request id. */
  retryAttempt?: number;
}

export async function startJobs(
  boss: PgBoss,
  clock: Clock,
  handlers: {
    permitSweep?: () => Promise<unknown>;
    offerSweep?: () => Promise<unknown>;
    nocSweep?: () => Promise<unknown>;
    defaultCheck?: () => Promise<unknown>;
    /** Hourly (S62). Without mail it still writes the in-app rows. */
    alerts?: () => Promise<unknown>;
    /** Monthly records (S62): no model, no mail. */
    retentionReview?: () => Promise<unknown>;
    monthlyReport?: () => Promise<unknown>;
    /** Needs mail (S56): without it the job isn't started. */
    instalmentRemind?: () => Promise<unknown>;
    /** Without it (no vision model configured) KYC jobs wait in the queue. */
    kycRun?: (data: { dealId: string; partyId: string; answers?: Record<string, string> }) => Promise<unknown>;
    amlScreen?: (data: { dealId: string; trigger: string }) => Promise<unknown>;
    prepare?: (data: { dealId: string }) => Promise<unknown>;
    /** Needs the chat model (S60): without one the review jobs wait in the queue and the card says so. */
    agreementReview?: (data: { agreementId: string }) => Promise<unknown>;
    /** Need mail (S60): without it the chase jobs aren't started. */
    chaseSweep?: () => Promise<unknown>;
    chase?: (data: { dealId: string }) => Promise<unknown>;
    /** The three readers need the vision model: without one their jobs wait in the queue (S52). */
    documentRead?: (data: { documentId: string }) => Promise<unknown>;
    companyCheck?: (data: { dealId: string; partyId: string }) => Promise<unknown>;
    ownershipCheck?: (data: { dealId: string }) => Promise<unknown>;
    /** Reads a sample agreement with the local vision model (C34); without one the jobs wait and the upload stays queued. */
    templateRead?: (data: { uploadId: string }) => Promise<unknown>;
    /** Without a registry adapter (outside demo mode) the submission jobs wait in the queue and facts stay closed (S53). */
    oqoodSubmit?: (data: RegistrySubmitData) => Promise<unknown>;
    transferSubmit?: (data: RegistrySubmitData) => Promise<unknown>;
    /** Without mail configured the signing jobs wait in the queue (S54). */
    signingInvite?: (data: { envelopeId: string }) => Promise<unknown>;
    signingRemind?: (data: { signatureId: string; n: number }) => Promise<unknown>;
    signingFinish?: (data: { envelopeId: string }) => Promise<unknown>;
    /** Needs mail (S79): without it the viewing mail jobs wait in the queue. */
    viewingMail?: (data: { viewingId: string; milestone: "invite" | "reminder" | "cancel" }) => Promise<unknown>;
  } = {},
): Promise<Jobs> {
  let last: Date | null = null;
  await boss.start();
  await boss.createQueue(PERMIT_EXPIRE_JOB, { policy: "exclusive" });
  await boss.work(PERMIT_EXPIRE_JOB, async () => {
    await handlers.permitSweep?.();
  });
  // Daily at 00:05 Dubai time, and once now (one per Dubai day) to catch up after downtime.
  await boss.schedule(PERMIT_EXPIRE_JOB, "5 0 * * *", {}, { tz: "Asia/Dubai" });
  await boss.send(PERMIT_EXPIRE_JOB, {}, { singletonKey: `permit-expire:${clock.today()}` });
  await boss.createQueue(OFFER_EXPIRE_JOB, { policy: "exclusive" });
  await boss.work(OFFER_EXPIRE_JOB, async () => {
    await handlers.offerSweep?.();
  });
  await boss.schedule(OFFER_EXPIRE_JOB, "10 0 * * *", {}, { tz: "Asia/Dubai" });
  await boss.send(OFFER_EXPIRE_JOB, {}, { singletonKey: `offer-expire:${clock.today()}` });
  await boss.createQueue(NOC_EXPIRY_JOB, { policy: "exclusive" });
  await boss.work(NOC_EXPIRY_JOB, async () => {
    await handlers.nocSweep?.();
  });
  await boss.schedule(NOC_EXPIRY_JOB, "15 0 * * *", {}, { tz: "Asia/Dubai" });
  await boss.send(NOC_EXPIRY_JOB, {}, { singletonKey: `noc-expiry:${clock.today()}` });
  await boss.createQueue(DEFAULT_CHECK_JOB, { policy: "exclusive" });
  await boss.work(DEFAULT_CHECK_JOB, async () => {
    await handlers.defaultCheck?.();
  });
  await boss.schedule(DEFAULT_CHECK_JOB, "20 0 * * *", {}, { tz: "Asia/Dubai" });
  await boss.send(DEFAULT_CHECK_JOB, {}, { singletonKey: defaultCheckKey(clock.today()) });
  await boss.createQueue(ALERTS_JOB, { policy: "exclusive" });
  const alerts = handlers.alerts;
  if (alerts) {
    await boss.work(ALERTS_JOB, async () => {
      await alerts();
    });
    await boss.schedule(ALERTS_JOB, "0 * * * *", {}, { tz: "Asia/Dubai" });
    // Once now to catch up after downtime; the same hour's key keeps it to one job.
    await boss.send(ALERTS_JOB, {}, { singletonKey: alertsKey(clock.now()) });
  }
  await boss.createQueue(RETENTION_REVIEW_JOB, { policy: "exclusive" });
  const retentionReview = handlers.retentionReview;
  if (retentionReview) {
    await boss.work(RETENTION_REVIEW_JOB, async () => {
      await retentionReview();
    });
    await boss.schedule(RETENTION_REVIEW_JOB, "0 1 1 * *", {}, { tz: "Asia/Dubai" });
    await boss.send(RETENTION_REVIEW_JOB, {}, { singletonKey: retentionKey(clock.today()) });
  }
  await boss.createQueue(MONTHLY_REPORT_JOB, { policy: "exclusive" });
  const monthlyReport = handlers.monthlyReport;
  if (monthlyReport) {
    await boss.work(MONTHLY_REPORT_JOB, async () => {
      await monthlyReport();
    });
    await boss.schedule(MONTHLY_REPORT_JOB, "0 2 1 * *", {}, { tz: "Asia/Dubai" });
    await boss.send(MONTHLY_REPORT_JOB, {}, { singletonKey: reportKey(clock.today()) });
  }
  await boss.createQueue(INSTALMENT_REMIND_JOB, { policy: "exclusive" });
  const instalmentRemind = handlers.instalmentRemind;
  if (instalmentRemind) {
    await boss.work(INSTALMENT_REMIND_JOB, async () => {
      await instalmentRemind();
    });
    await boss.schedule(INSTALMENT_REMIND_JOB, "0 8 * * *", {}, { tz: "Asia/Dubai" });
    // Once now to catch up after downtime, but never before 08:00 Dubai: a restart in the night sends no email.
    if (dubaiHour(clock.now()) >= 8)
      await boss.send(INSTALMENT_REMIND_JOB, {}, { singletonKey: instalmentsRemindKey(clock.today()) });
  }
  await boss.createQueue(CHASE_JOB, { policy: "exclusive" });
  await boss.createQueue(CHASE_SWEEP_JOB, { policy: "exclusive" });
  const chase = handlers.chase;
  const chaseSweep = handlers.chaseSweep;
  if (chase && chaseSweep) {
    await boss.work<{ dealId: string }>(CHASE_JOB, async (batch) => {
      for (const job of batch) await chase(job.data);
    });
    await boss.work(CHASE_SWEEP_JOB, async () => {
      await chaseSweep();
    });
    await boss.schedule(CHASE_SWEEP_JOB, "30 8 * * *", {}, { tz: "Asia/Dubai" });
    // Once now to catch up after downtime, but never before 08:30 Dubai: a restart in the night sends no email.
    const sinceDubaiMidnightMs = clock.now().getTime() - startOfDubaiDay(clock.today()).getTime();
    if (sinceDubaiMidnightMs >= (8 * 60 + 30) * 60_000)
      await boss.send(CHASE_SWEEP_JOB, {}, { singletonKey: chaseSweepKey(clock.today()) });
  }
  await boss.createQueue(AGREEMENT_REVIEW_JOB, { policy: "exclusive" });
  const agreementReview = handlers.agreementReview;
  if (agreementReview)
    await boss.work<{ agreementId: string }>(AGREEMENT_REVIEW_JOB, async (batch) => {
      for (const job of batch) await agreementReview(job.data);
    });
  await boss.createQueue(KYC_RUN_JOB, { policy: "exclusive" });
  const kycRun = handlers.kycRun;
  if (kycRun)
    await boss.work<{ dealId: string; partyId: string; answers?: Record<string, string> }>(
      KYC_RUN_JOB,
      async (batch) => {
        for (const job of batch) await kycRun(job.data);
      },
    );
  await boss.createQueue(AML_SCREEN_JOB, { policy: "exclusive" });
  const amlScreen = handlers.amlScreen;
  if (amlScreen)
    await boss.work<{ dealId: string; trigger: string }>(AML_SCREEN_JOB, async (batch) => {
      for (const job of batch) await amlScreen(job.data);
    });
  await boss.createQueue(AGREEMENT_PREPARE_JOB, { policy: "exclusive" });
  const prepare = handlers.prepare;
  if (prepare)
    await boss.work<{ dealId: string }>(AGREEMENT_PREPARE_JOB, async (batch) => {
      for (const job of batch) await prepare(job.data);
    });
  await boss.createQueue(DOCUMENT_READ_JOB, { policy: "exclusive" });
  const documentRead = handlers.documentRead;
  if (documentRead)
    await boss.work<{ documentId: string }>(DOCUMENT_READ_JOB, async (batch) => {
      for (const job of batch) await documentRead(job.data);
    });
  await boss.createQueue(TEMPLATE_READ_JOB, { policy: "exclusive" });
  const templateRead = handlers.templateRead;
  if (templateRead)
    await boss.work<{ uploadId: string }>(TEMPLATE_READ_JOB, async (batch) => {
      for (const job of batch) await templateRead(job.data);
    });
  await boss.createQueue(COMPANY_CHECK_JOB, { policy: "exclusive" });
  const companyCheck = handlers.companyCheck;
  if (companyCheck)
    await boss.work<{ dealId: string; partyId: string }>(COMPANY_CHECK_JOB, async (batch) => {
      for (const job of batch) await companyCheck(job.data);
    });
  await boss.createQueue(OWNERSHIP_CHECK_JOB, { policy: "exclusive" });
  const ownershipCheck = handlers.ownershipCheck;
  if (ownershipCheck)
    await boss.work<{ dealId: string }>(OWNERSHIP_CHECK_JOB, async (batch) => {
      for (const job of batch) await ownershipCheck(job.data);
    });
  await boss.createQueue(OQOOD_SUBMIT_JOB, { policy: "exclusive" });
  const oqoodSubmit = handlers.oqoodSubmit;
  if (oqoodSubmit)
    await boss.work<RegistrySubmitData>(OQOOD_SUBMIT_JOB, async (batch) => {
      for (const job of batch) await oqoodSubmit(job.data);
    });
  await boss.createQueue(TRANSFER_SUBMIT_JOB, { policy: "exclusive" });
  const transferSubmit = handlers.transferSubmit;
  if (transferSubmit)
    await boss.work<RegistrySubmitData>(TRANSFER_SUBMIT_JOB, async (batch) => {
      for (const job of batch) await transferSubmit(job.data);
    });
  await boss.createQueue(SIGNING_INVITE_JOB, { policy: "exclusive" });
  const signingInvite = handlers.signingInvite;
  if (signingInvite)
    await boss.work<{ envelopeId: string }>(SIGNING_INVITE_JOB, async (batch) => {
      for (const job of batch) await signingInvite(job.data);
    });
  await boss.createQueue(SIGNING_REMIND_JOB, { policy: "exclusive" });
  const signingRemind = handlers.signingRemind;
  if (signingRemind)
    await boss.work<{ signatureId: string; n: number }>(SIGNING_REMIND_JOB, async (batch) => {
      for (const job of batch) await signingRemind(job.data);
    });
  await boss.createQueue(SIGNING_FINISH_JOB, { policy: "exclusive" });
  const signingFinish = handlers.signingFinish;
  if (signingFinish)
    await boss.work<{ envelopeId: string }>(SIGNING_FINISH_JOB, async (batch) => {
      for (const job of batch) await signingFinish(job.data);
    });
  await boss.createQueue(VIEWING_MAIL_JOB, { policy: "exclusive" });
  const viewingMail = handlers.viewingMail;
  if (viewingMail)
    await boss.work<{ viewingId: string; milestone: "invite" | "reminder" | "cancel" }>(
      VIEWING_MAIL_JOB,
      async (batch) => {
        for (const job of batch) await viewingMail(job.data);
      },
    );
  await boss.createQueue(HEARTBEAT_JOB, { policy: "exclusive" });
  await boss.work(HEARTBEAT_JOB, async () => {
    last = clock.now();
  });
  // Safe to send twice: the exclusive queue keeps one queued or active job per key.
  await boss.send(HEARTBEAT_JOB, {}, { singletonKey: heartbeatKey(clock.today()) });
  return {
    boss,
    lastHeartbeat: () => last,
    stop: () => boss.stop({ graceful: true }),
  };
}
