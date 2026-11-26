import { HeroPanel as PlatformHeroPanel } from "@platform/ui/catalogue/hero-panel";
import { rentShort } from "../../lib/listings";

export { Skyline } from "@platform/ui/catalogue/hero-panel";

/**
 * The hero's right side when no listing has a photo (the demo units have none). A drawn skyline on the brand's
 * soft green with two plain facts from the listings, so the space reads as designed, not as a missing image.
 */
export function HeroPanel({ count, from, areas }: { count: number; from: string | undefined; areas: number }) {
  return (
    <PlatformHeroPanel
      count={count}
      from={from ? rentShort(from) : undefined}
      areas={areas}
      labels={{
        headline: "Homes across the UAE, ready to view",
        count: "Open for site visits",
        one: "property",
        many: "properties",
        areas: "in {n} areas",
        from: "Rent from",
        per: "/yr",
      }}
    />
  );
}
