import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr";
import { type PublicUnitSummary, hueOf, photoSrc } from "../../lib/listings";

/**
 * A unit photo, or, when it has none, a calm tinted tile with a building mark and the building's own name
 * (decision P8: never a stock image). It fills its parent box.
 */
export function Cover({
  building,
  photo,
  className = "",
  alt,
  label = true,
}: {
  building: PublicUnitSummary["building"];
  photo: string | undefined;
  className?: string;
  alt?: string;
  /** Show the small "no photo yet" caption (off for tiny thumbnails). */
  label?: boolean;
}) {
  const src = photoSrc(photo);
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt ?? building} className={`h-full w-full object-cover ${className}`} loading="lazy" />
    );
  const h = hueOf(building);
  return (
    <div
      className={`relative grid h-full w-full place-items-center overflow-hidden bg-raised text-muted ${className}`}
      style={{
        backgroundImage: `radial-gradient(90% 80% at 80% 0%, hsl(${h} 35% 55% / 0.22), transparent 65%), radial-gradient(70% 60% at 0% 100%, hsl(${h + 30} 30% 55% / 0.14), transparent 70%)`,
      }}
      role="img"
      aria-label={alt ?? building}
    >
      <BuildingsIcon size={44} weight="thin" aria-hidden="true" />
      {label && (
        <span className="absolute bottom-3 left-3.5 rounded-full border border-line bg-page/80 px-2.5 py-0.5 text-xs font-medium text-muted">
          No photo yet
        </span>
      )}
    </div>
  );
}
