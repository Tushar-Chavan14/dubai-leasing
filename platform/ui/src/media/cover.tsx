import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr";
import { hueOf } from "./hue";

/**
 * A photo, or, when it has none, a calm tinted tile with a building mark and the item's own name
 * (never a stock image). It fills its parent box. `src` is a ready URL: nothing is rewritten here.
 */
export function Cover({
  name,
  src,
  className = "",
  alt,
  label = true,
  emptyLabel = "No photo yet",
}: {
  /** Seeds the placeholder hue and the default alt text. */
  name: string;
  src: string | undefined;
  className?: string;
  alt?: string;
  /** Show the small caption (off for tiny thumbnails). */
  label?: boolean;
  emptyLabel?: string;
}) {
  if (src)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={alt ?? name} className={`h-full w-full object-cover ${className}`} loading="lazy" />
    );
  const h = hueOf(name);
  return (
    <div
      className={`relative grid h-full w-full place-items-center overflow-hidden bg-raised text-muted ${className}`}
      style={{
        backgroundImage: `radial-gradient(90% 80% at 80% 0%, hsl(${h} 35% 55% / 0.22), transparent 65%), radial-gradient(70% 60% at 0% 100%, hsl(${h + 30} 30% 55% / 0.14), transparent 70%)`,
      }}
      role="img"
      aria-label={alt ?? name}
    >
      <BuildingsIcon size={44} weight="thin" aria-hidden="true" />
      {label && (
        <span className="absolute bottom-3 left-3.5 rounded-full border border-line bg-page/80 px-2.5 py-0.5 text-xs font-medium text-muted">
          {emptyLabel}
        </span>
      )}
    </div>
  );
}
