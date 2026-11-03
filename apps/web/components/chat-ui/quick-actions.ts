/**
 * The quick-action pills above the chat input, in both chats (public and staff copilot). They are
 * fixed, code-driven shortcuts, not model output: a `press` sends a button the engine already
 * handles, a `send` sends the prompt text as the visitor's or user's own message.
 */
export type PillAction = { kind: "press"; data: string } | { kind: "send"; text: string };
export interface Pill {
  key: string;
  label: string;
  action: PillAction;
}

/** Public web chat. `Use a different email` ends the chat's verified-email state and asks for a new address. */
export function customerPills(arabic: boolean): Pill[] {
  const l = (en: string, ar: string) => (arabic ? ar : en);
  return [
    { key: "find", label: l("Find properties", "ابحث عن عقار"), action: { kind: "press", data: "units" } },
    { key: "book", label: l("Book a site visit", "احجز معاينة"), action: { kind: "press", data: "chat:book" } },
    { key: "apply", label: l("Apply now", "قدّم الآن"), action: { kind: "press", data: "chat:apply" } },
    {
      key: "status",
      label: l("Check my applications", "تحقق من طلباتي"),
      action: { kind: "press", data: "status:start" },
    },
    {
      key: "email",
      label: l("Use a different email", "استخدم بريداً آخر"),
      action: { kind: "press", data: "contact:change" },
    },
  ];
}

/**
 * Public web chat, start screen: what the assistant can do for a visitor. The first four press the same buttons as the
 * pills; the questions are sent as the visitor's own message (the agent answers from its tools, never prices it can't
 * show).
 */
export const CUSTOMER_STARTERS: readonly Pill[] = [
  { key: "find", label: "Show me homes available now", action: { kind: "press", data: "units" } },
  { key: "book", label: "Book a site visit", action: { kind: "press", data: "chat:book" } },
  { key: "apply", label: "Apply for a home", action: { kind: "press", data: "chat:apply" } },
  { key: "status", label: "Check my application", action: { kind: "press", data: "status:start" } },
  {
    key: "q-2bed",
    label: "I'm looking for a 2-bedroom apartment",
    action: { kind: "send", text: "I'm looking for a 2-bedroom apartment" },
  },
  {
    key: "q-docs",
    label: "What documents do I need to apply?",
    action: { kind: "send", text: "What documents do I need to apply?" },
  },
  {
    key: "q-how",
    label: "How does renting in Dubai work?",
    action: { kind: "send", text: "How does renting in Dubai work?" },
  },
];

/** Staff copilot (Home and the side panel): each sends its prompt into the chat. */
export const STAFF_PILLS: readonly Pill[] = [
  {
    key: "pipeline",
    label: "Pipeline summary",
    action: { kind: "send", text: "Give me a pipeline summary: how many applications are in each stage?" },
  },
  { key: "tasks", label: "My tasks", action: { kind: "send", text: "What is on my plate? Show my open tasks." } },
  {
    key: "enquiries",
    label: "Enquiries",
    action: { kind: "send", text: "How many enquiries are open, and which need a person?" },
  },
  {
    key: "units",
    label: "Available units",
    action: { kind: "send", text: "Which units are available for site visit?" },
  },
  {
    key: "to-approve",
    label: "Contracts to approve",
    action: { kind: "send", text: "Which contracts are waiting for approval?" },
  },
  {
    key: "prep-failed",
    label: "Failed preparations",
    action: { kind: "send", text: "Which contracts couldn't be prepared, and why?" },
  },
  {
    key: "rules",
    label: "Contract & rent rules",
    action: { kind: "send", text: "What contract rules, rent rules and clauses does each company have?" },
  },
  { key: "approvals", label: "Pending approvals", action: { kind: "send", text: "Which approvals are waiting?" } },
  {
    key: "contracts",
    label: "Contract status",
    action: { kind: "send", text: "Which contracts are waiting for a signature?" },
  },
];
