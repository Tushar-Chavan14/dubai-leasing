import { PublicNav } from "@platform/ui/catalogue/public-nav";

const LINKS = [{ href: "/properties", label: "Properties" }];

/** The public site's nav. A chat link joins it when the site has its own chat page (F4); until then chat lives on each property page. */
export function SiteNav() {
  return <PublicNav links={LINKS} />;
}
