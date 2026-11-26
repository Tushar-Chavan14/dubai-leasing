import type { SpaRole } from "@spa/core/roles";
import { demoSignIn } from "../app/sign-in/actions";

export interface DemoPickUser {
  email: string;
  name: string;
  role: SpaRole;
  roleLabel: string;
  shortRole?: string | undefined;
  cast?: boolean | undefined;
  hint?: string | undefined;
}

const first = (n: string) => n.split(" ")[0] ?? n;

function Card({ u, big }: { u: DemoPickUser; big: boolean }) {
  return (
    <li>
      <form action={demoSignIn}>
        <input type="hidden" name="email" value={u.email} />
        <button
          type="submit"
          className="grid w-full cursor-pointer gap-0.5 rounded-xl border border-line bg-page px-3.5 py-2.5 text-left font-sans text-sm text-ink hover:bg-raised"
        >
          <span className="font-semibold">
            {first(u.name)} ({u.shortRole ?? u.roleLabel})
          </span>
          {u.hint && <span className={`${big ? "text-[12.5px]" : "text-xs"} text-muted`}>{u.hint}</span>}
        </button>
      </form>
    </li>
  );
}

/**
 * Demo sign-in (S33, S80): four cards for the people a presenter needs, each with what you'll show, and the other
 * back-office roles in a collapsed disclosure for the step that needs them. Fictional users, no passwords.
 */
export function DemoPicker({ users }: { users: readonly DemoPickUser[] }) {
  const cast = users.filter((u) => u.cast);
  const back = users.filter((u) => !u.cast);
  return (
    <section aria-labelledby="demo-users" className="grid gap-2">
      <h2 id="demo-users" className="m-0 text-[15px] font-semibold text-ink">
        Choose a demo user
      </h2>
      <p className="m-0 text-[12.5px] text-muted">Fictional staff. Start with these four.</p>
      <ul className="m-0 grid list-none gap-2 p-0">
        {cast.map((u) => (
          <Card key={u.email} u={u} big />
        ))}
      </ul>
      {back.length > 0 && (
        <details className="rounded-xl border border-line bg-page">
          <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-semibold text-ink">
            Back-office roles (only when a step needs them)
          </summary>
          <ul className="m-0 grid list-none gap-2 p-2 pt-0">
            {back.map((u) => (
              <Card key={u.email} u={u} big={false} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
