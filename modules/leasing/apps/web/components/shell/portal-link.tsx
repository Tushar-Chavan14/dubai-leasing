import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr";

/** "Portal" in the avatar menu: back to the module chooser (`LEASING_PORTAL_URL`). Sign-out stays this app's own. */
export function PortalLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-full border border-line bg-transparent font-sans text-sm font-semibold !text-ink no-underline hover:bg-raised"
    >
      <SquaresFourIcon size={16} aria-hidden />
      Portal
    </a>
  );
}
