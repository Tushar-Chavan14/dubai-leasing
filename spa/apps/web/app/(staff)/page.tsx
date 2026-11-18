import { EmptyState } from "@platform/ui/empty-state";
import { PageTitle } from "@platform/ui/page";
import { engine, read } from "../../lib/engine";
import { weekdayDate } from "../../lib/format";
import { requireScreen } from "../../lib/session";

export default async function Home() {
  const { user } = await requireScreen("home");
  const clock = await read(await (await engine()).api.demo.clock.$get());
  const first = user.name.split(/\s+/)[0] ?? user.name;
  return (
    <div className="grid gap-6">
      <PageTitle
        title={`Good morning, ${first}`}
        lede={clock ? `${weekdayDate(clock.today)} · ${user.roleLabel}` : user.roleLabel}
      />
      <EmptyState
        title="Nothing is waiting for you."
        body="Approvals and tasks for your role will appear here, oldest first."
      />
    </div>
  );
}
