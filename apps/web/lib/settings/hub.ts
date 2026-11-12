export type HubItem = {
  href: string;
  title: string;
  blurb: string;
  /** Static text; must match the engine's role checks for the page's writes. */
  who: string;
  demoOnly?: boolean;
  keywords: string[];
};
export type HubGroup = { group: string; items: HubItem[] };

export const HUB: HubGroup[] = [
  {
    group: "Your company",
    items: [
      {
        href: "/settings/companies",
        title: "Companies",
        blurb: "The landlord companies you lease for: legal details, authorised signatory and logo.",
        who: "Admins change it. Everyone can read it.",
        keywords: ["landlord", "legal", "signatory", "logo", "trade licence", "company"],
      },
      {
        href: "/settings/kyc",
        title: "Documents & KYC",
        blurb: "Which documents and details an applicant must give, and the identity check rules, per company.",
        who: "Admins change it. Everyone can read it.",
        keywords: ["kyc", "documents", "identity", "applicant", "form", "draft", "publish"],
      },
    ],
  },
  {
    group: "Money and rules",
    items: [
      {
        href: "/settings/rent-rules",
        title: "Rent rules",
        blurb: "Limits on rent, discounts and cheques that offers must stay inside, per company and category.",
        who: "Admins change it. Everyone can read it.",
        keywords: ["rent", "discount", "cheques", "pdc", "limit", "offer"],
      },
      {
        href: "/settings/rent-index",
        title: "Rent index",
        blurb: "The index values rent is compared with, by area and unit type.",
        who: "Admins and leasing managers change it. Everyone can read it.",
        keywords: ["sri", "smart rental index", "index", "rent", "benchmark", "band", "area"],
      },
      {
        href: "/settings/rulebook",
        title: "Rulebook",
        blurb: "Versioned Dubai leasing rules: notice periods, rent caps and deadlines. Every lease keeps its version.",
        who: "Admins create, edit and publish versions. Everyone can read published ones.",
        keywords: ["rules", "version", "notice", "deadline", "rent cap", "rera", "ejari", "history"],
      },
    ],
  },
  {
    group: "Contracts",
    items: [
      {
        href: "/settings/contracts",
        title: "Contracts",
        blurb: "Contract templates and clauses per company, with a preview of the generated contract.",
        who: "Admins change it. Everyone can read it.",
        keywords: ["template", "clauses", "contract rules", "preview", "tenancy contract", "ejari"],
      },
      {
        href: "/settings/registration",
        title: "Registration",
        blurb: "How a tenancy contract is registered in each emirate: portal, documents to bring and reference format.",
        who: "Admins change it. Everyone can read it.",
        keywords: ["ejari", "tawtheeq", "attestation", "municipality", "registration", "tasdeeq", "ejaar"],
      },
    ],
  },
  {
    group: "Agent",
    items: [
      {
        href: "/settings/agent",
        title: "Agent",
        blurb: "What the leasing agent may do on its own, and the steps that always wait for a person.",
        who: "Admins change it. Everyone can read it.",
        keywords: ["autopilot", "permissions", "approval", "locked", "gates", "automatic"],
      },
    ],
  },
  {
    group: "Data",
    items: [
      {
        href: "/settings/import",
        title: "Import",
        blurb: "Bring leases, units and companies in from a spreadsheet (CSV).",
        who: "Admins and leasing managers import leases and units. Only admins import companies.",
        keywords: ["csv", "spreadsheet", "upload", "leases", "units", "companies"],
      },
      {
        href: "/settings/demo",
        title: "Demo",
        blurb: "Move the demo clock, rewind it and set up demo data. Only in demo mode.",
        who: "Leasing staff move the clock. Only admins reset the demo.",
        demoOnly: true,
        keywords: ["clock", "fast forward", "rewind", "reset", "seed", "simulated"],
      },
    ],
  },
];

/** Case-insensitive match on title, blurb and keywords; drops empty groups and Demo unless `demo`. */
export function filterHub(q: string, opts: { demo: boolean }): HubGroup[] {
  const needle = q.trim().toLowerCase();
  return HUB.map((g) => ({
    group: g.group,
    items: g.items.filter(
      (i) =>
        (opts.demo || !i.demoOnly) &&
        (!needle || [i.title, i.blurb, ...i.keywords].some((s) => s.toLowerCase().includes(needle))),
    ),
  })).filter((g) => g.items.length > 0);
}
