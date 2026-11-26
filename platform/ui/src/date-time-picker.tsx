"use client";

import { CaretLeftIcon, CaretRightIcon, CalendarBlankIcon, ClockIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * iOS-style date and time pickers: compact grey pills that open an inline month calendar and hour/minute wheels.
 * Values are plain strings ("YYYY-MM-DD", "HH:mm") in Dubai time; `DateTimeFields` joins them into one hidden
 * `YYYY-MM-DDTHH:mm` input, the same value a datetime-local input posts, so server actions are unchanged.
 * Calendar maths runs on calendar numbers only (no clock reads): "today" comes from the caller.
 */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return { y: y!, m: m! - 1, d: d! };
};
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
/** Monday-first column of the 1st of the month. */
const firstCol = (y: number, m: number) => (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7;
const weekday = (s: string) => {
  const { y, m, d } = parse(s);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m, d)).getUTCDay()];
};

export const dateLabel = (s: string) => {
  const { m, d, y } = parse(s);
  return `${weekday(s)}, ${d} ${MONTHS[m]!.slice(0, 3)} ${y}`;
};
export const timeLabel = (s: string) => {
  const [h, min] = s.split(":").map(Number);
  return `${((h! + 11) % 12) + 1}:${pad(min!)} ${h! < 12 ? "AM" : "PM"}`;
};

const PILL =
  "inline-flex h-10 cursor-pointer items-center gap-2 rounded-[10px] border-0 bg-raised px-3.5 font-sans text-[15px] font-medium text-ink ring-1 ring-line transition-colors hover:bg-accent/60 aria-expanded:bg-accent aria-expanded:text-on-accent aria-expanded:ring-primary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
const POP =
  "absolute top-[calc(100%+8px)] left-0 z-30 rounded-2xl border border-line bg-page p-3 shadow-[0_18px_50px_-12px_rgb(16_28_77/0.35)]";

