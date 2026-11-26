import { expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { PortalLink } from "../components/portal-link";

test("the SPA header still links back to the portal through SPA_PORTAL_URL (S69)", async () => {
  const html = render(<PortalLink href="http://portal.test:3100" className="menu" />);
  expect(html).toContain('href="http://portal.test:3100"');
  expect(html).toContain('class="menu"');
  expect(html).toMatch(/>Portal<\/a>/);
  const shell = await Bun.file(`${import.meta.dir}/../components/shell.tsx`).text();
  expect(shell).toContain("<PortalLink href={portalUrl}");
  expect(shell).toContain("<form action={signOut}>");
  const layout = await Bun.file(`${import.meta.dir}/../app/(staff)/layout.tsx`).text();
  expect(layout).toContain("portalUrl={webEnv().SPA_PORTAL_URL}");
});
