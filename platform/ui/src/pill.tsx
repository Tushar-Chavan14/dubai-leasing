import type { HTMLAttributes } from "react";

const TONE = {
  neutral: "border-line bg-transparent text-muted",
  accent: "border-transparent bg-accent text-on-accent",
  /** Soft green, for done, signed, matched. */
  success: "border-transparent bg-success/12 text-success",
  danger: "border-transparent bg-danger/10 text-danger",
  warning: "border-transparent bg-warning/12 text-warning",
  /** Soft amber, for "waiting on you". */
  waiting: "border-transparent bg-warning/12 text-warning",
} as const;

/** Text is always present: tone colours never carry the meaning alone. */
export function Pill({ tone, className = "", ...rest }: HTMLAttributes<HTMLSpanElement> & { tone: keyof typeof TONE }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 font-sans text-xs font-semibold leading-none ${TONE[tone]} ${className}`}
      {...rest}
    />
  );
}
