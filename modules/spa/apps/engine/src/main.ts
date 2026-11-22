import { resolve } from "node:path";
import { LocalDiskStore, NodemailerMailer } from "@platform/adapters";
import { assertLocalModel, OllamaLlm } from "@platform/llm";
import { ollamaChatModel } from "@platform/llm/agent";
import { loadSpaEnv, sessionSecret } from "@spa/core/env";
import { createSpaDatabase } from "@spa/db";
import { createApp } from "./app.ts";
import { SpaDemoClock } from "./clock.ts";
import { createBoss, startJobs } from "./jobs.ts";
import { failClosedFacts } from "./manager/facts.ts";
import { expirePermits } from "./manager/listings.ts";
import { enqueueOnDealEntered, screenDeal } from "./manager/aml-screening.ts";
import type { SpaContext } from "./manager/context.ts";
import { checkOllamaUrl } from "./ollama-url.ts";
import { screeningAdapterFor } from "./screening.ts";
import { registryAdapterFor } from "./registry-adapter.ts";
import { onRegistryFixReleased, onRegistryGateApproved, proposeOnDealEntered } from "./manager/registry.ts";
import { runRegistry } from "./manager/registry-run.ts";
import { SpaDomainError } from "./manager/errors.ts";
import type { RegistrySubmitData } from "./jobs.ts";
import { runCompanyCheck } from "./manager/company-check.ts";
import { runKyc } from "./manager/kyc.ts";
import { runOwnershipCheck } from "./manager/ownership-check.ts";
import { readDocument } from "./manager/readers.ts";
import { readTemplateUpload } from "./manager/template-uploads.ts";
import { nocExpirySweep } from "./manager/noc.ts";
import { remindInstalments } from "./manager/collections.ts";
import { defaultCheck } from "./manager/default.ts";
import { expireOffers } from "./manager/offers.ts";
import { runPrepareJob } from "./manager/prepare.ts";
import { queueAgreementReview, runAgreementReview } from "./manager/agreement-review.ts";
import { chaseDeal, chaseSweep } from "./manager/chase.ts";
import { enqueueSigningOnEntered, finishSigning, inviteSigners, remindSigner } from "./manager/signing.ts";
import { runAlerts } from "./manager/alerts.ts";
import { generateMonthlyReport } from "./manager/compliance-report.ts";
import { runRetentionReview } from "./manager/retention.ts";

/** The SPA engine process (:4001). Reads only `.env.spa.local` (S25); stops at once if a key is missing. */
const env = loadSpaEnv();
const database = createSpaDatabase(env.SPA_DATABASE_URL);
const clock = new SpaDemoClock(database, env.SPA_DEMO_MODE);
await clock.refresh();
// Content-addressed files under data/ (ignored by git); never leasing's data/uploads.
const documents = new LocalDiskStore(resolve(import.meta.dir, "../../../../data/spa-uploads"));
// KYC reads documents with a local vision model only (S25, rule 8); without one configured the jobs wait.
// The URL must name a local or private-network host: a public one is refused and the handlers don't start.
const ollamaCheck = env.OLLAMA_URL ? checkOllamaUrl(env.OLLAMA_URL) : null;
/** The model host check the platform adapter applies: the SPA allows its private-network hosts (S49 amendment). */
const allowOllamaHost = (host: string) => checkOllamaUrl(`http://${host}`).ok;
if (ollamaCheck && !ollamaCheck.ok)
  console.warn(`Model-backed jobs (KYC, readers, AML summaries) are not started. ${ollamaCheck.reason}`);
const llm =
  env.OLLAMA_URL && ollamaCheck?.ok && (env.SPA_VISION_MODEL || env.SPA_CHAT_MODEL)
    ? new OllamaLlm({
        url: env.OLLAMA_URL,
        chatModel: env.SPA_CHAT_MODEL,
        visionModel: env.SPA_VISION_MODEL,
        allowHost: allowOllamaHost,
      })
    : null;
if (!llm && (!ollamaCheck || ollamaCheck.ok))
  console.warn("KYC runs and document readers are waiting: set OLLAMA_URL and SPA_VISION_MODEL in .env.spa.local");
