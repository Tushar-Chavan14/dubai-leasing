import { createExchangeLimiter, issueToken, portalExchange, portalKeyOk } from "@platform/kernel";
import { castHint, DEMO_CAST, DEMO_SHORT_ROLE, isCastEmail, rolesOf, SPA_ROLE_LABELS, SpaRole } from "@spa/core";
import { type SpaDatabase, spaUsers } from "@spa/db";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { LocalDiskStore } from "@platform/adapters";
import { bodyLimit } from "hono/body-limit";
import { maskPii, maskPiiText } from "@platform/kernel/pii";
import { z } from "zod";
import { type AuthEnv, checkPassword, requireUser } from "./auth.ts";
import type { SpaDemoClock } from "./clock.ts";
import type { SpaContext } from "./manager/context.ts";
import { findActiveUser, takeHandoff } from "./manager/portal-sign-in.ts";
import { decideForSession, isDecisionBody } from "./manager/approvals.ts";
import {
  ApprovalsQuery,
  BadQuery,
  DealsQuery,
  EventsQuery,
  getApproval,
  getDealRecord,
  homeSummary,
  listApprovals,
  listDealEvents,
  listDeals,
  listTasks,
  TasksQuery,
} from "./manager/reads.ts";
import { type Jobs, VIEWING_MAIL_JOB, viewingMailKey } from "./jobs.ts";
import { companyKind } from "./manager/parties.ts";
import { SpaDomainError } from "./manager/errors.ts";
import { getLead, listLeads, listViewings } from "./manager/lead-reads.ts";
import { recordStaffLead } from "./manager/leads.ts";
import { updateLeadStatus } from "./manager/lead-status.ts";
import { publicBook, publicCancel, publicEnquiry, publicSlots } from "./manager/public-leads.ts";
import {
  bookViewingForLead,
  cancelViewingAs,
  freeSlotsForLead,
  recordViewingOutcome,
  rescheduleViewing,
} from "./manager/viewings.ts";
import { failClosedFacts } from "./manager/facts.ts";
import {
  confirmBankAmount,
  confirmNoc,
  type DocumentStore,
  MAX_DOCUMENT_BYTES,
  recordBankLetter,
  recordNoc,
  setDealUnit,
  setTargetTransferDate,
  uploadDocument,
} from "./manager/noc.ts";
import { enqueueAmlScreening, enqueueOnDealEntered, listAmlCases } from "./manager/aml-screening.ts";
import { enqueueKycRun, listKycRuns, requestDocuments, resendDocumentsLink } from "./manager/kyc.ts";
import { portalDocumentsPage, portalStatus, portalUpload, sendPortalDocuments } from "./manager/portal.ts";
import { enqueueCompanyCheck, listCompanyChecks } from "./manager/company-check.ts";
import { enqueueOwnershipCheck } from "./manager/ownership-check.ts";
import { enqueueDocumentRead, PROFILE_OF_KIND } from "./manager/readers.ts";
import { getSettlement, requestSettlementRefresh } from "./manager/settlement.ts";
import { launcherSummary } from "./manager/launcher.ts";
import { answerOffer, listOffers, makeOffer, offerLinkSummary, withdrawOffer } from "./manager/offers.ts";
import { quoteDeal, startDeal } from "./manager/deal-start.ts";
import { setBroker } from "./manager/brokers.ts";
import { recordDeposit } from "./manager/deposits.ts";
import { requireSales } from "./manager/leads.ts";
import { enqueuePrepare } from "./manager/prepare.ts";
import { pauseChasing, resumeChasing } from "./manager/chase.ts";
import { approveChaseTemplate, createChaseTemplate } from "./manager/chase-templates.ts";
import {
  listRegistrations,
  onRegistryFixReleased,
  onRegistryGateApproved,
  proposeOnDealEntered,
  requestRegistration,
} from "./manager/registry.ts";
import { setPaymentPlan } from "./manager/sheet.ts";
import {
  enqueueSigningOnEntered,
  listSigning,
  resendSigningLink,
  signingLinkDocument,
  signingLinkSummary,
  signWithLink,
} from "./manager/signing.ts";
import { unavailable } from "./manager/errors.ts";
import { clearDefaultFlag, recordPartyDefault } from "./manager/default.ts";
import { listEscrowAccounts, setEscrowAccount } from "./manager/escrow.ts";
import {
  confirmPayment,
  listPayments,
  recordMilestoneReached,
  registerPayment,
  setDealProject,
} from "./manager/payments.ts";
import { completeTask } from "./manager/tasks.ts";
import { getHelperSettings, type ModelTags, setHelperMode } from "./manager/helper-modes.ts";
import type { AssistantRuntime } from "./manager/assistants.ts";
import { runPartyAssistant } from "./manager/party-assistant.ts";
import { runListingChat } from "./manager/listing-chat.ts";
import { applyTemplateProposal, dismissTemplateProposal, runTemplateAssistant } from "./manager/template-assistant.ts";
import {
  cancelProposal,
  confirmProposal,
  copilotRulebook,
  copilotThread,
  DraftBody,
  getDraft,
  ProposalBody,
  RulebookQuery,
  runCopilotChat,
  storeDraft,
  storeProposal,
} from "./manager/copilot.ts";
import { nocStatus } from "./manager/noc-status.ts";
import type { Transport } from "@spa/copilot";
import {
  createListingDraft,
  readListingDocument,
  recordOwnershipAs,
  recordSignatureAs,
  stepListing,
  updateListing,
  uploadListingDocument,
} from "./manager/listings.ts";
import { getAlertSettings, listAlerts, markAlertRead, setAlertSettings } from "./manager/alerts.ts";
import { exportCasePack, listExports } from "./manager/case-export.ts";
import { downloadReport, listReports } from "./manager/compliance-report.ts";
import { CasesQuery, getCaseView, listCaseItems } from "./manager/compliance-cases.ts";
import { requireCompliance } from "./manager/compliance.ts";
import { approveRetentionReview, listRetentionReviews } from "./manager/retention.ts";
import {
  addBuilding,
  addUnit,
  createPriceList,
  createProject,
  getProject,
  listProjects,
  publishPriceList,
  updateProject,
  updateUnit,
} from "./manager/inventory.ts";
import { getUnit, listUnits } from "./manager/inventory-reads.ts";
import {
  addMedia,
  captionMedia,
  listMediaFor,
  readMedia,
  removeMedia,
  readPublicMedia,
  reorderMedia,
  MAX_MEDIA_BYTES,
} from "./manager/media.ts";
import { CatalogueQuery, MEDIA_OWNER_KINDS } from "@spa/core";
import { getCatalogueItem, listCatalogue } from "./manager/public-catalogue.ts";
import { createPublicLimiter } from "./manager/public-limit.ts";
import { getListing, listAgents, listListings, ListingsQuery } from "./manager/listing-reads.ts";
import { getTemplate, getTemplateVersion, listTemplates, previewTemplateVersion } from "./manager/template-reads.ts";
import { needTemplateAdmin, uploadTemplateSample } from "./manager/template-uploads.ts";
import { createTemplate, remapBlank } from "./manager/templates.ts";
import {
  getAmlPolicySettings,
  getKycSettings,
  publishKycSettings,
  putAmlPolicy,
  saveKycSettings,
} from "./manager/settings-screens.ts";
import {
  changeUser,
  getCompany,
  getIntegrations,
  getModels,
  getPolicyPage,
  getRulebookSettings,
  type IntegrationStates,
  listUsers,
  saveCompany,
  savePolicyPage,
  setDemoClock,
  type SettingsModelTags,
} from "./manager/settings-pages.ts";

