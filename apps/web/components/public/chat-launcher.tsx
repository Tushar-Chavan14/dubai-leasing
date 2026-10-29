"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The floating "Chat with us" link on the properties pages. It opens the full chat page. */
export function ChatLauncher() {
  const pathname = usePathname();
  if (pathname === "/customer/chat") return null;
  return (
    <Link href="/customer/chat" className="pub-fab">
      <svg
        width="18"
        height="18"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 5.5h12v7H9.5L6 15.5v-3H4Z" />
      </svg>
      Chat with us
    </Link>
  );
}
