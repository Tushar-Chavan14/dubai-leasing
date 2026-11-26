/** The listing page chat's client side (C26, S61): sending a message and showing the answer. No engine address reaches the browser. */
export interface ChatLine {
  who: "visitor" | "assistant";
  text: string;
  /** Values in an assistant answer that no tool confirmed this turn: shown marked. */
  unverified?: string[];
}

export interface ChatSend {
  text: string;
  consent: boolean;
  session: string;
}

/** The longest message the engine takes. */
export const CHAT_MAX_CHARS = 2000;

/** Cuts `unverified` values out of the reply, in place and every time they appear; the longer value wins an overlap. */
export function segments(text: string, unverified: readonly string[]): { text: string; unverified: boolean }[] {
  const values = [...new Set(unverified)].filter((v) => v && text.includes(v)).sort((a, b) => b.length - a.length);
  if (!values.length) return [{ text, unverified: false }];
  const out: { text: string; unverified: boolean }[] = [];
  let at = 0;
  while (at < text.length) {
    let next = -1;
    let hit = "";
    for (const v of values) {
      const i = text.indexOf(v, at);
      if (i >= 0 && (next < 0 || i < next)) {
        next = i;
        hit = v;
      }
    }
    if (next < 0) break;
    if (next > at) out.push({ text: text.slice(at, next), unverified: false });
    out.push({ text: hit, unverified: true });
    at = next + hit.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), unverified: false });
  return out;
}

/** What the visitor reads when the chat can't answer: plain words, never a status code or an address. */
export function chatError(status: number): string {
  if (status === 429)
    return "You have sent too many messages. Please try again in a while, or contact the agent below.";
  if (status === 404) return "This property is no longer available to chat about.";
  if (status === 503) return "The chat isn't available right now. Please contact the agent below.";
  if (status === 400) return "Please send a shorter message.";
  return "Something went wrong, please try again.";
}

/** Sends one message through this site's own route and returns the line to show. Never throws. */
export async function postChat(ref: string, body: ChatSend, fetchFn: typeof fetch = fetch): Promise<ChatLine> {
  try {
    const res = await fetchFn(`/properties/${encodeURIComponent(ref)}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { who: "assistant", text: chatError(res.status) };
    const r = (await res.json()) as { reply?: string; unverified?: string[] };
    if (typeof r.reply !== "string" || !r.reply) return { who: "assistant", text: chatError(500) };
    return { who: "assistant", text: r.reply, unverified: Array.isArray(r.unverified) ? r.unverified : [] };
  } catch {
    return { who: "assistant", text: chatError(0) };
  }
}
