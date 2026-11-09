import { cookies } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChatLauncher } from "../../components/public/chat-launcher";
import { CustomerNav } from "../../components/public/customer-nav";
import { ThemeMenu } from "../../components/public/theme-menu";
import { buttonClass } from "../../components/ui/button";
import { BrandMark } from "../../lib/icons";
import { THEME_COOKIE, themeOf } from "../../lib/theme";

/** The customer section: /customer/properties and /customer/chat share this bar, nav and footer. */
export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const theme = themeOf((await cookies()).get(THEME_COOKIE)?.value);
  return (
    // The chat page is an app screen: it fills the window exactly (no footer, no page scroll), so only the message
    // list scrolls.
    <div className="group/site flex min-h-dvh flex-col bg-page font-sans text-ink has-[[data-fit-screen]]:h-dvh has-[[data-fit-screen]]:overflow-hidden">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="[position:sticky] top-0 z-30 border-b border-line bg-page/95 backdrop-blur">
        <div className="mx-auto grid w-full max-w-[1240px] grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[1fr_auto_1fr] md:px-8 md:py-4">
          <Link
            href="/customer/properties"
            className="flex w-fit items-center gap-2 text-[17px] font-semibold tracking-tight"
          >
            <BrandMark size={22} />
            Dubai Leasing
          </Link>
          <div className="col-span-2 row-start-2 -mx-1 overflow-x-auto md:col-span-1 md:col-start-2 md:row-start-1 md:mx-0">
            <CustomerNav />
          </div>
          <div className="flex items-center justify-end gap-2 md:col-start-3">
            <ThemeMenu current={theme} />
            <Link href="/customer/properties#homes" className={buttonClass("primary", "sm")}>
              Book a viewing
            </Link>
          </div>
        </div>
      </header>
      <main
        id="main"
        className="flex-1 group-has-[[data-fit-screen]]/site:flex group-has-[[data-fit-screen]]/site:min-h-0 group-has-[[data-fit-screen]]/site:flex-col"
      >
        {children}
      </main>
      <footer className="mt-16 group-has-[[data-fit-screen]]/site:hidden border-t border-line py-7 pb-24 text-[13px] text-muted">
        <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-2 px-4 md:px-8">
          <span className="flex items-center gap-2 font-semibold text-ink">
            <BrandMark size={18} />
            Dubai Leasing
          </span>
          <span>Demo build. All homes are fictional.</span>
        </div>
      </footer>
      <ChatLauncher />
    </div>
  );
}
