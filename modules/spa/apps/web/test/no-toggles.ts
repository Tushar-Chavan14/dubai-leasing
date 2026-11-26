/** Drops the section collapse toggles (AGENTS.md UI rule) so "no control on a read-only page" checks see only real controls. */
export const noToggles = (html: string): string =>
  html.replace(/<button\b[^>]*\bclass="section-toggle[^"]*"[^>]*>[\s\S]*?<\/button>/g, "");
