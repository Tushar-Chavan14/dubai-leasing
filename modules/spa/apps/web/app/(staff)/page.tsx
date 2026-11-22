import { EmptyState } from "@platform/ui/empty-state";
import { PageTitle } from "@platform/ui/page";
import { railItems } from "@spa/core/roles";
import { HomeView } from "../../components/home-view";
import { engine, engineGet, read } from "../../lib/engine";
import { weekdayDate } from "../../lib/format";
import { loadHome } from "../../lib/loaders";
import { requireScreen } from "../../lib/session";

/** Home (design §4.1): what waits for the role, oldest first, and its open deals by stage. */
export default async function Home() {
  const { user } = await requireScreen("home");
  const clock = await read(await (await engine()).api.demo.clock.$get());
  const home = await loadHome(engineGet);
  const first = user.name.split(/\s+/)[0] ?? user.name;
  const rail = railItems(user.role, user.companyKind);
  const canWork = rail.some((i) => i.screen === "work");
  const catalogue = {
    listings: rail.some((i) => i.screen === "listings"),
    inventory: rail.some((i) => i.screen === "inventory"),
  };
  return (
    <div className="grid gap-6">
      <PageTitle
        title={`Good morning, ${first}`}
        lede={clock ? `${weekdayDate(clock.today)} · ${user.roleLabel}` : user.roleLabel}
      />
      {home ? (
        <HomeView
          summary={home.summary}
          tasks={home.tasks}
          gates={home.gates}
          canWork={canWork}
          catalogue={catalogue}
          inboxHref={
            !canWork && (user.role === "compliance_officer" || user.role === "mlro") ? "/compliance#inbox" : undefined
          }
        />
      ) : (
        <EmptyState
          title="Home couldn't be loaded."
          body="The sales engine didn't answer. Reload the page in a moment."
        />
      )}
    </div>
  );
}
