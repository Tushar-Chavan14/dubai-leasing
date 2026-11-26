import { maskPiiText } from "@leasing/core";

export type AskPrompt = { label: string; prompt: string };

// Every argument is masked first: prompts are typed into the composer and must never carry raw phone, ID or passport numbers.
const m = (s: string) => maskPiiText(s);
/** "application A-BZVJ2V (Tushar)": the ref pins the agent to one application when a person has several. */
const app = (name: string, ref?: string | null) =>
  ref ? `application ${m(ref)} (${m(name)})` : `${m(name)}'s application`;

export const askPrompts = {
  queueRow: (name: string, gateOrTask: string, ref?: string | null): AskPrompt[] => [
    {
      label: "Ask AI",
      prompt: `Explain what is waiting on ${ref ? m(ref) : m(name)} (${m(gateOrTask)}) and what I should check before approving`,
    },
  ],
  homeEmpty: (): AskPrompt[] => [{ label: "Ask AI", prompt: "What should I look at today?" }],
  workList: (kind: string): AskPrompt[] => [
    { label: "Which are stuck?", prompt: `Which ${m(kind)} are stuck?` },
    { label: "Due this week", prompt: `What is due this week in ${m(kind)}?` },
  ],
  application: (name: string, ref?: string | null): AskPrompt[] => [
    { label: "Summarise", prompt: `Summarise ${app(name, ref)}` },
    { label: "What is missing", prompt: `What is missing before the offer on ${app(name, ref)}?` },
    {
      label: "Draft a document request",
      prompt: `Draft an email asking for the missing documents on ${app(name, ref)}`,
    },
  ],
  lease: (ref: string): AskPrompt[] => [
    { label: "Summarise", prompt: `Summarise lease ${m(ref)}` },
    { label: "Next deadlines", prompt: `What are the next deadlines for lease ${m(ref)}?` },
    { label: "Ejari status", prompt: `Where is the Ejari registration for lease ${m(ref)}?` },
  ],
  gate: (gateLabel: string, name: string): AskPrompt[] => [
    {
      label: "Ask AI",
      prompt: `Explain this ${m(gateLabel)} for ${m(name)} and the rules behind it`,
    },
  ],
  logEntry: (text: string): AskPrompt[] => [{ label: "Ask AI", prompt: `Explain this event: ${m(text)}` }],
  identity: (name: string, ref?: string | null): AskPrompt[] => [
    { label: "Ask AI", prompt: `Why did the identity check flag ${app(name, ref)}?` },
  ],
  offer: (name: string, ref?: string | null): AskPrompt[] => [
    {
      label: "Ask AI",
      prompt: `Is the rent in the offer on ${app(name, ref)} within the Smart Rental Index band?`,
    },
  ],
  contractEjari: (ref: string): AskPrompt[] => [
    { label: "Ask AI", prompt: `What does Ejari still need for lease ${m(ref)}?` },
  ],
  unitsList: (): AskPrompt[] => [
    { label: "Ready to list", prompt: "Which units are ready to list?" },
    { label: "No applications", prompt: "Which listed units have no applications?" },
  ],
  unit: (code: string): AskPrompt[] => [
    { label: "Ready to list?", prompt: `Is unit ${m(code)} ready to list?` },
    { label: "Suggest rent", prompt: `Suggest an asking rent for unit ${m(code)} from the index` },
    { label: "Draft listing", prompt: `Draft a listing description for unit ${m(code)}` },
  ],
  settingsHub: (): AskPrompt[] => [{ label: "Ask AI", prompt: "Which setting changes what I want to change?" }],
  settingsPage: (title: string): AskPrompt[] => [
    { label: "Explain this page", prompt: `Explain the ${m(title)} settings page` },
  ],
  newApplication: (): AskPrompt[] => [{ label: "Ask AI", prompt: "Fill this in from the enquiry I paste" }],
};
