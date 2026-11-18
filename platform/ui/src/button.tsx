import type { ButtonHTMLAttributes } from "react";

const BASE =
  "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-full border font-sans font-semibold " +
  "transition-[transform,background-color] duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none " +
  "motion-reduce:active:scale-100 disabled:cursor-not-allowed disabled:opacity-50 " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";
const VARIANT = {
  primary: "border-transparent bg-primary text-on-primary",
  ghost: "border-line bg-transparent text-ink",
  quiet: "border-transparent bg-transparent text-muted",
  danger: "border-danger bg-transparent text-danger",
} as const;
const SIZE = { sm: "h-9 px-4 text-sm", md: "px-4 py-2.5 text-base" } as const;

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant: keyof typeof VARIANT;
  size?: keyof typeof SIZE;
};

// globals.css sets `a { color: inherit }` outside any layer, which beats utilities, so links need important colours.
const LINK_COLOR = {
  primary: "text-on-primary!",
  ghost: "text-ink!",
  quiet: "text-muted!",
  danger: "text-danger!",
} as const;

/** Class string for a link that should look like a Button. */
export const buttonClass = (variant: keyof typeof VARIANT, size: keyof typeof SIZE = "md") =>
  `${BASE} ${VARIANT[variant]} ${LINK_COLOR[variant]} ${SIZE[size]}`;

export function Button({ variant, size = "md", className = "", type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`} {...rest} />;
}

/** Square icon-only button (36px). Always give it an `aria-label` and a `title`. */
export const iconButtonClass = (variant: "ghost" | "danger" = "ghost") =>
  `${BASE} size-9 shrink-0 p-0 ${variant === "danger" ? "border-line bg-transparent text-danger hover:border-danger" : "border-line bg-transparent text-ink hover:border-ink"}`;
