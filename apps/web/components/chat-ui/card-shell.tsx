import type { ReactNode } from "react";
import { Pill } from "../ui/pill";

/** A card under a copilot answer: bordered, 14px radius, no shadow, title left and a status pill right. */
export function CardShell({
  title,
  status,
  tone,
  children,
}: {
  title: ReactNode;
  status: string;
  tone: "waiting" | "accent" | "neutral";
  children: ReactNode;
}) {
  return (
    <div className="mt-2.5 grid gap-2.5 rounded-[14px] border border-line bg-page px-4 py-3.5 font-sans text-sm text-ink">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-[15px] font-semibold tracking-tight">{title}</strong>
        <Pill tone={tone} className="flex-none">
          {status}
        </Pill>
      </div>
      {children}
    </div>
  );
}

/** Label and value pairs. */
export function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="m-0 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm [&_dd]:m-0 [&_dd]:break-words [&_dt]:text-muted">
      {children}
    </dl>
  );
}

export const CardNote = ({ children }: { children: ReactNode }) => (
  <p className="m-0 text-[13px] text-muted">{children}</p>
);

export const CardError = ({ children }: { children: ReactNode }) => (
  <p role="alert" className="m-0 text-[13px] text-danger">
    {children}
  </p>
);
