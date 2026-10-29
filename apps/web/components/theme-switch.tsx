import { THEMES, type Theme } from "../lib/theme";
import { setTheme } from "../app/theme-actions";

/** System / Light / Dark. Plain buttons in a form so it works without JavaScript. */
export function ThemeSwitch({ current }: { current: Theme }) {
  return (
    <details className="theme-menu">
      <summary aria-label="Theme">Theme</summary>
      <form action={setTheme} className="theme-pop">
        <span className="theme-label" id="theme-label">
          Theme
        </span>
        <div className="segmented" role="group" aria-labelledby="theme-label">
          {THEMES.map((t) => (
            <button key={t.value} type="submit" name="theme" value={t.value} aria-pressed={current === t.value}>
              {t.label}
            </button>
          ))}
        </div>
      </form>
    </details>
  );
}
