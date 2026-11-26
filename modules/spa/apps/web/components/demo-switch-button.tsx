"use client";

import { useTransition } from "react";
import { switchDemoUser } from "../app/demo-switch/actions";

/** Switches to a demo user and reloads the page you are on (the address is read at the click). Demo mode only. */
export function SwitchButton({
  email,
  className,
  children,
}: {
  email: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [busy, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={() => start(() => switchDemoUser(email, window.location.pathname + window.location.search))}
    >
      {children}
    </button>
  );
}
