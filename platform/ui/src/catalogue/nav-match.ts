export interface NavLink {
  href: string;
  label: string;
  /** "path" (default): current when the path matches and no query link's key is set. "query:<key>": also needs `?<key>`. */
  match?: "path" | `query:${string}`;
}

const pathOf = (href: string) => href.split("?")[0] ?? href;
const queryKey = (l: NavLink) => (l.match?.startsWith("query:") ? l.match.slice("query:".length) : null);

/** Whether a nav link is the current one. Pure, so it is tested without a router. */
export function isCurrent(
  link: NavLink,
  pathname: string,
  params: { has(key: string): boolean },
  links: readonly NavLink[] = [link],
): boolean {
  const path = pathOf(link.href);
  if (pathname !== path && !pathname.startsWith(`${path}/`)) return false;
  const key = queryKey(link);
  if (key) return params.has(key);
  // A plain link yields to its siblings' query keys (Chat vs "Check my application" share a path).
  return !links.some((l) => {
    const k = queryKey(l);
    return k !== null && params.has(k);
  });
}
