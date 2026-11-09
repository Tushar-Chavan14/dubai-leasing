import { LockIcon } from "@phosphor-icons/react/dist/ssr";

/** Shown instead of the Units pages to roles that may not see them (admin, leasing manager, leasing officer only). */
export function NotAllowed() {
  return (
    <div className="mx-auto grid max-w-md justify-items-center gap-3 rounded-2xl border border-line px-6 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-accent text-on-accent">
        <LockIcon size={20} aria-hidden />
      </span>
      <h1 className="m-0 font-sans text-xl font-semibold tracking-tight text-ink">
        Units are not available to your role
      </h1>
      <p className="m-0 text-sm text-muted">Units are managed by leasing staff. Ask an admin if you need access.</p>
    </div>
  );
}
