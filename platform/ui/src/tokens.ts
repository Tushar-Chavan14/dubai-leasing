/** Redesign colour tokens. Keep in sync with app/tailwind.css (the contrast test guards the pairs). */
export type Palette = {
  canvas: string;
  page: string;
  raised: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  onAccent: string;
  primary: string;
  onPrimary: string;
  /** Call-to-action buttons: near-black in light, near-white in dark. */
  cta: string;
  onCta: string;
  success: string;
  danger: string;
  warning: string;
  rail: string;
  railInk: string;
  railActive: string;
};

export const TOKENS: { light: Palette; dark: Palette } = {
  light: {
    canvas: "#f3f5fa",
    page: "#ffffff",
    raised: "#f7f9fd",
    ink: "#111a3a",
    muted: "#56607d",
    line: "#e2e7f1",
    accent: "#e8eefd",
    onAccent: "#2a52c9",
    primary: "#2f62e3",
    onPrimary: "#ffffff",
    cta: "#0b1020",
    onCta: "#ffffff",
    success: "#12804e",
    danger: "#b42318",
    warning: "#8a5200",
    rail: "#0f1c4d",
    railInk: "#aab5d8",
    railActive: "#4677ee",
  },
  dark: {
    canvas: "#0a1029",
    page: "#111a3b",
    raised: "#16214a",
    ink: "#e9edf8",
    muted: "#9ba7c9",
    line: "#253262",
    accent: "#1d2c62",
    onAccent: "#b3c7ff",
    primary: "#7aa0ff",
    onPrimary: "#0a1029",
    cta: "#f2f4fb",
    onCta: "#0a1029",
    success: "#4cd497",
    danger: "#f97066",
    warning: "#f5b942",
    rail: "#070d24",
    railInk: "#8f9cc4",
    railActive: "#4677ee",
  },
};
