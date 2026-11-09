import { WarningIcon as IconWarning } from "@phosphor-icons/react/dist/ssr";
import { Banner } from "../../../components/ui/form";
import { PAGE, PortalTitle } from "../../../components/ui/portal";

/** Shown for an unknown, expired or already-used link. */
export function LinkGone({ message }: { message?: string }) {
  return (
    <div className={PAGE}>
      <PortalTitle title="This link can't be used" />
      <Banner tone="warn">
        <IconWarning size={16} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          {message ??
            "Links in our emails work for a limited time. Open the newest email from us, or reply to it for help."}
        </span>
      </Banner>
    </div>
  );
}
