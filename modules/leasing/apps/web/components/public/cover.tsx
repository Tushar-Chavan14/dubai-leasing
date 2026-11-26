import { Cover as PlatformCover } from "@platform/ui/media/cover";
import { type PublicUnitSummary, photoSrc } from "../../lib/listings";

/**
 * A unit photo, or, when it has none, a calm tinted tile with a building mark and the building's own name
 * (decision P8: never a stock image). It fills its parent box. Thin wrapper over the shared `Cover`: it maps the
 * engine photo path to the web proxy URL.
 */
export function Cover({
  building,
  photo,
  className,
  alt,
  label,
}: {
  building: PublicUnitSummary["building"];
  photo: string | undefined;
  className?: string;
  alt?: string;
  /** Show the small "no photo yet" caption (off for tiny thumbnails). */
  label?: boolean;
}) {
  return (
    <PlatformCover
      name={building}
      src={photoSrc(photo) ?? undefined}
      {...(className !== undefined && { className })}
      {...(alt !== undefined && { alt })}
      {...(label !== undefined && { label })}
    />
  );
}
