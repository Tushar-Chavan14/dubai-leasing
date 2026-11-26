/**
 * `@spa/copilot` (C36, S68): the staff copilot of the SPA module. It reads through the engine's role-filtered routes, drafts
 * text and proposes four confirmed actions; it never approves, sends, signs, submits, clears or edits settings. It imports
 * `@spa/core` and `@platform/*` only, and reaches the engine through `EngineClient` (an allowlist), never the database.
 */
export const SPA_COPILOT_PACKAGE = "@spa/copilot";
export * from "./client.ts";
export * from "./guard.ts";
export * from "./prompt.ts";
export * from "./turn.ts";
export * from "./tools/index.ts";
export type { DraftOutput, ProposalOutput } from "./tools/common.ts";
