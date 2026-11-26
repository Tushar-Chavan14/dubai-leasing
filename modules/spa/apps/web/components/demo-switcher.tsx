import type { SpaRole } from "@spa/core/roles";
import { SwitchButton } from "./demo-switch-button";

export interface DemoUserItem {
  email: string;
  name: string;
  role: SpaRole;
  roleLabel: string;
  shortRole?: string | undefined;
  cast?: boolean | undefined;
}

const ROW =
  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border-0 bg-transparent px-2 py-1.5 text-left font-sans text-[13px] text-ink hover:bg-raised disabled:cursor-default";

/** The avatar menu's "Switch demo user" list (S80): the cast first, then Back-office, the current user marked. Demo mode only. */
export function DemoSwitcher({
  users,
  currentEmail,
  demo,
}: {
  users: readonly DemoUserItem[];
  currentEmail: string | undefined;
  demo: boolean;
}) {
  if (!demo || users.length === 0) return null;
  const group = (list: readonly DemoUserItem[]) => (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {list.map((u) => {
        const current = u.email === currentEmail;
        const label = `${u.name.split(" ")[0]} (${u.shortRole ?? u.roleLabel})`;
        return (
          <li key={u.email}>
            {current ? (
              <span className={`${ROW} font-semibold`} aria-current="true">
                {label}
                <span className="text-xs text-muted">You</span>
              </span>
            ) : (
              <SwitchButton email={u.email} className={ROW}>
                {label}
              </SwitchButton>
            )}
          </li>
        );
      })}
    </ul>
  );
  const cast = users.filter((u) => u.cast);
  const back = users.filter((u) => !u.cast);
  return (
    <section aria-label="Switch demo user" className="grid gap-1 border-t border-line pt-2" data-demo-switcher>
      <b className="text-xs font-semibold text-muted">Switch demo user</b>
      {group(cast)}
      {back.length > 0 && (
        <>
          <b className="mt-1 text-xs font-semibold text-muted">Back-office</b>
          {group(back)}
        </>
      )}
    </section>
  );
}