// Only demo mode has screening lists (invented ones); elsewhere no adapter is registered and facts fail closed (S50).
const screening = screeningAdapterFor(env);
// Every context the engine builds: the adapter's list version makes older screenings stale, and entering the agreement
// or transfer step queues a re-screening (the queue is read at call time, after it exists).
// Entering REGISTRATION or TRANSFER also proposes the sales admin's submission gate, and an approved gate queues its
// registry job once the decision has committed (S53).
// All outbound mail goes through this one mailer (rule 10, S54); the buyer pages are on the SPA web app.
const mailer = new NodemailerMailer({
  transport: env.MAIL_TRANSPORT,
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  user: env.SMTP_USER,
  pass: env.SMTP_PASS,
  from: env.SPA_MAIL_FROM,
  demoRecipient: env.SPA_DEMO_MODE ? env.SPA_MAIL_DEMO_RECIPIENT : undefined,
});
const mail = { mailer, webBaseUrl: (env.SPA_WEB_URL ?? `http://localhost:${env.SPA_WEB_PORT}`).replace(/\/$/, "") };
const context = (): SpaContext => ({
  database,
  clock,
  facts: failClosedFacts,
  amlListVersion: screening?.listVersion ?? null,
  mail,
  onDealEntered: async (e, tx) => {
    await enqueueOnDealEntered(context(), jobs.boss, e);
    await proposeOnDealEntered(context(), e, tx);
    await enqueueSigningOnEntered(context(), jobs.boss, e, tx);
  },
  onGateApproved: (e) => onRegistryGateApproved(context(), jobs.boss, e),
  // A released registry auto-fix queues its resubmission after the decision has committed (S59).
  onHelperReleased: (e) => onRegistryFixReleased(context(), jobs.boss, e),
});
// Only demo mode has a registry (the simulated one); elsewhere the submission jobs wait and facts stay closed (S53).
const registry = registryAdapterFor(env);
/** A refused gate or a deal that moved on is logged, not retried: the job's answer would be the same. */
// The decision model (if configured) only maps an unknown rejection message to a field (S56); without it such a
// rejection becomes a task. The model URL must be local, like the others.
const decisionLlm =
  env.OLLAMA_URL && ollamaCheck?.ok && env.SPA_DECISION_MODEL
    ? new OllamaLlm({ url: env.OLLAMA_URL, decisionModel: env.SPA_DECISION_MODEL, allowHost: allowOllamaHost })
    : null;
// The three assistants (C26, S61): the chat model with tools (SPA_ASSISTANT_MODEL, else SPA_CHAT_MODEL) and the decision model
// for the scope gate. What parties and visitors type is personal data, so the model must be local (rule 8); without one the
// assistant routes answer 503.
const assistantModel = env.SPA_ASSISTANT_MODEL || env.SPA_CHAT_MODEL;
let assistants: { model: ReturnType<typeof ollamaChatModel>; llm: typeof decisionLlm; tag: string } | undefined;
if (env.OLLAMA_URL && ollamaCheck?.ok && assistantModel) {
  try {
    assertLocalModel(env.OLLAMA_URL, assistantModel, "Assistant messages", allowOllamaHost);
    assistants = {
      model: ollamaChatModel({ url: env.OLLAMA_URL, model: assistantModel }),
      llm: decisionLlm,
      tag: assistantModel,
    };
  } catch (e) {
    console.warn(`Assistants are not started. ${e instanceof Error ? e.message : "model refused"}`);
  }
}
// The staff copilot (C36, S68) may have its own chat model (SPA_COPILOT_MODEL); empty means the assistants' model.
let copilot: typeof assistants;
if (env.SPA_COPILOT_MODEL && env.OLLAMA_URL && ollamaCheck?.ok) {
  try {
    assertLocalModel(env.OLLAMA_URL, env.SPA_COPILOT_MODEL, "Copilot messages", allowOllamaHost);
    copilot = {
      model: ollamaChatModel({ url: env.OLLAMA_URL, model: env.SPA_COPILOT_MODEL }),
      llm: decisionLlm,
      tag: env.SPA_COPILOT_MODEL,
    };
  } catch (e) {
    console.warn(`The copilot's own model is not started. ${e instanceof Error ? e.message : "model refused"}`);
  }
}
const submit = async (data: RegistrySubmitData) => {
  try {
    const r = await runRegistry(
      context(),
      { oqood: registry!, transfer: registry!, llm: decisionLlm, boss: jobs.boss },
      data,
    );
    if (r.outcome === "skipped") console.warn(`registry submission skipped (${r.reason})`);
  } catch (e) {
    if (e instanceof SpaDomainError) console.warn(`registry submission refused: ${e.message}`);
    else throw e;
  }
};
/** A job queued before its helper was switched off is answered, not retried: the agent already has the task (S59). */
const unlessOff =
  <A extends unknown[]>(fn: (...a: A) => Promise<unknown>) =>
  async (...a: A) => {
    try {
      return await fn(...a);
    } catch (e) {
      if (e instanceof SpaDomainError && e.code === "helper_off") return console.warn(`job skipped (${e.message})`);
      throw e;
    }
  };