export interface AppDeps {
  database: SpaDatabase;
  jobs: Pick<Jobs, "boss" | "lastHeartbeat">;
  clock: SpaDemoClock;
  sessionSecret: string;
  demoMode: boolean;
  /** Wall-clock time for session expiry (not a legal date). */
  nowMs: () => number;
  /** Where uploaded documents are stored (C15). Without it the upload route answers 503. */
  documents?: DocumentStore;
  /** Where marketing photos are stored (S75). Without it the photo routes answer 503. */
  media?: LocalDiskStore;
  /** Rulebook lookup for the settlement statement (default: the registry). Tests pass a confirmed copy. */
  rulebook?: SpaContext["rulebook"];
  /** The registered screening adapter's list version (S50); absent when none is registered. */
  amlListVersion?: string | null;
  /** Outbound mail (rule 10, S54). Without it offers and signing refuse (503). */
  mail?: SpaContext["mail"];
  /** The launcher's key (`PORTAL_SUMMARY_KEY`, S69). Unset: `GET /summary` answers 404, as a wrong key does. */
  portalSummaryKey?: string | undefined;
  /** The portal's public key (`SPA_PORTAL_PUBLIC_KEY`, S70). Unset: portal sign-in is off and its route answers 404. */
  portalPublicKey?: string | undefined;
  /** The model tags from the engine's environment, shown read-only in Settings → AI helpers (S25, S59). */
  models?: ModelTags & SettingsModelTags;
  /** Statuses for Settings → Integrations (S72): a status each, never an address or a key. Document storage follows `documents`. */
  integrations?: Omit<IntegrationStates, "documents">;
  /** The chat and decision models behind the three assistants (C26, S61). Without it their routes answer 503. */
  assistants?: AssistantRuntime;
  /** The staff copilot's models (C36, S68): SPA_COPILOT_MODEL, else the assistants'. Without either its chat answers 503. */
  copilot?: AssistantRuntime;
}

// Emails are stored lower case (a database check); sign-in matches whatever case is typed.
const email = () =>
  z
    .email()
    .max(200)
    .transform((e) => e.toLowerCase());
// Every read answer passes the PII mask once more on its way out (S57): a number that slipped into a view is still masked.
const reply = (c: { json: (b: unknown, s: 200) => Response }, data: unknown) => c.json(maskPii(data), 200);
const badQuery = (c: { json: (b: unknown, s: 400) => Response }) =>
  c.json({ error: "that query isn't valid", code: "invalid_request" }, 400);
const idParam = z.uuid();
const MediaOwnerQuery = z.object({ kind: z.enum(MEDIA_OWNER_KINDS), id: z.uuid() });
const MediaOrderBody = MediaOwnerQuery.extend({ ids: z.array(z.uuid()).max(100) });
const badBody = (c: { json: (b: unknown, s: 400) => Response }) =>
  c.json({ error: "write a message of up to 2,000 characters", code: "invalid_request" }, 400);
/** A KYC run may carry the answers typed on the role's form (S49 amendment); a body is optional. */
const KycRunBody = z.object({ answers: z.record(z.string(), z.string().max(500)).optional() });
const jsonBody = async (c: { req: { json: () => Promise<unknown> } }) => c.req.json().catch(() => null);
const PortalExchangeBody = z.object({ token: z.string().min(1).max(2000) });
const SignIn = z.object({ email: email(), password: z.string().min(1).max(200) });
const DemoSignIn = z.object({ email: email() });
/** What a person types to an assistant: one message, at most 2,000 characters. */
const AssistantBody = z.object({ text: z.string().trim().min(1).max(2000) });
/** The public listing chat adds a browser session id (so two visitors behind one address keep two conversations) and the consent box. */
const ListingChatBody = AssistantBody.extend({
  session: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[\w-]+$/),
  consent: z.boolean().default(false),
});

/**
 * The SPA engine API (S2: :4001, own database, jobs and clock). Routes are chained so the web app's `hc` client gets
 * their types from `SpaApp`.
 */
