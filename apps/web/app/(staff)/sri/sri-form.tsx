"use client";

import { useActionState } from "react";
import { IconCheck, IconWarning } from "../../../lib/icons";
import { type SriState, saveSri } from "./actions";

export function SriForm() {
  const [s, action, pending] = useActionState<SriState, FormData>(saveSri, {});
  return (
    <form action={action} className="stack">
      <label className="field">
        <span className="field-label">Community</span>
        <input name="community" required placeholder="Dubai Marina" />
      </label>
      <label className="field">
        <span className="field-label">Size</span>
        <select name="bedrooms" defaultValue="1">
          <option value="0">Studio</option>
          {[1, 2, 3, 4, 5].map((b) => (
            <option key={b} value={b}>
              {b} bed
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">Average annual rent</span>
        <span className="affix">
          <b>AED</b>
          <input name="avg" inputMode="decimal" required placeholder="100,000" />
        </span>
      </label>
      <div>
        <button type="submit" className="btn primary" disabled={pending}>
          Save
        </button>
      </div>
      {s.ok && (
        <div className="alert" data-tone="good" role="status">
          <IconCheck size={16} />
          {s.ok}
        </div>
      )}
      {s.error && (
        <div className="alert" data-tone="bad" role="alert">
          <IconWarning size={16} />
          {s.error}
        </div>
      )}
    </form>
  );
}
