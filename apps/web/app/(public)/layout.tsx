import Link from "next/link";
import type { ReactNode } from "react";
import { ChatLauncher } from "../../components/public/chat-launcher";
import { BrandMark } from "../../lib/icons";

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="pub">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="pub-bar">
        <div className="pub-bar-inner">
          <Link href="/properties" className="pub-brand">
            <BrandMark size={22} />
            Dubai Leasing
          </Link>
          <nav aria-label="Main">
            <Link href="/properties">Properties</Link>
          </nav>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="pub-foot">
        <div className="pub-wrap">Demo build — all homes are fictional</div>
      </footer>
      <ChatLauncher />
    </div>
  );
}
