import { DEMO_SHORT_ROLE } from "@spa/core/demo";
import type { SpaRole } from "@spa/core/roles";
import { publicEngine } from "../lib/engine";
import { SwitchButton } from "./demo-switch-button";

export interface HandoffTarget {
  name: string;
  email: string;
  roleLabel: string;
}

const first = (name: string) => name.split(" ")[0] ?? name;

/**
 * The hand-off's markup, with no fetching: "Waiting for Omar (Legal) · Switch to Omar". `under` is a compliance review
 * seen by someone outside compliance (S20): it says "Under review" and names the person and role only, never a flag,
 * a match or a reason. With no demo user for the role it says so and draws no button.
 */
export function HandoffView({
  target,
  role,
  under = false,
}: {
  target: HandoffTarget | null;
  role: SpaRole;
  under?: boolean;
}) {
  if (!target)
    return (
      <p className="m-0 text-[13px]" data-demo-handoff>
        {under ? "Under review" : "Waiting"} · No demo user has this role ({DEMO_SHORT_ROLE[role]})
      </p>
    );
  const who = `${first(target.name)} (${target.roleLabel})`;
  return (
    <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]" data-demo-handoff>
      <span>{under ? `Under review · ${who}` : `Waiting for ${who}`}</span>
      <SwitchButton
        email={target.email}
        className="cursor-pointer rounded-full border border-current bg-transparent px-3 py-1 font-sans text-[13px] font-semibold text-inherit hover:opacity-80"
      >
        Switch to {first(target.name)}
        <span className="sr-only"> ({target.roleLabel}), demo only</span>
      </SwitchButton>
    </p>
  );
}

async function loadTarget(role: SpaRole): Promise<HandoffTarget | null> {
  const res = await publicEngine()
    .api.demo.handoff.$get({ query: { role } })
    .catch(() => null);
  if (!res?.ok) return null;
  return (await res.json()) as HandoffTarget | null;
}

async function HandoffFor({ role, under }: { role: SpaRole; under: boolean }) {
  return <HandoffView target={await loadTarget(role)} role={role} under={under} />;
}

/**
 * Demo mode only: names who a waiting step needs and offers a one-click switch to them on the same page. With demo
 * mode off it renders nothing (the card keeps its normal wording). It changes no role, gate or approver.
 */
export function DemoHandoff({ role, demo, under = false }: { role: SpaRole; demo: boolean; under?: boolean }) {
  if (!demo) return null;
  return <HandoffFor role={role} under={under} />;
}
