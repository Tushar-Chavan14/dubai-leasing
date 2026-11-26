import { PublicNav } from "@platform/ui/catalogue/public-nav";

const LINKS = [
  { href: "/customer/properties", label: "Rent" },
  { href: "/customer/chat", label: "Chat" },
  { href: "/customer/chat?check=1", label: "Check my application", match: "query:check" as const },
];

/** The customer section's nav. The current section is marked with `aria-current="page"`. */
export function CustomerNav() {
  return <PublicNav links={LINKS} />;
}
