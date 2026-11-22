import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr";

/** "Portal" in the avatar menu: back to the module chooser (`SPA_PORTAL_URL`). Sign-out stays this app's own. */
export function PortalLink({ href, className }: { href: string; className: string }) {
  return (
    <a href={href} className={className}>
      <SquaresFourIcon size={16} aria-hidden />
      Portal
    </a>
  );
}
