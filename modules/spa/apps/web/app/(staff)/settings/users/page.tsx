import { SetPage } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notices, UsersTable } from "../../../../components/settings-pages";
import { engineGet } from "../../../../lib/engine";
import { loadUsers } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { setUserActive, setUserRole } from "./actions";

export const metadata: Metadata = { title: "Users and roles" };

/** Settings → Users and roles (S72): admin only. Roles and access change here; accounts and passwords do not. */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  await requireScreen("settings");
  const data = await loadUsers(engineGet);
  if (!data) notFound();
  const { error, saved } = await searchParams;
  return (
    <SetPage
      title="Users and roles"
      lede="Change what someone can do, or switch their access off. New accounts are made from the command line, not here."
    >
      <Notices error={error} saved={saved} />
      <UsersTable data={data} setRole={setUserRole} setActive={setUserActive} />
    </SetPage>
  );
}
