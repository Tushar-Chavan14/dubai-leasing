/** The site's mark: an "S" on the primary colour, the same one the staff rail wears. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.6) }}
      className="grid shrink-0 place-items-center rounded-[7px] bg-primary font-semibold leading-none text-on-primary"
    >
      S
    </span>
  );
}
