import { Button } from "@platform/ui/button";
import { Pill } from "@platform/ui/pill";
import { Panel, SaveBar, SET_INPUT, SettingRow } from "@platform/ui/settings";
import type { AlertSettingsView } from "../lib/contracts";

/** Settings → Alerts (S62): hours a gate may wait before its approver is alerted. One entry per gate, one for the generic review. */
export function AlertSettingsForm({
  items,
  canEdit,
  action,
}: {
  items: AlertSettingsView["items"];
  canEdit: boolean;
  action: (f: FormData) => void | Promise<void>;
}) {
  return (
    <form action={action} className="grid gap-4">
      <Panel className="px-4">
        {items.map((i) => (
          <SettingRow
            key={i.key}
            title={i.label}
            sub={i.isDefault ? "Using the standard number of hours." : `Version ${i.version}`}
            htmlFor={`hours_${i.key}`}
          >
            <span className="flex items-center gap-2">
              <input
                id={`hours_${i.key}`}
                name={`hours_${i.key}`}
                type="number"
                min={1}
                max={720}
                defaultValue={i.hours}
                disabled={!canEdit}
                className={`${SET_INPUT} w-24`}
              />
              <span className="text-sm text-muted">hours</span>
              {i.isDefault && <Pill tone="neutral">Standard</Pill>}
            </span>
          </SettingRow>
        ))}
      </Panel>
      {canEdit && (
        <SaveBar note="An alert goes to the approver at this many hours, then to the manager.">
          <Button type="submit" variant="primary" size="sm">
            Save alert settings
          </Button>
        </SaveBar>
      )}
    </form>
  );
}
