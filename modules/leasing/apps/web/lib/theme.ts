export const THEME_COOKIE = "leasing_theme";
export const THEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;
export type Theme = (typeof THEMES)[number]["value"];

export function themeOf(v: unknown): Theme {
  return THEMES.some((t) => t.value === v) ? (v as Theme) : "system";
}
