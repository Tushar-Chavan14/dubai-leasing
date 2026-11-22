import { PageTitle } from "@platform/ui/page";
import type { SpaRole } from "@spa/core";
import type { Metadata } from "next";
import Link from "next/link";
import { engineGet } from "../../../lib/engine";
import { loadDemoClock } from "../../../lib/loaders";
import { requireScreen } from "../../../lib/session";

export const metadata: Metadata = { title: "Settings" };

interface Card {
  href: string;
  title: string;
  body: string;
  roles: readonly SpaRole[];
}
/** What each role may open from Settings (S66). The engine checks the role again on every route. */
const CARDS: readonly Card[] = [
  {
    href: "/settings/templates",
    title: "Templates",
    body: "The company's own agreement wording, its blanks and its versions. Upload a blank sample, check what was read, preview it.",
    roles: ["admin", "legal", "sales_manager"],
  },
  {
    href: "/settings/kyc",
    title: "KYC forms",
    body: "What each kind of party fills in and uploads, and the checks run on it.",
    roles: ["admin", "sales_manager"],
  },
  {
    href: "/settings/helpers",
    title: "AI helpers",
    body: "How each helper runs: on its own, with a person looking first, or not at all.",
    roles: ["admin", "sales_manager"],
  },
  {
    href: "/settings/company",
    title: "Company and signatories",
    body: "The company's name and kind, and who signs for the companies it deals with.",
    roles: ["admin", "sales_manager"],
  },
  {
    href: "/settings/plans",
    title: "Plans",
    body: "Discount, deposit, hold and offer days, commission and instalment reminders.",
    roles: ["admin", "sales_manager"],
  },
  {
    href: "/settings/fees",
    title: "Fees and rulebook",
    body: "The fees and rules in force, set by legal. Read only.",
    roles: ["admin", "sales_manager"],
  },
  {
    href: "/settings/signing",
    title: "Signing",
    body: "How long a signing link lasts and who signs first.",
    roles: ["admin", "sales_manager"],
  },
  {
    href: "/settings/users",
    title: "Users and roles",
    body: "Change what someone can do, or switch their access off.",
    roles: ["admin"],
  },
  {
    href: "/settings/models",
    title: "AI models",
    body: "Which model does which job. Read only.",
    roles: ["admin", "sales_manager"],
  },
  {
    href: "/settings/integrations",
    title: "Integrations",
    body: "What the engine is connected to, as a status.",
    roles: ["admin", "sales_manager"],
  },
  {
    href: "/settings/alerts",
    title: "Alerts",
    body: "How many hours a waiting approval may sit before its approver is alerted.",
    roles: ["admin"],
  },
];

export default async function Page() {
  const { user, item } = await requireScreen("settings");
  const cards = CARDS.filter((c) => c.roles.includes(user.role));
  // The demo clock card exists only in demo mode, for an admin: the engine says whether this install is a demo.
  if (user.role === "admin" && (await loadDemoClock(engineGet))?.demo)
    cards.push({
      href: "/settings/demo-clock",
      title: "Demo clock",
      body: "Move the demo date ahead to see reminders and deadlines, then go back to today.",
      roles: ["admin"],
    });
  return (
    <div className="grid gap-6">
      <PageTitle
        title="Settings"
        lede={
          item.readOnly
            ? "You can view these settings; an admin changes them."
            : "Company, plans, fees, signing, templates, forms, helpers and more."
        }
      />
      <ul className="m-0 grid list-none gap-2 p-0">
        {cards.map((c) => (
          <li key={c.href} className="rounded-card border border-line p-4">
            <Link href={c.href} className="font-semibold text-ink underline underline-offset-2">
              {c.title}
            </Link>
            <p className="m-0 mt-1 text-sm text-muted">{c.body}</p>
          </li>
        ))}
        {user.role === "admin" && (
          <li className="rounded-card border border-line p-4">
            <p className="m-0 font-semibold text-ink">Compliance rules, managed by compliance</p>
            <p className="m-0 mt-1 text-sm text-muted">
              These rules are set and published by the compliance team. They are not shown or changed here.
            </p>
          </li>
        )}
      </ul>
    </div>
  );
}
