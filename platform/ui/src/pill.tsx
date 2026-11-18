import type { HTMLAttributes } from "react";

const TONE = {
  neutral: "border-line bg-transparent text-muted",
  accent: "border-transparent bg-accent text-on-accent",
  danger: "border-danger bg-transparent text-danger",
  warning: "border-warning bg-transparent text-warning",
  /** Soft amber, for "waiting on you". */
  waiting: "border-transparent bg-warning/12 text-warning",
} as const;

/** Text is always present: tone colours never carry the meaning alone. */
export function Pill({ tone, className = "", ...rest }: HTMLAttributes<HTMLSpanElement> & { tone: keyof typeof TONE }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-sans text-xs font-semibold ${TONE[tone]} ${className}`}
      {...rest}
    />
  );
}
