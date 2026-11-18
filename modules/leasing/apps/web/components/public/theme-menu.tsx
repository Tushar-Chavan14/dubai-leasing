import { CircleHalfIcon } from "@phosphor-icons/react/dist/ssr";
import type { Theme } from "../../lib/theme";
import { ThemeButtons } from "../theme-switch";

/** The theme switch for the public pages: an icon button that opens a small popover. Plain `details`, so it works without JavaScript. */
export function ThemeMenu({ current }: { current: Theme }) {
  return (
    <details className="group relative">
      <summary
        aria-label="Theme"
        className="grid size-9 cursor-pointer list-none place-items-center rounded-full border border-line text-ink marker:hidden hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink [&::-webkit-details-marker]:hidden"
      >
        <CircleHalfIcon size={18} aria-hidden="true" />
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-60 rounded-card border border-line bg-page p-3.5">
        <ThemeButtons current={current} />
      </div>
    </details>
  );
}