/** A pill that opens a popover; closes on outside click and Escape. */
function Popover({
  label,
  icon,
  value,
  placeholder,
  children,
}: {
  label: string;
  icon: ReactNode;
  value: string | null;
  placeholder: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative grid gap-1.5">
      <span id={`${id}-l`} className="text-xs font-semibold text-muted">
        {label}
      </span>
      <button
        type="button"
        aria-labelledby={`${id}-l ${id}-v`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={PILL}
      >
        <span aria-hidden className="text-muted">
          {icon}
        </span>
        <span id={`${id}-v`} className={value ? "" : "text-muted"}>
          {value ?? placeholder}
        </span>
      </button>
      {open && (
        <div role="dialog" aria-label={label} className={POP}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Month calendar, Monday first; days before `min` are disabled. */
function Calendar({ value, min, onPick }: { value: string; min: string; onPick: (d: string) => void }) {
  const start = parse(value || min);
  const [view, setView] = useState({ y: start.y, m: start.m });
  const minP = parse(min);
  const atMin = view.y === minP.y && view.m === minP.m;
  const step = (n: number) =>
    setView(({ y, m }) => ({ y: y + Math.floor((m + n) / 12), m: (((m + n) % 12) + 12) % 12 }));
  const cells = [
    ...Array.from({ length: firstCol(view.y, view.m) }, () => null),
    ...Array.from({ length: daysIn(view.y, view.m) }, (_, i) => i + 1),
  ];
  return (
    <div className="w-[272px] font-sans">
      <div className="mb-2 flex items-center justify-between px-1">
        <b className="text-[15px] font-semibold text-ink">
          {MONTHS[view.m]} {view.y}
        </b>
        <span className="flex gap-1">
          <button
            type="button"
            aria-label="Previous month"
            disabled={atMin}
            onClick={() => step(-1)}
            className="grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-primary hover:bg-accent disabled:cursor-default disabled:opacity-30"
          >
            <CaretLeftIcon size={16} weight="bold" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => step(1)}
            className="grid size-8 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-primary hover:bg-accent"
          >
            <CaretRightIcon size={16} weight="bold" />
          </button>
        </span>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-muted" aria-hidden>
        {WEEKDAYS.map((w, i) => (
          <span key={i} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const s = ymd(view.y, view.m, d);
          const selected = s === value;
          const isMin = s === min;
          const past = s < min;
          return (
            <button
              key={s}
              type="button"
              disabled={past}
              aria-pressed={selected}
              aria-label={dateLabel(s)}
              onClick={() => onPick(s)}
              className={`mx-auto grid size-9 cursor-pointer place-items-center rounded-full border-0 text-[15px] tabular-nums transition-colors disabled:cursor-default disabled:opacity-30 ${
                selected
                  ? "bg-primary font-semibold text-on-primary"
                  : isMin
                    ? "bg-transparent font-semibold text-primary hover:bg-accent"
                    : "bg-transparent text-ink hover:bg-accent"
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const ROW = 36;

/** One snapping wheel column, like an iOS picker: scroll or click; the centred row is the value. */
function Wheel({
  items,
  value,
  onChange,
  label,
}: {
  items: string[];
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The scroll handler fires after re-renders; it reads the latest value and callback, never a stale one.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  /** Jump (not animate) to a row: a smooth scroll can be interrupted and then settle on the wrong row. */
  const jump = (i: number) => ref.current?.scrollTo({ top: i * ROW });
  useEffect(() => {
    const i = Math.max(0, items.indexOf(value));
    ref.current?.scrollTo({ top: i * ROW });
    // Only on open: later changes come from the wheel itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const settle = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const i = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ROW)));
      if (items[i] !== latest.current.value) latest.current.onChange(items[i]!);
    }, 90);
  };
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      tabIndex={0}
      onScroll={settle}
      onKeyDown={(e) => {
        const i = items.indexOf(value);
        const n = e.key === "ArrowDown" ? i + 1 : e.key === "ArrowUp" ? i - 1 : -1;
        if (n < 0 || n >= items.length) return;
        e.preventDefault();
        onChange(items[n]!);
        jump(n);
      }}
      className="relative h-[180px] w-16 snap-y snap-mandatory overflow-y-auto overscroll-contain py-[72px] [scrollbar-width:none] [mask-image:linear-gradient(transparent,#000_30%,#000_70%,transparent)] focus-visible:outline-none"
    >
      {items.map((it, i) => (
        <div
          key={it}
          role="option"
          aria-selected={it === value}
          onClick={() => {
            onChange(it);
            jump(i);
          }}
          className={`grid h-9 cursor-pointer snap-center place-items-center font-sans text-[20px] tabular-nums ${it === value ? "font-semibold text-ink" : "text-muted"}`}
        >
          {it}
        </div>
      ))}
    </div>
  );
}

/** Hour (00–23) and minute wheels in `step`-minute steps, over a grey selection band. */
function TimeWheels({ value, step, onChange }: { value: string; step: number; onChange: (v: string) => void }) {
  const [h = "10", m = "00"] = value ? value.split(":") : [];
  const hours = Array.from({ length: 24 }, (_, i) => pad(i));
  const mins = Array.from({ length: 60 / step }, (_, i) => pad(i * step));
  return (
    <div className="relative flex items-center gap-1 px-2">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-2 top-1/2 h-9 -translate-y-1/2 rounded-[10px] bg-raised ring-1 ring-line"
      />
      <Wheel label="Hour" items={hours} value={h} onChange={(v) => onChange(`${v}:${m}`)} />
      <span aria-hidden className="relative font-sans text-[20px] font-semibold text-ink">
        :
      </span>
      <Wheel label="Minutes" items={mins} value={mins.includes(m) ? m : "00"} onChange={(v) => onChange(`${h}:${v}`)} />
      <span aria-hidden className="relative w-12 font-sans text-xs font-semibold text-muted">
        {Number(h) < 12 ? "AM" : "PM"}
      </span>
    </div>
  );
}

/**
 * A date field and a time field side by side, posting one `name` value as `YYYY-MM-DDTHH:mm` (Dubai).
 * The hidden value stays empty until both are chosen, so `required` validation is done by `onReady`.
 */
export function DateTimeFields({
  name,
  min,
  step = 15,
  defaultDate = "",
  defaultTime = "",
  onChange,
}: {
  name: string;
  /** Earliest selectable day, "YYYY-MM-DD" (usually today in Dubai). */
  min: string;
  step?: number;
  defaultDate?: string;
  defaultTime?: string;
  /** Called with the combined value, or "" while a part is missing. */
  onChange?: (value: string) => void;
}) {
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState(defaultTime);
  const value = date && time ? `${date}T${time}` : "";
  useEffect(() => onChange?.(value), [value, onChange]);
  return (
    <div className="flex flex-wrap items-end gap-2.5">
      <input type="hidden" name={name} value={value} />
      <Popover
        label="Date"
        icon={<CalendarBlankIcon size={16} />}
        value={date ? dateLabel(date) : null}
        placeholder="Choose a day"
      >
        {(close) => (
          <Calendar
            value={date}
            min={min}
            onPick={(d) => {
              setDate(d);
              close();
            }}
          />
        )}
      </Popover>
      <Popover
        label="Time (Dubai)"
        icon={<ClockIcon size={16} />}
        value={time ? timeLabel(time) : null}
        placeholder="Choose a time"
      >
        {(close) => (
          <div className="grid gap-2">
            <TimeWheels value={time || "10:00"} step={step} onChange={setTime} />
            <button
              type="button"
              onClick={() => {
                if (!time) setTime("10:00");
                close();
              }}
              className="h-9 cursor-pointer rounded-[10px] border-0 bg-accent font-sans text-sm font-semibold text-on-accent"
            >
              Done
            </button>
          </div>
        )}
      </Popover>
    </div>
  );
}