const signingStore = { put: documents.put.bind(documents), read: documents.read.bind(documents) };
const jobs = await startJobs(createBoss(env.SPA_DATABASE_URL), clock, {
  permitSweep: () => expirePermits(context()),
  offerSweep: () => expireOffers(context()),
  nocSweep: () => nocExpirySweep(context()),
  // Compliance records and staff alerts (C23, S62): code only, no model. The retention job writes a list and deletes nothing.
  alerts: () => runAlerts(context()),
  retentionReview: () => runRetentionReview(context()),
  monthlyReport: () => generateMonthlyReport(context(), { store: documents }),
  // No model: code compares due dates, counted payments and the pinned policy (S55).
  defaultCheck: () => defaultCheck(context()),
  // No model: fixed reminder wording, amounts from the plan, dates from the Clock (S56).
  instalmentRemind: () => remindInstalments(context()),
  // The model (if any) only writes the summary. No adapter, no handler: the jobs wait and facts stay closed.
  ...(screening
    ? {
        amlScreen: (data: { dealId: string; trigger: string }) =>
          screenDeal(context(), { screening, llm }, { dealId: data.dealId, trigger: data.trigger as never }),
      }
    : {}),
  ...(registry ? { oqoodSubmit: submit, transferSubmit: submit } : {}),
  // Signing (S54): code only. A refused job (a closed envelope) is answered, not retried.
  signingInvite: (data: { envelopeId: string }) => inviteSigners(context(), data.envelopeId, jobs.boss),
  signingRemind: (data: { signatureId: string; n: number }) => remindSigner(context(), jobs.boss, data),
  signingFinish: (data: { envelopeId: string }) => finishSigning(context(), { store: signingStore }, data.envelopeId),
  // No model: code fills the approved template (S51).
  prepare: async (data: { dealId: string }) => {
    const r = await runPrepareJob(context(), { store: documents }, data);
    // A stored agreement is reviewed for legal (S60). The review is advice: a failure here never undoes the preparation.
    if (r.ok)
      await queueAgreementReview(context(), jobs.boss, r.agreementId).catch((e) =>
        console.error("agreement review not queued:", e instanceof Error ? e.message : e),
      );
    return r;
  },
  // Chasing (S60): fixed admin-approved templates filled by code, sent by email; no model.
  chaseSweep: () => chaseSweep(context(), jobs.boss),
  chase: (data: { dealId: string }) => chaseDeal(context(), data.dealId),
  // The review reads with the chat model only; without one its jobs wait and the card says it is in progress.
  ...(llm && env.SPA_CHAT_MODEL
    ? {
        agreementReview: unlessOff((data: { agreementId: string }) => runAgreementReview(context(), { llm }, data)),
      }
    : {}),
  ...(llm
    ? {
        // The readers (S52) read documents with the same local vision model; without one their jobs wait.
        documentRead: unlessOff((data: { documentId: string }) =>
          readDocument(context(), { llm, readFile: (key) => documents.read(key) }, data),
        ),
        // Sample agreements (C34, S66): the template reader with the SPA profile; stores a version and opens the legal gate.
        templateRead: (data: { uploadId: string }) =>
          readTemplateUpload(context(), { llm, readFile: (key) => documents.read(key) }, data),
        companyCheck: unlessOff((data: { dealId: string; partyId: string }) =>
          runCompanyCheck(context(), { llm, readFile: (key) => documents.read(key) }, data),
        ),
        ownershipCheck: unlessOff((data: { dealId: string }) =>
          runOwnershipCheck(context(), { llm, readFile: (key) => documents.read(key) }, data),
        ),
        kycRun: unlessOff((data: { dealId: string; partyId: string }) =>
          runKyc(context(), { llm, readFile: (key) => documents.read(key) }, data),
        ),
      }
    : {}),
});
const app = createApp({
  database,
  jobs,
  clock,
  sessionSecret: sessionSecret(env),
  demoMode: env.SPA_DEMO_MODE,
  documents,
  mail,
  portalSummaryKey: env.PORTAL_SUMMARY_KEY,
  portalPublicKey: env.SPA_PORTAL_PUBLIC_KEY,
  amlListVersion: screening?.listVersion ?? null,
  ...(assistants ? { assistants } : {}),
  ...(copilot ? { copilot } : {}),
  // Read-only tags for Settings → AI helpers (S25, S59): the settings screen never changes a model.
  models: {
    vision: env.SPA_VISION_MODEL,
    chat: env.SPA_CHAT_MODEL,
    decision: env.SPA_DECISION_MODEL,
    assistant: assistants?.tag,
    copilot: copilot?.tag ?? assistants?.tag,
  },
  // Statuses only for Settings → Integrations (S72); no address, host or key is passed.
  integrations: {
    email: env.MAIL_TRANSPORT === "smtp" ? "connected" : "simulated",
    registry: registry ? "simulated" : "not_set_up",
    models: llm ? "connected" : "not_set_up",
  },
  nowMs: () => Date.now(),
});

const server = Bun.serve({ port: env.SPA_ENGINE_PORT, hostname: "127.0.0.1", fetch: app.fetch });
console.log(`spa engine on http://127.0.0.1:${server.port}${env.SPA_DEMO_MODE ? " (demo mode)" : ""}`);

const stop = async () => {
  await server.stop();
  await jobs.stop();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
