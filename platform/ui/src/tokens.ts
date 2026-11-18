/** Redesign colour tokens. Keep in sync with app/tailwind.css (the contrast test guards the pairs). */
export type Palette = {
  page: string;
  raised: string;
  ink: string;
  muted: string;
  line: string;
  accent: string;
  onAccent: string;
  primary: string;
  onPrimary: string;
  danger: string;
  warning: string;
};

export const TOKENS: { light: Palette; dark: Palette } = {
  light: {
    page: "#ffffff",
    raised: "#f4f6f1",
    ink: "#0b0b0b",
    muted: "#5b6157",
    line: "#e2e6dc",
    accent: "#dbe6cf",
    onAccent: "#0b0b0b",
    primary: "#0b0b0b",
    onPrimary: "#ffffff",
    danger: "#b42318",
    warning: "#8a5200",
  },
  dark: {
    page: "#0b0b0b",
    raised: "#151714",
    ink: "#f4f6f1",
    muted: "#a1a89b",
    line: "#2a2d27",
    accent: "#dbe6cf",
    onAccent: "#0b0b0b",
    primary: "#dbe6cf",
    onPrimary: "#0b0b0b",
    danger: "#f97066",
    warning: "#f5b942",
  },
};
