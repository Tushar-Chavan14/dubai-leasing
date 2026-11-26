/**
 * Where the SPA engine may send documents to a model (rule 8, S49 amendment). A KYC or reader call carries passports,
 * licences and deeds, so `OLLAMA_URL` must name a model on this machine or this network: loopback, a private range,
 * or a hostname that can't be public (a single label, `.local`, `.lan`, or the project's `ollama.systemone`). Anything
 * else is refused and the model-backed handlers don't start. Pure: no lookup, so a name that resolves elsewhere is the
 * operator's network to keep honest.
 */
export type OllamaUrlCheck = { ok: true; host: string } | { ok: false; reason: string };

const refuse = (what: string): OllamaUrlCheck => ({
  ok: false,
  reason: `${what}: OLLAMA_URL must be a local or private-network model (localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, fc00::/7, or a single-label, .local, .lan or ollama.systemone host)`,
});

function ipv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n <= 255) ? p : null;
}

function privateV4([a, b]: number[]): boolean {
  return a === 127 || a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
}

/** `new URL` writes an IPv6 host as `[::1]` in compressed form: the first group decides loopback and fc00::/7. */
function privateV6(host: string): boolean {
  const addr = host.slice(1, -1).toLowerCase();
  if (addr === "::1") return true;
  const first = addr.split(":")[0] ?? "";
  if (!/^[0-9a-f]{1,4}$/.test(first)) return false;
  const top = Number.parseInt(first.padStart(4, "0").slice(0, 2), 16);
  return top === 0xfc || top === 0xfd;
}

export function checkOllamaUrl(raw: string): OllamaUrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse("not a URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return refuse("not an http(s) URL");
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return refuse("no host");
  if (host.startsWith("[")) return privateV6(host) ? { ok: true, host } : refuse(`public address ${host}`);
  const v4 = ipv4(host);
  if (v4) return privateV4(v4) ? { ok: true, host } : refuse(`public address ${host}`);
  if (host === "localhost" || !host.includes(".")) return { ok: true, host };
  if (host.endsWith(".local") || host.endsWith(".lan") || host === "ollama.systemone") return { ok: true, host };
  return refuse(`host ${host} isn't local`);
}
