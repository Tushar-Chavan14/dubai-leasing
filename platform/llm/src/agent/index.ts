/**
 * Shared chat-agent code (C26, S61): the pieces the leasing customer agent and copilot used to hold on their own and the
 * SPA assistants now share. Domain words come in as an `AgentProfile`; nothing here knows a tenant or a deal.
 */
export * from "./types.ts";
export * from "./scope.ts";
export * from "./verify.ts";
export * from "./untrusted.ts";
export * from "./model.ts";
export * from "./loop.ts";
