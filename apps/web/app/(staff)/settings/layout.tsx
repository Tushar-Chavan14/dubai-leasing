import type { ReactNode } from "react";
import { SettingsBar } from "../../../components/settings-bar";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SettingsBar />
      {children}
    </>
  );
}
