import { IconWarning } from "../../../lib/icons";

/** Shown for an unknown, expired or already-used link. */
export function LinkGone({ message }: { message?: string }) {
  return (
    <section className="panel panel-pad stack">
      <h1 className="portal-title" style={{ fontSize: 22 }}>
        This link can&apos;t be used
      </h1>
      <p className="alert" data-tone="warn" style={{ margin: 0 }}>
        <IconWarning size={15} />{" "}
        {message ??
          "Links in our emails work for a limited time. Open the newest email from us, or reply to it for help."}
      </p>
    </section>
  );
}
