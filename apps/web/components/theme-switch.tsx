import { THEMES, type Theme } from "../lib/theme";
import { setTheme } from "../app/theme-actions";

/** The same three choices laid flat, for the account menu. A form post, so it works without JavaScript. */
export function ThemeButtons({ current }: { current: Theme }) {
  return (
    <form action={setTheme} className="grid gap-1.5">
      <span id="theme-buttons-label" className="text-xs text-muted">
        Theme
      </span>
      <div
        role="group"
        aria-labelledby="theme-buttons-label"
        className="inline-flex rounded-full border border-line bg-raised p-0.5"
      >
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="submit"
            name="theme"
            value={t.value}
            aria-pressed={current === t.value}
            className={`h-8 flex-1 cursor-pointer rounded-full border-0 px-3 font-sans text-sm font-semibold ${
              current === t.value ? "bg-primary text-on-primary" : "bg-transparent text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </form>
  );
}
