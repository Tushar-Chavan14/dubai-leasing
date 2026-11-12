import { STATUS_STAGES } from "@leasing/core";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { LockSimpleIcon as IconLock } from "@phosphor-icons/react/dist/ssr";
import { RecordStepper } from "../../../components/ui/stepper";
import { portalView } from "../../../lib/engine";
import { BrandMark } from "../../../lib/icons";
import { stageIndex, type ApplicationPortalView } from "../../../lib/portal";

// Tokens are in the URL: keep these pages out of search engines and out of Referer headers.
export const metadata: Metadata = {
  title: "My tenancy",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Lets the pinned action bar clear the home indicator on phones (env(safe-area-inset-bottom)).
export const viewport: Viewport = { viewportFit: "cover" };

/** The portal view fields the header needs. Tenant and landlord links share it. */
interface HeaderView {
  kind?: string;
  state?: string;
  signedAt?: string | null;
  unit?: { label: string; community: string } | null;
  contract?: { fields?: { unitNo?: string; building?: string; community?: string } };
}

/** Where each of the six applicant stages sits on the five-step tracker (checks belong to Documents). */
const APPLICANT_TO_STEP = [0, 1, 1, 2, 3, 3];

function header(v: HeaderView | null): { unit: string | null; current: (typeof STATUS_STAGES)[number] | null } {
  if (!v) return { unit: null, current: null };
  let step: number | null = null;
  let unit: string | null = null;
  if (v.kind === "application" && v.unit) {
    unit = `${v.unit.label}, ${v.unit.community}`;
    if (v.state !== "WITHDRAWN" && v.state !== "REJECTED") {
      step = APPLICANT_TO_STEP[stageIndex(v as ApplicationPortalView)] ?? 0;
    }
  } else if (v.kind === "sign") {
    const f = v.contract?.fields;
    unit = f ? `Unit ${f.unitNo}, ${f.building}, ${f.community}` : null;
    step = 3;
  } else if (v.unit) {
    unit = `${v.unit.label}, ${v.unit.community}`;
  }
  return { unit, current: step === null ? null : (STATUS_STAGES[step] ?? null) };
}

export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const view = await portalView<HeaderView>(token);
  const { unit, current } = header(view);
  return (
    // Phones: one full-height column with the action pinned to the bottom. Desktop: a top bar and a centred card.
    <div className="min-h-dvh bg-page text-ink md:bg-raised">
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col sm:border-x sm:border-line md:max-w-none md:border-x-0">
        <header className="grid gap-3 px-5 pb-3 pt-[calc(1.1rem+env(safe-area-inset-top))] md:gap-0 md:p-0">
          <div className="md:border-b md:border-line md:bg-page">
            <div className="relative flex items-center justify-between gap-3 md:mx-auto md:h-16 md:max-w-[1040px] md:px-8">
              <span className="flex items-center gap-2 text-[17px] font-semibold tracking-tight">
                <BrandMark size={22} />
                UAE Leasing
              </span>
              {/* The page's privacy note, one tap away instead of a footer that would push the pinned action up. */}
              <details className="group">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden">
                  <IconLock size={13} aria-hidden />
                  Secure link
                </summary>
                <p className="absolute right-0 top-full z-20 m-0 w-72 max-w-[calc(100vw-2.5rem)] rounded-xl border border-line bg-page p-3 text-xs leading-snug text-muted md:right-8">
                  This page is personal to you. Don&apos;t forward the link. Questions? Reply to the email you received.
                  Demo build: all details are fictional.
                </p>
              </details>
            </div>
          </div>
          {(unit || current) && (
            <div className="grid gap-3 md:mx-auto md:w-full md:max-w-[760px] md:gap-4 md:px-8 md:pt-10">
              {unit && <p className="m-0 text-sm text-muted md:text-[15px]">{unit}</p>}
              {current && <RecordStepper stages={STATUS_STAGES} current={current} />}
            </div>
          )}
        </header>
        <main
          className={`flex flex-1 flex-col px-5 pt-3 md:mx-auto md:mb-16 md:w-full md:max-w-[760px] md:flex-none md:px-8 md:pt-0 ${unit || current ? "md:mt-6" : "md:mt-10"}`}
        >
          <div className="flex flex-1 flex-col md:rounded-[20px] md:border md:border-line md:bg-page md:p-10">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
