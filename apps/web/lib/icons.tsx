import type { SVGProps } from "react";

/** A small, consistent icon set: 20px grid, 1.5px stroke, round joins. Decorative by default. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const IconInbox = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 11.5 5 4.5h10l2 7" />
    <path d="M3 11.5V15.5h14v-4h-4l-1 2H8l-1-2Z" />
  </Icon>
);
/** Enquiries: a speech bubble. */
export const IconChat = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H9l-3.5 3v-3H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z" />
  </Icon>
);
export const IconHome = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 9 10 3.5 16.5 9" />
    <path d="M5 8v8.5h10V8" />
  </Icon>
);
export const IconKey = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7" cy="10" r="3.25" />
    <path d="M10.25 10H17M14.5 10v2.5M16.5 10v2" />
  </Icon>
);
export const IconBuilding = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 17V3.5h7V17M11.5 7.5h4V17" />
    <path d="M7 6.5h2M7 9.5h2M7 12.5h2M3 17h14" />
  </Icon>
);
export const IconChecklist = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3.5 5.5 1.5 1.5 2.5-3M3.5 12.5l1.5 1.5 2.5-3" />
    <path d="M10 5.5h6.5M10 12.5h6.5" />
  </Icon>
);
export const IconUpload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 13V3.5M6.5 7 10 3.5 13.5 7" />
    <path d="M3.5 13v3.5h13V13" />
  </Icon>
);
export const IconClock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.75" />
    <path d="M10 6.5V10l2.5 1.5" />
  </Icon>
);
export const IconPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icon>
);
export const IconCheck = (p: IconProps) => (
  <Icon {...p}>
    <path d="m4.5 10.5 3.5 3.5 7.5-8" />
  </Icon>
);
export const IconCircle = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="5.5" />
  </Icon>
);
export const IconChevronLeft = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4.5 6.5 10l5.5 5.5" />
  </Icon>
);
export const IconChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8 4.5 5.5 5.5L8 15.5" />
  </Icon>
);
export const IconTrash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 6h12M8 6V4h4v2M5.5 6l.75 10h7.5L14.5 6" />
  </Icon>
);
export const IconStar = (p: IconProps) => (
  <Icon {...p}>
    <path d="m10 3.5 1.9 4 4.35.5-3.2 3 .85 4.3L10 13.2l-3.9 2.1.85-4.3-3.2-3 4.35-.5Z" />
  </Icon>
);
export const IconImage = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="14" height="12" rx="2" />
    <circle cx="7.5" cy="8.5" r="1.25" />
    <path d="m3.5 14 4-3.5 3 2.5 2-1.5 4 3" />
  </Icon>
);
export const IconWarning = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.5 17 16H3Z" />
    <path d="M10 8.5v3.5M10 14v.01" />
  </Icon>
);
export const IconExit = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 4H4.5v12H8M12.5 6.5 16 10l-3.5 3.5M16 10H8" />
  </Icon>
);
export const IconBed = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 15.5V5M3 11.5h14v4M17 11.5V9.5a2 2 0 0 0-2-2H9.5v4" />
    <circle cx="6" cy="9" r="1.25" />
  </Icon>
);
export const IconArea = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="13" height="13" rx="1" />
    <path d="M7 3.5v3M3.5 10h4M12 16.5V12h4.5" />
  </Icon>
);

/** Brand mark: a leaf on a stem, drawn in the accent colour. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect width="24" height="24" rx="7" fill="var(--accent)" />
      <path d="M12 19V9.5" stroke="var(--accent-ink)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 12.5c-3.2 0-5-2-5-5 3.2 0 5 1.8 5 5Z" fill="var(--accent-ink)" opacity=".9" />
      <path d="M12 10.5c3.2 0 5-2 5-5-3.2 0-5 1.8-5 5Z" fill="var(--accent-ink)" />
    </svg>
  );
}

/** The copilot: a four-point spark (asks, doesn't act). */
export const IconSpark = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 2.5c.5 3.6 1.9 5 5.5 5.5-3.6.5-5 1.9-5.5 5.5-.5-3.6-1.9-5-5.5-5.5 3.6-.5 5-1.9 5.5-5.5Z" />
    <path d="M15.5 13.5c.2 1.3.7 1.8 2 2-1.3.2-1.8.7-2 2-.2-1.3-.7-1.8-2-2 1.3-.2 1.8-.7 2-2Z" />
  </Icon>
);

export const IconClose = (p: IconProps) => (
  <Icon {...p}>
    <path d="m5 5 10 10M15 5 5 15" />
  </Icon>
);

export const IconPeople = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="7.5" cy="7" r="2.8" />
    <path d="M2.8 16c.4-2.8 2.3-4.4 4.7-4.4s4.3 1.6 4.7 4.4" />
    <path d="M13 4.6a2.6 2.6 0 0 1 0 5.1M14.4 11.8c1.6.5 2.6 1.9 2.8 4.2" />
  </Icon>
);

export const IconId = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" />
    <circle cx="7" cy="9.3" r="1.7" />
    <path d="M4.6 13c.5-1.1 1.3-1.7 2.4-1.7s1.9.6 2.4 1.7M11.5 8.5h3.5M11.5 11.5h2.5" />
  </Icon>
);
/** Rulebook: a closed book with a bookmark. */
export const IconBook = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 4A1.5 1.5 0 0 1 6 2.5h9.5v12H6a1.5 1.5 0 0 0-1.5 1.5Z" />
    <path d="M4.5 16A1.5 1.5 0 0 0 6 17.5h9.5v-3" />
    <path d="M8 2.5v6l1.75-1.25L11.5 8.5v-6" />
  </Icon>
);
