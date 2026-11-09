import type { ReactNode } from "react";

/** Form look shared by the Workspace forms. Plain Tailwind; colours come from the tokens. */
export const FIELD = "grid gap-1.5";
export const LABEL = "text-xs font-semibold text-muted";
export const HINT = "text-xs font-normal text-muted";
export const INPUT =
  "w-full rounded-input border border-line bg-page px-3 py-2 font-sans text-sm text-ink placeholder:text-muted hover:border-ink focus:border-ink aria-[invalid=true]:border-danger";
export const ACTIONS = "flex flex-wrap items-center gap-2";

/** A success or error banner. */
export function Banner({
  tone,
  children,
  role,
}: {
  tone: "good" | "bad" | "warn";
  children: ReactNode;
  role?: "status" | "alert";
}) {
  const t =
    tone === "good"
      ? "border-line bg-accent text-on-accent"
      : tone === "bad"
        ? "border-danger text-danger"
        : "border-warning text-warning";
  return (
    <div
      {...(role ? { role } : {})}
      className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm [&_ul]:m-0 [&_ul]:mt-1 [&_ul]:pl-4 ${t}`}
    >
      {children}
    </div>
  );
}
