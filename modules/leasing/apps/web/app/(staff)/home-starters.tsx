"use client";

import { useEffect } from "react";
import { setHomeStarters } from "../../lib/copilot/home-starters";

/** Gives the dock Home's suggestions while Home is on screen. Renders nothing. */
export function HomeStarters({ suggestions }: { suggestions: string[] }) {
  const key = suggestions.join("\n");
  useEffect(() => {
    setHomeStarters(key.split("\n"));
    return () => setHomeStarters(null);
  }, [key]);
  return null;
}
