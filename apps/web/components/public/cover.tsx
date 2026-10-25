import { type PublicUnitSummary, initials, photoSrc, placeholderStyle } from "../../lib/listings";

export function Arrow({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 14 14 6M7.5 6H14v6.5" />
    </svg>
  );
}

/** A unit photo, or the generated placeholder (decision P8) when it has none. */
export function Cover({
  building,
  photo,
  className = "",
  alt,
}: {
  building: PublicUnitSummary["building"];
  photo: string | undefined;
  className?: string;
  alt?: string;
}) {
  const src = photoSrc(photo);
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt ?? building} className={className} loading="lazy" />
  ) : (
    <div className={`pub-ph ${className}`} style={placeholderStyle(building)} role="img" aria-label={alt ?? building}>
      <span aria-hidden="true">{initials(building)}</span>
    </div>
  );
}
