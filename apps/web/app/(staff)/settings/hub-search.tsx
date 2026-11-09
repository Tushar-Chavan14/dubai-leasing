"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { AskAiMenu } from "../../../components/ask-ai";
import { EmptyState } from "../../../components/ui/empty-state";
import { askPrompts } from "../../../lib/ask-ai/prompts";
import { filterHub } from "../../../lib/settings/hub";
import { SETTINGS_ICONS } from "./settings-icons";

/** Search box and grouped setting cards. `lastChanged` maps an href to a ready-to-show date, where the data has one. */
export function HubSearch({ demo, lastChanged }: { demo: boolean; lastChanged: Record<string, string> }) {
  const [q, setQ] = useState("");
  const groups = filterHub(q, { demo });
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-64 flex-1">
          <span className="sr-only">Search settings</span>
          <MagnifyingGlassIcon
            size={16}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search settings, for example deposit or notice period"
            className="h-11 w-full rounded-[14px] border border-line bg-page pr-4 pl-10 font-sans text-[15px] text-ink placeholder:text-muted hover:border-ink focus:border-ink"
          />
        </label>
        <AskAiMenu label="Ask AI" prompts={askPrompts.settingsHub()} />
      </div>
      <div aria-live="polite" className="grid gap-7">
        {groups.length === 0 ? (
          <EmptyState
            title="No setting matches"
            body="Try a different word, or ask the agent which setting changes what you want."
            action={<AskAiMenu label="Ask AI" prompts={askPrompts.settingsHub()} />}
          />
        ) : (
          groups.map((g, gi) => (
            <section key={g.group} aria-labelledby={`hub-${g.group}`} className="grid gap-3">
              <h2 id={`hub-${g.group}`} className="m-0 font-sans text-[13px] font-semibold text-muted">
                {g.group}
              </h2>
              <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 @2xl:grid-cols-2">
                {g.items.map((i, ii) => {
                  const Icon = SETTINGS_ICONS[i.href];
                  return (
                    <li key={i.href} className="m-0 p-0">
                      <Link
                        href={i.href}
                        className="flex h-full items-start gap-3.5 rounded-card border border-line bg-page p-4 text-ink! no-underline transition-colors duration-150 ease-out hover:border-ink motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                      >
                        <span
                          aria-hidden
                          className={`grid size-9 flex-none place-items-center rounded-[10px] ${gi === 0 && ii === 0 ? "bg-accent text-on-accent" : "bg-raised text-ink"}`}
                        >
                          {Icon && <Icon size={18} aria-hidden />}
                        </span>
                        <span className="grid min-w-0 gap-1">
                          <span className="font-sans text-[15px] font-semibold tracking-tight">{i.title}</span>
                          <span className="text-[13px] leading-snug text-muted">{i.blurb}</span>
                          <span className="pt-0.5 text-xs text-muted">Who can change it: {i.who}</span>
                          {lastChanged[i.href] && (
                            <span className="text-xs text-muted">Last changed: {lastChanged[i.href]}</span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
