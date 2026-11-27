"use client";

import { CaretRightIcon } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { screenOf, type NavItem } from "../../lib/shell/nav";

/**
 * The sticky white bar above every staff page: where you are (module › screen) on the left, the date and the account
 * menu on the right. Pages keep their own breadcrumbs below it for the trail inside a screen.
 */
export function TopBar({ items, context, account }: { items: NavItem[]; context: ReactNode; account: ReactNode }) {
  const screen = screenOf(usePathname());
  const here = items.find((i) => i.screen === screen)?.label;
  return (
    <header className="ls-top">
      <div className="ls-crumb">
        <span>Leasing</span>
        {here && (
          <>
            <CaretRightIcon size={14} aria-hidden />
            <b>{here}</b>
          </>
        )}
      </div>
      <div className="ls-top-actions">
        {context}
        {account}
      </div>
    </header>
  );
}