export function createApp(deps: AppDeps) {
  const { database, clock } = deps;
  const ctx: SpaContext = {
    database,
    clock,
    facts: failClosedFacts,
    amlListVersion: deps.amlListVersion ?? null,
    // Entering the agreement or transfer step queues a re-screening (S50); a down queue never undoes the step.
    // Entering REGISTRATION or TRANSFER proposes the sales admin's submission gate (S53).
    onDealEntered: async (e, tx) => {
      await enqueueOnDealEntered(ctx, deps.jobs.boss, e);
      await proposeOnDealEntered(ctx, e, tx);
      // Entering SIGNING opens the envelope in the same transaction and queues the invitations (S54).
      await enqueueSigningOnEntered(ctx, deps.jobs.boss, e, tx);
    },
    // An approved submission gate queues its job once the decision has committed (S53).
    onGateApproved: (e) => onRegistryGateApproved(ctx, deps.jobs.boss, e),
    // A released registry auto-fix queues its resubmission after the decision has committed (S59).
    onHelperReleased: (e) => onRegistryFixReleased(ctx, deps.jobs.boss, e),
    ...(deps.rulebook ? { rulebook: deps.rulebook } : {}),
    ...(deps.mail ? { mail: deps.mail } : {}),
    viewingLinkSecret: deps.sessionSecret,
    // Viewing emails go through the queue (S79); a down queue falls back to sending at once.
    queueViewingMail: async (e) => {
      await deps.jobs.boss.send(
        VIEWING_MAIL_JOB,
        { viewingId: e.viewingId, milestone: e.milestone },
        {
          singletonKey: viewingMailKey(e.viewingId, e.milestone),
          ...(e.delaySeconds ? { startAfter: e.delaySeconds } : {}),
        },
      );
    },
  };
  const signingStore = () => {
    const d = deps.documents;
    if (!d?.read) throw unavailable("storage_unavailable", "document storage isn't configured");
    return { put: d.put.bind(d), read: d.read.bind(d) };
  };
  // Exports and reports are built from, and kept in, the document store (C23): without one they answer 503.
  const exportStore = () => {
    const d = deps.documents;
    if (!d?.read) throw unavailable("storage_unavailable", "document storage isn't configured");
    return { put: d.put.bind(d), read: d.read.bind(d) };
  };
  const auth = requireUser(database, deps.sessionSecret, deps.nowMs);
  const exchangeLimiter = createExchangeLimiter();
  // The public catalogue reads are open to anyone: a generous limit per client (the page loads a photo per card).
  const publicLimiter = createPublicLimiter(600);
  // The public writes (enquiry, booking, cancel) are far fewer: a small limit per client, on top of the per-home and per-email caps.
  const writeLimiter = createPublicLimiter(20);
  const clientOf = (c: { req: { header(n: string): string | undefined } }) =>
    c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim().slice(0, 64) || "unknown";
  const tooMany = (c: { json: (b: unknown, s: 429) => Response }) =>
    c.json({ error: "too many requests, try again in a moment", code: "rate_limited" }, 429);
  const session = (u: {
    id: string;
    name: string;
    email: string;
    role: (typeof spaUsers.$inferSelect)["role"];
    extraRoles: (typeof spaUsers.$inferSelect)["extraRoles"];
  }) => ({
    token: issueToken(deps.sessionSecret, u.id, deps.nowMs()),
    user: { id: u.id, name: u.name, email: u.email, role: u.role, roles: rolesOf({ role: u.role, roles: u.extraRoles }) },
  });

  const app = new Hono<AuthEnv>()
    .get("/health", async (c) => {
      const db = await database.pool
        .query("select 1")
        .then(() => true)
        .catch(() => false);
      const jobs = await deps.jobs.boss
        .getQueue("spa.heartbeat")
        .then((q) => !!q)
        .catch(() => false);
      await clock.refresh().catch(() => {});
      const ok = db && jobs;
      return c.json(
        {
          ok,
          db,
          jobs,
          heartbeatAt: deps.jobs.lastHeartbeat()?.toISOString() ?? null,
          clock: { today: clock.today(), offsetDays: clock.offsetDays, demo: deps.demoMode },
        },
        ok ? 200 : 503,
      );
    })
    // The module chooser's counts (S69): two integers behind a shared key. No key set or a wrong key is one plain 404.
    .get("/summary", async (c) =>
      portalKeyOk(c.req.header("x-portal-key"), deps.portalSummaryKey)
        ? c.json(await launcherSummary(ctx))
        : c.json({ error: "not found", code: "not_found" }, 404),
    )
    .post("/api/auth/sign-in", async (c) => {
      const body = SignIn.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "enter your email and password", code: "invalid_request" }, 400);
      const [u] = await database.db.select().from(spaUsers).where(eq(spaUsers.email, body.data.email));
      const ok = await checkPassword(body.data.password, u?.active ? u.passwordHash : null);
      // One answer for a wrong email, a wrong password, an inactive user and a user without a password.
      if (!u || !ok) return c.json({ error: "wrong email or password", code: "unauthorised" }, 401);
      return c.json(session(u), 200);
    })
    // Portal sign-in (C38, S70): the portal says who the person is; the role comes only from this module's own row.
    .post("/api/auth/portal-exchange", async (c) => {
      const body = PortalExchangeBody.safeParse(await jsonBody(c));
      if (!body.success) return c.json({ error: "this sign-in link isn't valid", code: "unauthorised" }, 401);
      const r = await portalExchange(
        {
          publicKey: deps.portalPublicKey,
          audience: "spa",
          nowMs: deps.nowMs(),
          limiter: exchangeLimiter,
          takeJti: (jti) => takeHandoff(ctx, jti),
          findUser: (e) => findActiveUser(database, e),
        },
        { token: body.data.token, check: c.req.query("check") === "1", ip: c.req.header("x-client-ip") ?? "direct" },
      );
      if ("body" in r) return c.json(r.body, r.status);
      return r.kind === "check" ? c.json({ active: r.active }, 200) : c.json(session(r.user), 200);
    })
    // The public catalogue (S78): resale listings and developer units on sale, one allow-listed shape, no sign-in. A
    // listing's page reads the same shape (S17); the permit rule is checked on every read, not only by the daily sweep.
    .get("/public/catalogue", async (c) => {
      if (!publicLimiter.allow(`c:${clientOf(c)}`, deps.nowMs())) return tooMany(c);
      const q = CatalogueQuery.safeParse(c.req.query());
      if (!q.success) return badQuery(c);
      return c.json(await listCatalogue(ctx, q.data), 200);
    })
    .get("/public/catalogue/:ref", async (c) => {
      if (!publicLimiter.allow(`c:${clientOf(c)}`, deps.nowMs())) return tooMany(c);
      const p = await getCatalogueItem(ctx, c.req.param("ref"));
      return p ? c.json(p, 200) : c.json({ error: "not found", code: "not_found" }, 404);
    })
    // Free viewing times, enquiries and bookings for one public home (S79). A reference that isn't on the public site is one 404.
    .get("/public/catalogue/:ref/slots", async (c) => {
      if (!publicLimiter.allow(`c:${clientOf(c)}`, deps.nowMs())) return tooMany(c);
      return c.json(await publicSlots(ctx, c.req.param("ref")), 200);
    })
    .post("/public/catalogue/:ref/enquiries", bodyLimit({ maxSize: 8192 }), async (c) => {
      if (!writeLimiter.allow(`w:${clientOf(c)}`, deps.nowMs())) return tooMany(c);
      return c.json(await publicEnquiry(ctx, c.req.param("ref"), await jsonBody(c)), 201);
    })
    .post("/public/catalogue/:ref/viewings", bodyLimit({ maxSize: 8192 }), async (c) => {
      if (!writeLimiter.allow(`w:${clientOf(c)}`, deps.nowMs())) return tooMany(c);
      return c.json(await publicBook(ctx, c.req.param("ref"), await jsonBody(c)), 201);
    })
    // The visitor's emailed cancel link: the token is the only credential. The page asks first; this is the click.
    .post("/public/viewings/cancel", bodyLimit({ maxSize: 1024 }), async (c) => {
      if (!writeLimiter.allow(`w:${clientOf(c)}`, deps.nowMs())) return tooMany(c);
      const body = z.object({ token: z.string().min(1).max(200) }).safeParse(await jsonBody(c));
      if (!body.success) return c.json({ status: "not_found" }, 200);
      return c.json(await publicCancel(ctx, body.data.token), 200);
    })
    .get("/public/listings/:ref", async (c) => {
      if (!publicLimiter.allow(`c:${clientOf(c)}`, deps.nowMs())) return tooMany(c);
      const ref = c.req.param("ref");
      const p = ref.startsWith("U-") ? null : await getCatalogueItem(ctx, ref);
      return p ? c.json(p, 200) : c.json({ error: "not found", code: "not_found" }, 404);
    })
    // A photo of something public right now; any other id is a 404 (a withdrawn listing's photos stop at once).
    .get("/public/media/:id/file", async (c) => {
      if (!publicLimiter.allow(`m:${clientOf(c)}`, deps.nowMs())) return tooMany(c);
      const id = idParam.safeParse(c.req.param("id"));
      if (!deps.media || !id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const f = await readPublicMedia(ctx, deps.media, id.data);
      if (!f) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.body(f.bytes, 200, {
        "content-type": f.mime,
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      });
    })
    // A seller's single-use offer link (S18, S39): the terms only, no names; the answer goes through SpaManager.
    .get("/public/offer-links/:token", async (c) => {
      const s = await offerLinkSummary(ctx, c.req.param("token"));
      return s ? c.json(s, 200) : c.json({ error: "not found", code: "not_found" }, 404);
    })
    .post("/public/offer-links/:token/answer", async (c) => {
      const body = z.object({ answer: z.enum(["accept", "reject"]) }).safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "answer accept or reject", code: "invalid_request" }, 400);
      const r = await answerOffer(ctx, c.req.param("token"), body.data.answer);
      return c.json({ status: r.status }, 200);
    })
    // A signer's single-use link (S54): read the approved agreement, then sign by typing the name as written.
    .get("/public/sign-links/:token", async (c) => {
      const r = await signingLinkSummary(ctx, c.req.param("token"));
      return r ? c.json(r, 200) : c.json({ error: "not found", code: "not_found" }, 404);
    })
    .get("/public/sign-links/:token/document", async (c) => {
      const bytes = await signingLinkDocument(ctx, { store: signingStore() }, c.req.param("token"));
      return c.body(bytes as never, 200, {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="agreement.pdf"',
        "cache-control": "no-store",
      });
    })
    .post("/public/sign-links/:token/sign", bodyLimit({ maxSize: 4096 }), async (c) => {
      const body = z
        .object({ typedName: z.string().min(1).max(200), consent: z.literal(true) })
        .safeParse(await c.req.json().catch(() => null));
      if (!body.success)
        return c.json({ error: "type your full name and confirm consent", code: "invalid_request" }, 400);
      const ip = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim().slice(0, 64) || null;
      const r = await signWithLink(ctx, deps.jobs.boss, c.req.param("token"), body.data, {
        ip,
        userAgent: c.req.header("user-agent")?.slice(0, 300) ?? null,
      });
      return c.json(r, 200);
    })
    // The listing page chat (C26, S61): public, one published listing with a valid permit, rate-limited, enquiries only.
    .post("/public/listings/:ref/chat", bodyLimit({ maxSize: 8192 }), async (c) => {
      const body = ListingChatBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success)
        return c.json({ error: "write a message of up to 2,000 characters", code: "invalid_request" }, 400);
      if (!deps.assistants) throw unavailable("assistant_unavailable", "the assistant isn't available");
      // The web route sends one bucket; if more arrive, the last hop is the one a trusted proxy added.
      const client = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim().slice(0, 64) || "unknown";
      const r = await runListingChat(ctx, deps.assistants, {
        ref: c.req.param("ref"),
        text: body.data.text,
        consent: body.data.consent,
        client,
        session: body.data.session,
      });
      if (!r) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json({ reply: r.reply, kind: r.kind, verified: r.verified, unverified: r.unverified }, 200);
    })
    // The buyer and seller portal (C35, S67). The token is the only credential and fixes the deal, the person and the
    // purpose: a `documents` link uploads and sends, a `view` link only reads. Unknown or wrong-purpose tokens are one 404.
    .get("/public/portal/:token/documents", async (c) =>
      c.json(await portalDocumentsPage(ctx, c.req.param("token")), 200),
    )
    .post(
      "/public/portal/:token/documents",
      bodyLimit({
        maxSize: MAX_DOCUMENT_BYTES + 100_000,
        onError: (c) =>
          c.json({ error: "The file is too large. Please use one up to 10 MB.", code: "invalid_file" }, 413),
      }),
      async (c) => {
        if (!deps.documents) return c.json({ error: "uploads are not configured", code: "unavailable" }, 503);
        const form = await c.req.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) return c.json({ error: "send a file and its kind", code: "invalid_request" }, 400);
        // Whose document it is comes from the token alone: a `partyId` in the form is never read.
        const r = await portalUpload(ctx, deps.jobs.boss, deps.documents, c.req.param("token"), {
          kind: form?.get("kind"),
          fileName: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
        return c.json(r, 201);
      },
    )
    .post("/public/portal/:token/documents/send", async (c) =>
      c.json(await sendPortalDocuments(ctx, deps.jobs.boss, c.req.param("token")), 200),
    )
    .get("/public/portal/:token/status", async (c) => c.json(await portalStatus(ctx, c.req.param("token")), 200))
    // The party portal assistant (C26, S61): the token is the only credential; it reads that deal and party and nothing else.
    .post("/public/party/:token/assistant", bodyLimit({ maxSize: 8192 }), async (c) => {
      const body = AssistantBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success)
        return c.json({ error: "write a message of up to 2,000 characters", code: "invalid_request" }, 400);
      if (!deps.assistants) throw unavailable("assistant_unavailable", "the assistant isn't available");
      const r = await runPartyAssistant(ctx, deps.assistants, { token: c.req.param("token"), text: body.data.text });
      if (!r) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json({ reply: r.reply, kind: r.kind, verified: r.verified, unverified: r.unverified }, 200);
    })
    .get("/api/auth/demo-users", async (c) => {
      if (!deps.demoMode) return c.json({ error: "not found", code: "not_found" }, 404);
      const rows = await database.db
        .select({ email: spaUsers.email, name: spaUsers.name, role: spaUsers.role })
        .from(spaUsers)
        .where(eq(spaUsers.active, true))
        .orderBy(asc(spaUsers.role));
      // M5b (S80): the cast shows up front; everyone else sits in the sign-in page's back-office disclosure.
      const users = rows.map((r) => ({
        ...r,
        roleLabel: SPA_ROLE_LABELS[r.role],
        shortRole: DEMO_SHORT_ROLE[r.role],
        cast: isCastEmail(r.email),
        hint: castHint(r.role),
      }));
      const order = (u: { email: string; cast: boolean }) => {
        const i = DEMO_CAST.findIndex((m) => m.email === u.email);
        return u.cast ? i : DEMO_CAST.length;
      };
      return c.json(
        users.toSorted((a, b) => order(a) - order(b)),
        200,
      );
    })
    // M5b (S80): who a demo presenter switches to for a step that waits on a role. Demo mode only; no gate or role changes.
    .get("/api/demo/handoff", async (c) => {
      if (!deps.demoMode) return c.json({ error: "not found", code: "not_found" }, 404);
      const role = SpaRole.safeParse(c.req.query("role"));
      if (!role.success) return c.json({ error: "choose a role", code: "invalid_request" }, 400);
      const rows = await database.db
        .select({ email: spaUsers.email, name: spaUsers.name })
        .from(spaUsers)
        .where(and(eq(spaUsers.role, role.data), eq(spaUsers.active, true)))
        .orderBy(asc(spaUsers.name), asc(spaUsers.email));
      const pick = rows.find((r) => isCastEmail(r.email)) ?? rows[0];
      return c.json(pick ? { name: pick.name, email: pick.email, roleLabel: DEMO_SHORT_ROLE[role.data] } : null, 200);
    })
    .post("/api/auth/demo-sign-in", async (c) => {
      if (!deps.demoMode) return c.json({ error: "not found", code: "not_found" }, 404);
      const body = DemoSignIn.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "choose a demo user", code: "invalid_request" }, 400);
      const [u] = await database.db.select().from(spaUsers).where(eq(spaUsers.email, body.data.email));
      if (!u?.active) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(session(u), 200);
    })
    .get("/api/me", auth, async (c) => {
      const u = c.get("user");
      return c.json({ ...u, roleLabel: SPA_ROLE_LABELS[u.role], companyKind: await companyKind(database.db) }, 200);
    })
    // C15 (S47): documents, the target transfer date, the NOC and bank letters. Roles are checked by SpaManager.
    .post(
      "/api/deals/:id/documents",
      auth,
      bodyLimit({
        maxSize: MAX_DOCUMENT_BYTES + 100_000,
        onError: (c) => c.json({ error: "the file is too large", code: "invalid_file" }, 413),
      }),
      async (c) => {
        if (!deps.documents) return c.json({ error: "uploads are not configured", code: "unavailable" }, 503);
        const id = idParam.safeParse(c.req.param("id"));
        const form = await c.req.formData().catch(() => null);
        const file = form?.get("file");
        if (!id.success || !(file instanceof File))
          return c.json({ error: "send a file and its kind", code: "invalid_request" }, 400);
        const partyId = form?.get("partyId");
        const r = await uploadDocument(
          ctx,
          deps.documents,
          id.data,
          {
            kind: form?.get("kind"),
            fileName: file.name,
            bytes: new Uint8Array(await file.arrayBuffer()),
            ...(typeof partyId === "string" && partyId ? { partyId } : {}),
          },
          c.get("user"),
        );
        // A readable document is queued for the reader (S52). A queue that is down never loses the upload.
        if (PROFILE_OF_KIND[(form?.get("kind") as never) ?? ("" as never)])
          await enqueueDocumentRead(ctx, deps.jobs.boss, r.id).catch((e) => {
            // Off for this kind (S59): the agent has a task and the upload stands; nothing to log.
            if (!(e instanceof SpaDomainError && e.code === "helper_off"))
              console.error("document read not queued:", e instanceof Error ? e.message : e);
          });
        return c.json(r, 201);
      },
    )
    // C24 (S59): how each switchable helper runs. An admin edits; a sales manager reads. Models are shown, never set.
    // The template assistant (C26, S61): admin and legal. It stores proposals; only an admin's click applies one.
    .post("/api/template-assistant", auth, bodyLimit({ maxSize: 8192 }), async (c) => {
      const body = AssistantBody.extend({ versionId: z.uuid() }).safeParse(await c.req.json().catch(() => null));
      if (!body.success) return badBody(c);
      if (!deps.assistants) throw unavailable("assistant_unavailable", "the assistant isn't available");
      const r = await runTemplateAssistant(ctx, deps.assistants, {
        versionId: body.data.versionId,
        text: body.data.text,
        user: c.get("user"),
      });
      return c.json(
        { reply: r.reply, kind: r.kind, verified: r.verified, unverified: r.unverified, proposals: r.proposals },
        200,
      );
    })
    .post("/api/template-proposals/:id/apply", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return badQuery(c);
      await applyTemplateProposal(ctx, id.data, c.get("user"));
      return c.json({ status: "applied" }, 200);
    })
    .post("/api/template-proposals/:id/dismiss", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return badQuery(c);
      await dismissTemplateProposal(ctx, id.data, c.get("user"));
      return c.json({ status: "dismissed" }, 200);
    })
    // C36 (S68): the staff copilot. It reads through the routes above as the signed-in user, stores proposals and drafts,
    // and a proposal runs only when the same user posts its confirm. Nothing here approves, sends, signs or edits settings.
    .post("/api/copilot/chat", auth, bodyLimit({ maxSize: 8192 }), async (c) => {
      const body = AssistantBody.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return badBody(c);
      const runtime = deps.copilot ?? deps.assistants;
      if (!runtime) throw unavailable("assistant_unavailable", "the copilot isn't available");
      const authorization = c.req.header("authorization") ?? "";
      const transport =
        (threadId: string): Transport =>
        async ({ method, path, body: payload }) => {
          // The tools' reads and stores go through this app's own routes with the user's own session, so each route's role
          // filter applies. The thread is added here, never chosen by the model.
          const res = await app.fetch(
            new Request(`http://copilot.local${path}`, {
              method,
              headers: { authorization, "content-type": "application/json" },
              ...(method === "POST" ? { body: JSON.stringify({ ...payload, threadId }) } : {}),
            }),
          );
          return { status: res.status, body: await res.json().catch(() => null) };
        };
      return reply(c, await runCopilotChat(ctx, runtime, { user: c.get("user"), text: body.data.text, transport }));
    })
    .get("/api/copilot/thread", auth, async (c) => reply(c, await copilotThread(ctx, c.get("user"))))
    .get("/api/copilot/rulebook", auth, async (c) => {
      const q = RulebookQuery.safeParse(c.req.query());
      if (!q.success) return badQuery(c);
      return reply(c, await copilotRulebook(ctx, q.data));
    })
    .post("/api/copilot/proposals", auth, bodyLimit({ maxSize: 8192 }), async (c) => {
      const body = ProposalBody.safeParse(await jsonBody(c));
      if (!body.success) return c.json({ error: "that proposal isn't valid", code: "invalid_request" }, 400);
      return c.json(await storeProposal(ctx, c.get("user"), body.data), 201);
    })
    .post("/api/copilot/proposals/:id/confirm", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await confirmProposal(ctx, deps.jobs.boss, id.data, c.get("user")));
    })
    .post("/api/copilot/proposals/:id/cancel", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await cancelProposal(ctx, id.data, c.get("user")));
    })
    .post("/api/copilot/drafts", auth, bodyLimit({ maxSize: 8192 }), async (c) => {
      const body = DraftBody.safeParse(await jsonBody(c));
      if (!body.success) return c.json({ error: "that draft isn't valid", code: "invalid_request" }, 400);
      return c.json(await storeDraft(ctx, c.get("user"), body.data), 201);
    })
    .get("/api/copilot/drafts/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await getDraft(ctx, c.get("user"), id.data));
    })
    .get("/api/deals/:id/noc-status", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await nocStatus(ctx, id.data, c.get("user")));
    })
    // C34 (S66): templates. Admin writes, legal and a sales manager read, legal decides in the inbox. The manager checks
    // the role before it looks at an id or a body, so a refusal never says whether a template exists.
    .get("/api/templates", auth, async (c) => reply(c, await listTemplates(ctx, c.get("user"))))
    .post("/api/templates", auth, async (c) => c.json(await createTemplate(ctx, await jsonBody(c), c.get("user")), 201))
    .get("/api/templates/:id", auth, async (c) => reply(c, await getTemplate(ctx, c.get("user"), c.req.param("id"))))
    .post(
      "/api/templates/:id/versions",
      auth,
      bodyLimit({
        maxSize: MAX_DOCUMENT_BYTES + 100_000,
        onError: (c) => c.json({ error: "the file is too large", code: "invalid_file" }, 413),
      }),
      async (c) => {
        const user = c.get("user");
        needTemplateAdmin(user);
        if (!deps.documents) return c.json({ error: "uploads are not configured", code: "unavailable" }, 503);
        const form = await c.req.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) return c.json({ error: "send a PDF file", code: "invalid_request" }, 400);
        const r = await uploadTemplateSample(
          ctx,
          { store: deps.documents, boss: deps.jobs.boss },
          c.req.param("id"),
          { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), noRealData: form?.get("noRealData") },
          user,
        );
        return c.json(r, 202);
      },
    )
    .get("/api/template-versions/:id", auth, async (c) =>
      reply(c, await getTemplateVersion(ctx, c.get("user"), c.req.param("id"))),
    )
    .get("/api/template-versions/:id/preview", auth, async (c) => {
      const bytes = await previewTemplateVersion(ctx, c.get("user"), c.req.param("id"));
      return c.body(bytes as never, 200, {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="sample-preview.pdf"',
        "cache-control": "no-store",
      });
    })
    .post("/api/template-versions/:id/blanks/:blankId/remap", auth, async (c) => {
      const user = c.get("user");
      needTemplateAdmin(user);
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const body = z.object({ key: z.string().min(1).max(80) }).safeParse(await jsonBody(c));
      if (!body.success) return c.json({ error: "send the key to map the blank to", code: "invalid_request" }, 400);
      return reply(
        c,
        await remapBlank(ctx, { versionId: id.data, blankId: c.req.param("blankId"), key: body.data.key }, user),
      );
    })
    // C34 (S66): KYC forms (admin edits, a sales manager reads) and the AML policy page's routes (compliance only).
    .get("/api/settings/kyc", auth, async (c) => reply(c, await getKycSettings(ctx, c.get("user"), c.req.query())))
    .put("/api/settings/kyc", auth, async (c) =>
      c.json(await saveKycSettings(ctx, c.get("user"), await jsonBody(c)), 200),
    )
    .post("/api/settings/kyc/publish", auth, async (c) =>
      c.json(await publishKycSettings(ctx, c.get("user"), await jsonBody(c)), 200),
    )
    .get("/api/compliance/policy", auth, async (c) => reply(c, await getAmlPolicySettings(ctx, c.get("user"))))
    .put("/api/compliance/policy", auth, async (c) =>
      c.json(await putAmlPolicy(ctx, c.get("user"), await jsonBody(c)), 200),
    )
    // C40 (S72): company, plans, signing, fees, users, models, integrations and the demo clock.
    .get("/api/settings/company", auth, async (c) => reply(c, await getCompany(ctx, c.get("user"))))
    .put("/api/settings/company", auth, async (c) =>
      c.json(await saveCompany(ctx, c.get("user"), await jsonBody(c)), 200),
    )
    .get("/api/settings/policy/:page", auth, async (c) =>
      reply(c, await getPolicyPage(ctx, c.get("user"), c.req.param("page"))),
    )
    .put("/api/settings/policy/:page", auth, async (c) =>
      c.json(await savePolicyPage(ctx, c.get("user"), c.req.param("page"), await jsonBody(c)), 200),
    )
    .get("/api/settings/rulebook", auth, async (c) => reply(c, await getRulebookSettings(ctx, c.get("user"))))
    .get("/api/settings/users", auth, async (c) => reply(c, await listUsers(ctx, c.get("user"))))
    .put("/api/settings/users/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await changeUser(ctx, c.get("user"), id.data, await jsonBody(c)), 200);
    })
    .get("/api/settings/models", auth, async (c) => reply(c, getModels(c.get("user"), deps.models ?? {})))
    .get("/api/settings/integrations", auth, async (c) =>
      reply(
        c,
        getIntegrations(c.get("user"), {
          ...deps.integrations,
          documents: deps.documents ? "connected" : "not_set_up",
        }),
      ),
    )
    .get("/api/settings/helpers", auth, async (c) =>
      reply(c, await getHelperSettings(ctx, c.get("user"), deps.models ?? {})),
    )
    .put("/api/settings/helpers", auth, async (c) =>
      c.json(await setHelperMode(ctx, c.get("user"), await jsonBody(c)), 200),
    )
    .put("/api/deals/:id/target-transfer-date", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const body = z.object({ date: z.string() }).safeParse(await jsonBody(c));
      if (!id.success || !body.success) return c.json({ error: "send a date", code: "invalid_request" }, 400);
      await setTargetTransferDate(ctx, id.data, body.data.date, c.get("user"));
      return c.json({ ok: true }, 200);
    })
    .put("/api/deals/:id/unit", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      await setDealUnit(ctx, id.data, await jsonBody(c), c.get("user"));
      return c.json({ ok: true }, 200);
    })
    .post("/api/deals/:id/noc", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await recordNoc(ctx, id.data, await jsonBody(c), c.get("user")), 201);
    })
    .post("/api/deals/:id/bank-letters", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await recordBankLetter(ctx, id.data, await jsonBody(c), c.get("user")), 201);
    })
    .post("/api/bank-letters/:id/confirm-amount", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const body = z
        .object({ amountFils: z.unknown(), validUntil: z.unknown().optional() })
        .safeParse(await jsonBody(c));
      if (!id.success || !body.success) return c.json({ error: "send an amount", code: "invalid_request" }, 400);
      return c.json(
        await confirmBankAmount(ctx, id.data, body.data.amountFils, c.get("user"), body.data.validUntil),
        200,
      );
    })
    // A person confirms a NOC a reader wrote (review 5); only then does it count.
    .post("/api/noc-records/:id/confirm", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const body = z.object({ paidFils: z.unknown().optional() }).safeParse((await jsonBody(c)) ?? {});
      if (!id.success || !body.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await confirmNoc(ctx, id.data, c.get("user"), body.data.paidFils), 200);
    })
    // C16 (S48): the transfer-day statement with each line's source; the roles are checked by SpaManager.
    .get("/api/deals/:id/settlement", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await getSettlement(ctx, id.data, c.get("user")), 200);
    })
    .post("/api/deals/:id/settlement/refresh", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await requestSettlementRefresh(ctx, id.data, c.get("user")), 200);
    })
    // C17 (S49): document requests, KYC runs (queued as jobs) and the per-party KYC view. Roles: SpaManager.
    .post("/api/deals/:id/document-requests", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const r = await requestDocuments(ctx, id.data, c.get("user"));
      return c.json(r, r.requested ? 201 : 200);
    })
    // C35 (S67): staff send one person a new documents link; the old one stops working.
    .post("/api/deals/:id/parties/:partyId/documents-link", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const partyId = idParam.safeParse(c.req.param("partyId"));
      if (!id.success || !partyId.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await resendDocumentsLink(ctx, id.data, partyId.data, c.get("user")), 200);
    })
    .post("/api/deals/:id/parties/:partyId/kyc/run", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const partyId = idParam.safeParse(c.req.param("partyId"));
      if (!id.success || !partyId.success) return c.json({ error: "not found", code: "not_found" }, 404);
      // Optional form answers (the buyer portal's job in the end): the same checks as the form's own.
      const body = KycRunBody.safeParse(await c.req.json().catch(() => ({})));
      if (!body.success) return c.json({ error: "invalid answers", code: "invalid_answers" }, 422);
      const r = await enqueueKycRun(
        ctx,
        deps.jobs.boss,
        { dealId: id.data, partyId: partyId.data, answers: body.data.answers },
        c.get("user"),
      );
      return c.json({ key: r.key, queued: r.queued }, 202);
    })
    .get("/api/deals/:id/kyc", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await listKycRuns(ctx, id.data, c.get("user")), 200);
    })
    // C20 (S52): the readers. Each route queues one job and says nothing else; roles are checked by SpaManager.
    .post("/api/documents/:id/read", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const r = await enqueueDocumentRead(ctx, deps.jobs.boss, id.data, c.get("user"));
      return c.json({ queued: r.queued }, 202);
    })
    .post("/api/deals/:id/parties/:partyId/company-check/run", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const partyId = idParam.safeParse(c.req.param("partyId"));
      if (!id.success || !partyId.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const r = await enqueueCompanyCheck(
        ctx,
        deps.jobs.boss,
        { dealId: id.data, partyId: partyId.data },
        c.get("user"),
      );
      return c.json({ queued: r.queued }, 202);
    })
    .get("/api/deals/:id/company-checks", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await listCompanyChecks(ctx, id.data, c.get("user")), 200);
    })
    .post("/api/deals/:id/ownership-check/run", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const r = await enqueueOwnershipCheck(ctx, deps.jobs.boss, { dealId: id.data }, c.get("user"));
      return c.json({ queued: r.queued }, 202);
    })
    // C18 (S50): start a screening (the answer never says what it found) and read the cases (compliance roles only).
    .post("/api/deals/:id/aml/screen", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const r = await enqueueAmlScreening(ctx, deps.jobs.boss, { dealId: id.data, trigger: "manual" }, c.get("user"));
      return c.json({ queued: r.queued }, 202);
    })
    .get("/api/deals/:id/aml", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await listAmlCases(ctx, id.data, c.get("user")), 200);
    })
    // C19 (S51): sales types the payment plan (checked by the rulebook), then queues the agreement; the answer says nothing else.
    .put("/api/deals/:id/payment-plan", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await setPaymentPlan(ctx, id.data, await jsonBody(c), c.get("user")), 200);
    })
    .post("/api/deals/:id/prepare", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const r = await enqueuePrepare(ctx, deps.jobs.boss, id.data, c.get("user"));
      return c.json({ queued: r.queued }, 202);
    })
    // C25 (S60): an admin writes and approves the chase emails; an agent pauses or resumes chasing on one deal.
    .post("/api/chase-templates", auth, async (c) =>
      c.json(await createChaseTemplate(ctx, c.get("user"), await jsonBody(c)), 201),
    )
    .post("/api/chase-templates/:id/approve", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await approveChaseTemplate(ctx, c.get("user"), id.data), 200);
    })
    .post("/api/deals/:id/chase/pause", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await pauseChasing(ctx, c.get("user"), id.data), 200);
    })
    .post("/api/deals/:id/chase/resume", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await resumeChasing(ctx, c.get("user"), id.data), 200);
    })
    // C28 (S54): the signing status (no links, no addresses) and a resend, which kills the signer's old link.
    .get("/api/deals/:id/signing", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await listSigning(ctx, id.data, c.get("user")), 200);
    })
    .post("/api/deals/:id/signing/resend", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const body = z.object({ signatureId: z.uuid() }).safeParse(await jsonBody(c));
      if (!id.success || !body.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await resendSigningLink(ctx, id.data, body.data.signatureId, c.get("user")), 200);
    })
    // C27 (S53): the registry. Staff can read the attempts and ask for the step again; the sales admin's gate decides.
    .get("/api/deals/:id/registrations", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await listRegistrations(ctx, id.data, c.get("user")), 200);
    })
    .post("/api/deals/:id/registration/request", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await requestRegistration(ctx, deps.jobs.boss, id.data, c.get("user")), 202);
    })
    // C22 (S55): the escrow account of a project (admin enters, finance reads) and the payments checked against it.
    .put("/api/escrow-accounts", auth, async (c) => {
      const r = await setEscrowAccount(ctx, await jsonBody(c), c.get("user"));
      return c.json(r, 201);
    })
    .get("/api/escrow-accounts", auth, async (c) => c.json(await listEscrowAccounts(ctx, c.get("user")), 200))
    .put("/api/deals/:id/project", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const body = z.object({ projectCode: z.unknown() }).safeParse(await jsonBody(c));
      if (!id.success || !body.success) return c.json({ error: "not found", code: "not_found" }, 404);
      await setDealProject(ctx, id.data, body.data.projectCode, c.get("user"));
      return c.json({ ok: true }, 200);
    })
    .post("/api/deals/:id/payments", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const r = await registerPayment(ctx, id.data, await jsonBody(c), c.get("user"), { boss: deps.jobs.boss });
      return c.json(r, 201);
    })
    .get("/api/deals/:id/payments", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await listPayments(ctx, id.data, c.get("user")), 200);
    })
    .post("/api/payments/:id/confirm", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const body = z.object({ amountFils: z.unknown() }).safeParse(await jsonBody(c));
      if (!id.success || !body.success) return c.json({ error: "send an amount", code: "invalid_request" }, 400);
      return c.json(
        await confirmPayment(ctx, id.data, body.data.amountFils, c.get("user"), { boss: deps.jobs.boss }),
        200,
      );
    })
    .post("/api/deals/:id/milestones/:seq/reached", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const seq = z.coerce.number().int().min(1).safeParse(c.req.param("seq"));
      if (!id.success || !seq.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await recordMilestoneReached(ctx, id.data, seq.data, c.get("user")), 200);
    })
    // The default flag (S55, S27): flags only, no state change and no notice. Only a sales manager clears it.
    .post("/api/deals/:id/default", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      await recordPartyDefault(ctx, id.data, await jsonBody(c), c.get("user"));
      return c.json({ ok: true }, 200);
    })
    .post("/api/deals/:id/default/clear", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const body = z.object({ reason: z.unknown() }).safeParse(await jsonBody(c));
      if (!id.success || !body.success) return c.json({ error: "not found", code: "not_found" }, 404);
      await clearDefaultFlag(ctx, id.data, body.data.reason, c.get("user"));
      return c.json({ ok: true }, 200);
    })
    // C29 (S57): the read routes. Every answer is filtered by the session's role and masked for personal numbers.
    // C23 (S29, S30, S62): records for the compliance roles, and staff alerts. Compliance routes check the role first, so a
    // refusal never says whether a deal, a report or a list exists.
    .post("/api/compliance/deals/:id/export", auth, async (c) => {
      const user = c.get("user");
      requireCompliance(user);
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const pack = await exportCasePack(ctx, { store: exportStore() }, id.data, user);
      return c.body(pack.bytes as never, 200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${pack.fileName}"`,
        "cache-control": "no-store",
        "x-export-id": pack.exportId,
        "x-sha256": pack.sha256,
      });
    })
    // C33 (S65): the case list by tab, and one case. Role first, then the query, so a refusal says nothing.
    .get("/api/compliance/cases", auth, async (c) => {
      const user = c.get("user");
      requireCompliance(user);
      const q = CasesQuery.safeParse(c.req.query());
      if (!q.success) return badQuery(c);
      return reply(c, await listCaseItems(ctx, user, q.data));
    })
    .get("/api/compliance/cases/:id", auth, async (c) => {
      const user = c.get("user");
      requireCompliance(user);
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await getCaseView(ctx, user, id.data));
    })
    .get("/api/compliance/exports", auth, async (c) => reply(c, { items: await listExports(ctx, c.get("user")) }))
    .get("/api/compliance/reports", auth, async (c) => reply(c, { items: await listReports(ctx, c.get("user")) }))
    .get("/api/compliance/reports/:file", auth, async (c) => {
      const user = c.get("user");
      requireCompliance(user);
      const m = /^([0-9a-f-]{36})\.(csv|pdf)$/.exec(c.req.param("file"));
      const id = m ? idParam.safeParse(m[1]) : null;
      if (!m || !id?.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const f = await downloadReport(ctx, { store: exportStore() }, id.data, m[2] as "csv" | "pdf", user);
      return c.body(f.bytes as never, 200, {
        "content-type": f.contentType,
        "content-disposition": `attachment; filename="${f.fileName}"`,
        "cache-control": "no-store",
      });
    })
    .get("/api/compliance/retention", auth, async (c) =>
      reply(c, { items: await listRetentionReviews(ctx, c.get("user")) }),
    )
    .post("/api/compliance/retention/:id/approve", auth, async (c) => {
      const user = c.get("user");
      requireCompliance(user);
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await approveRetentionReview(ctx, id.data, user));
    })
    .get("/api/alerts", auth, async (c) => reply(c, await listAlerts(ctx, c.get("user"))))
    .post("/api/alerts/:id/read", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      await markAlertRead(ctx, c.get("user"), id.data);
      return c.body(null, 204);
    })
    .get("/api/settings/alerts", auth, async (c) => reply(c, { items: await getAlertSettings(ctx, c.get("user")) }))
    .put("/api/settings/alerts", auth, async (c) =>
      reply(c, await setAlertSettings(ctx, c.get("user"), await jsonBody(c))),
    )
    .get("/api/summary", auth, async (c) => reply(c, await homeSummary(ctx, c.get("user"))))
    // C32 (S64): inventory (developer and both companies) and listings (brokerage and both). The manager checks the
    // role and the company kind on every route; a hidden rail item is only a convenience.
    .get("/api/units", auth, async (c) => reply(c, await listUnits(ctx, c.get("user"), c.req.query())))
    .get("/api/units/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await getUnit(ctx, c.get("user"), id.data));
    })
    .get("/api/projects", auth, async (c) => reply(c, await listProjects(ctx, c.get("user"))))
    .get("/api/projects/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await getProject(ctx, c.get("user"), id.data));
    })
    .post("/api/projects", auth, async (c) => c.json(await createProject(ctx, await jsonBody(c), c.get("user")), 201))
    .post("/api/projects/:id/buildings", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await addBuilding(ctx, id.data, await jsonBody(c), c.get("user")), 201);
    })
    .post("/api/projects/:id/units", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await addUnit(ctx, id.data, await jsonBody(c), c.get("user")), 201);
    })
    .put("/api/projects/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await updateProject(ctx, id.data, await jsonBody(c), c.get("user")), 200);
    })
    .put("/api/units/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await updateUnit(ctx, id.data, await jsonBody(c), c.get("user")), 200);
    })
    .post("/api/projects/:id/price-lists", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await createPriceList(ctx, id.data, await jsonBody(c), c.get("user")), 201);
    })
    .post("/api/price-lists/:id/publish", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await publishPriceList(ctx, id.data, c.get("user")), 200);
    })
    // S75: marketing photos of a project, unit or listing. The manager checks the role of the owner's kind.
    .get("/api/media", auth, async (c) => {
      const owner = MediaOwnerQuery.safeParse(c.req.query());
      if (!owner.success) return badQuery(c);
      return reply(c, { items: await listMediaFor(ctx, owner.data, c.get("user")) });
    })
    .post(
      "/api/media",
      auth,
      bodyLimit({
        maxSize: MAX_MEDIA_BYTES + 100_000,
        onError: (c) => c.json({ error: "the photo is too large", code: "too_large" }, 413),
      }),
      async (c) => {
        if (!deps.media) return c.json({ error: "photo storage is not configured", code: "unavailable" }, 503);
        const form = await c.req.formData().catch(() => null);
        const file = form?.get("file");
        const owner = MediaOwnerQuery.safeParse({ kind: form?.get("kind"), id: form?.get("id") });
        const caption = form?.get("caption");
        if (!owner.success || !(file instanceof File) || (caption !== null && typeof caption !== "string"))
          return c.json({ error: "send a photo, its kind and its id", code: "invalid_request" }, 400);
        const r = await addMedia(
          ctx,
          deps.media,
          owner.data,
          new Uint8Array(await file.arrayBuffer()),
          caption || null,
          c.get("user"),
        );
        return c.json(
          { ...r, media: { id: r.media.id, caption: r.media.caption, sort: r.media.sort } },
          r.duplicate ? 200 : 201,
        );
      },
    )
    .put("/api/media/order", auth, async (c) => {
      const body = MediaOrderBody.safeParse(await jsonBody(c));
      if (!body.success)
        return c.json({ error: "send the kind, the id and every photo id", code: "invalid_request" }, 400);
      await reorderMedia(ctx, { kind: body.data.kind, id: body.data.id }, body.data.ids, c.get("user"));
      return c.json({ ok: true }, 200);
    })
    .patch("/api/media/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const body = z.object({ caption: z.string().nullable() }).safeParse(await jsonBody(c));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      if (!body.success) return c.json({ error: "send a caption", code: "invalid_request" }, 400);
      await captionMedia(ctx, id.data, body.data.caption, c.get("user"));
      return c.json({ ok: true }, 200);
    })
    .delete("/api/media/:id", auth, async (c) => {
      if (!deps.media) return c.json({ error: "photo storage is not configured", code: "unavailable" }, 503);
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      await removeMedia(ctx, deps.media, id.data, c.get("user"));
      return c.body(null, 204);
    })
    .get("/api/media/:id/file", auth, async (c) => {
      if (!deps.media) return c.json({ error: "photo storage is not configured", code: "unavailable" }, 503);
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const f = await readMedia(ctx, deps.media, id.data, c.get("user"));
      return c.body(f.bytes, 200, { "content-type": f.mime, "cache-control": "private, max-age=300" });
    })
    .get("/api/listings", auth, async (c) => {
      const q = ListingsQuery.safeParse(c.req.query());
      if (!q.success) return badQuery(c);
      return reply(c, await listListings(ctx, c.get("user"), q.data));
    })
    .get("/api/listings/agents", auth, async (c) => reply(c, await listAgents(ctx, c.get("user"))))
    .get("/api/listings/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await getListing(ctx, c.get("user"), id.data));
    })
    .post("/api/listings", auth, async (c) =>
      c.json(await createListingDraft(ctx, await jsonBody(c), c.get("user")), 201),
    )
    .post("/api/listings/:id/steps", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await stepListing(ctx, id.data, await jsonBody(c), c.get("user")), 200);
    })
    .post("/api/listings/:id/ownership", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await recordOwnershipAs(ctx, id.data, await jsonBody(c), c.get("user")), 200);
    })
    .post("/api/listings/:id/signatures", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const body = (await jsonBody(c)) as { partyId?: unknown } | null;
      await recordSignatureAs(ctx, id.data, body?.partyId, c.get("user"));
      return c.json({ ok: true }, 200);
    })
    .post(
      "/api/listings/:id/documents",
      auth,
      bodyLimit({
        maxSize: 10 * 1024 * 1024 + 100_000,
        onError: (c) => c.json({ error: "the file is too large", code: "too_large" }, 413),
      }),
      async (c) => {
        const id = idParam.safeParse(c.req.param("id"));
        if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
        if (!deps.documents) return c.json({ error: "uploads are not configured", code: "unavailable" }, 503);
        const form = await c.req.formData().catch(() => null);
        const file = form?.get("file");
        if (!(file instanceof File)) return c.json({ error: "send a file and its kind", code: "invalid_request" }, 400);
        const r = await uploadListingDocument(
          ctx,
          deps.documents,
          id.data,
          form?.get("kind"),
          { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
          c.get("user"),
        );
        return c.json(r, r.duplicate ? 200 : 201);
      },
    )
    .get("/api/listings/:id/documents/:docId/file", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const docId = idParam.safeParse(c.req.param("docId"));
      if (!id.success || !docId.success) return c.json({ error: "not found", code: "not_found" }, 404);
      if (!deps.documents) return c.json({ error: "uploads are not configured", code: "unavailable" }, 503);
      const f = await readListingDocument(ctx, deps.documents, id.data, docId.data, c.get("user"));
      return c.body(new Uint8Array(f.bytes), 200, {
        "content-type": f.mime,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-disposition": "inline",
      });
    })
    .put("/api/listings/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      await updateListing(ctx, id.data, await jsonBody(c), c.get("user"));
      return c.json({ ok: true }, 200);
    })
    // Leads and viewings (S79): the sales roles only; an officer sees their own, a manager everyone's.
    .get("/api/leads", auth, async (c) => reply(c, await listLeads(ctx, c.get("user"), c.req.query())))
    // The record carries the visitor's contact details for the assigned staff, so it is not run through the PII mask.
    .get("/api/leads/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(await getLead(ctx, c.get("user"), id.data), 200);
    })
    .post("/api/leads", auth, bodyLimit({ maxSize: 8192 }), async (c) =>
      c.json(await recordStaffLead(ctx, await jsonBody(c), c.get("user")), 201),
    )
    .put("/api/leads/:id/status", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const b = z.object({ status: z.string(), note: z.string().max(600).optional() }).safeParse(await jsonBody(c));
      if (!b.success) return c.json({ error: "send the new status", code: "invalid_request" }, 400);
      await updateLeadStatus(ctx, id.data, b.data.status, c.get("user"), b.data.note);
      return c.json({ ok: true }, 200);
    })
    .get("/api/leads/:id/slots", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json({ slots: await freeSlotsForLead(ctx, id.data, c.get("user")) }, 200);
    })
    .get("/api/viewings", auth, async (c) => reply(c, await listViewings(ctx, c.get("user"), c.req.query())))
    .post("/api/viewings", auth, async (c) => {
      const b = z.object({ leadId: z.uuid(), slot: z.string().max(40) }).safeParse(await jsonBody(c));
      if (!b.success) return c.json({ error: "send the lead and a time", code: "invalid_request" }, 400);
      return c.json(await bookViewingForLead(ctx, b.data.leadId, b.data.slot, c.get("user")), 201);
    })
    .post("/api/viewings/:id/outcome", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const b = z.object({ outcome: z.string(), note: z.string().max(1200).optional() }).safeParse(await jsonBody(c));
      if (!b.success) return c.json({ error: "send the outcome", code: "invalid_request" }, 400);
      await recordViewingOutcome(ctx, id.data, b.data.outcome, b.data.note, c.get("user"));
      return c.json({ ok: true }, 200);
    })
    .post("/api/viewings/:id/cancel", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const b = z.object({ reason: z.string().max(600) }).safeParse(await jsonBody(c));
      if (!b.success) return c.json({ error: "say why", code: "invalid_request" }, 400);
      await cancelViewingAs(ctx, id.data, b.data.reason, c.get("user"));
      return c.json({ ok: true }, 200);
    })
    .post("/api/viewings/:id/reschedule", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const b = z.object({ slot: z.string().max(40) }).safeParse(await jsonBody(c));
      if (!b.success) return c.json({ error: "pick a time", code: "invalid_request" }, 400);
      return c.json(await rescheduleViewing(ctx, id.data, b.data.slot, c.get("user")), 200);
    })
    .get("/api/deals", auth, async (c) => {
      const q = DealsQuery.safeParse(c.req.query());
      if (!q.success) return badQuery(c);
      return reply(c, await listDeals(ctx, c.get("user"), q.data));
    })
    // M6 (S81): start a primary deal from a unit, with the figures the form shows computed here, never in the browser.
    .get("/api/deals/quote", auth, async (c) => reply(c, await quoteDeal(ctx, c.get("user"), c.req.query())))
    .post("/api/deals", auth, async (c) => c.json(await startDeal(ctx, await jsonBody(c), c.get("user")), 201))
    .put("/api/deals/:id/broker", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const user = c.get("user");
      requireSales(user);
      await setBroker(ctx, id.data, await jsonBody(c), `user:${user.id}`);
      return c.json({ ok: true }, 200);
    })
    .post("/api/deals/:id/deposit", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const user = c.get("user");
      requireSales(user);
      return c.json(
        await recordDeposit(ctx, id.data, await jsonBody(c), `user:${user.id}`, { boss: deps.jobs.boss }),
        201,
      );
    })
    .get("/api/listings/:id/offers", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await listOffers(ctx, c.get("user"), id.data));
    })
    .post("/api/listings/:id/offers", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const body = (await jsonBody(c)) as Record<string, unknown> | null;
      return c.json(await makeOffer(ctx, { ...body, listingId: id.data }, c.get("user")), 201);
    })
    .post("/api/offers/:id/withdraw", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const body = (await jsonBody(c)) as { reason?: unknown } | null;
      await withdrawOffer(ctx, id.data, body?.reason, c.get("user"));
      return c.json({ ok: true }, 200);
    })
    .get("/api/deals/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await getDealRecord(ctx, c.get("user"), id.data));
    })
    .get("/api/deals/:id/events", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      const q = EventsQuery.safeParse(c.req.query());
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      if (!q.success) return badQuery(c);
      return reply(c, await listDealEvents(ctx, c.get("user"), id.data, q.data));
    })
    .get("/api/approvals", auth, async (c) => {
      const q = ApprovalsQuery.safeParse(c.req.query());
      if (!q.success) return badQuery(c);
      return reply(c, await listApprovals(ctx, c.get("user"), q.data));
    })
    .get("/api/approvals/:id", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      return reply(c, await getApproval(ctx, c.get("user"), id.data));
    })
    // The decision comes from the session: the body is the decision only, never a role or an actor.
    .post("/api/approvals/:id/decide", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      const body = await jsonBody(c);
      if (!isDecisionBody(body))
        return c.json({ error: "send the decision only: no role, no person", code: "invalid_request" }, 400);
      return reply(c, await decideForSession(ctx, id.data, c.get("user"), body));
    })
    .get("/api/tasks", auth, async (c) => {
      const q = TasksQuery.safeParse(c.req.query());
      if (!q.success) return badQuery(c);
      return reply(c, await listTasks(ctx, c.get("user"), q.data));
    })
    .post("/api/tasks/:id/done", auth, async (c) => {
      const id = idParam.safeParse(c.req.param("id"));
      if (!id.success) return c.json({ error: "not found", code: "not_found" }, 404);
      await completeTask(ctx, id.data, c.get("user"));
      return c.json({ ok: true }, 200);
    })
    .get("/api/demo/clock", auth, async (c) => {
      await clock.refresh();
      return c.json({ today: clock.today(), offsetDays: clock.offsetDays, demo: deps.demoMode }, 200);
    })
    .post("/api/demo/clock", auth, async (c) =>
      c.json(await setDemoClock(ctx, clock, deps.demoMode, c.get("user"), await jsonBody(c)), 200),
    );
  // A refused domain action answers with its own status and code, never a 500.
  app.onError((e, c) => {
    if (e instanceof BadQuery) return c.json({ error: e.message, code: "invalid_request" }, 400);
    if (e instanceof SpaDomainError) return c.json({ error: e.message, code: e.code, reasons: e.reasons }, e.status);
    // Name and message only, masked: an error object can carry the request's personal data (rule 8).
    console.error(
      `unhandled error: ${maskPiiText(e instanceof Error ? e.name : "non-error")}: ${maskPiiText(e instanceof Error ? e.message : String(e))}`,
    );
    return c.json({ error: "something went wrong", code: "internal" }, 500);
  });
  return app;
}

export type SpaApp = ReturnType<typeof createApp>;
