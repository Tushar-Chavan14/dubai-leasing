import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeSwitch } from "../../components/theme-switch";
import { ChatLauncher } from "../../components/public/chat-launcher";
import { CustomerNav } from "../../components/public/customer-nav";
import { BrandMark } from "../../lib/icons";
import { THEME_COOKIE, themeOf } from "../../lib/theme";

/** The customer section: /customer/properties and /customer/chat share this bar, nav and footer. */
export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <div className="pub">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="pub-bar">
        <div className="pub-bar-inner">
          <Link href="/customer/properties" className="pub-brand">
            <BrandMark size={22} />
            Dubai Leasing
          </Link>
          <CustomerNav />
          <ThemeSwitch current={theme} />
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="pub-foot">
        <div className="pub-wrap">Demo build. All homes are fictional.</div>
      </footer>
      <ChatLauncher />
    </div>
  );
}
