import { describe, expect, test } from "bun:test";
import { dockDefault, DOCK_KEY } from "../lib/shell/dock";
import { navItems, screenOf } from "../lib/shell/nav";

const labels = (role: Parameters<typeof navItems>[0], o = { tenancyOps: false, waiting: 0 }) =>
  navItems(role, o).map((i) => i.label);

describe("navItems", () => {
  test("finance has no Units", () => {
    expect(labels("finance")).toEqual(["Home", "Workspace", "Settings"]);
  });
  test("units roles", () => {
    for (const r of ["leasing_officer", "leasing_manager", "admin"] as const)
      expect(labels(r)).toEqual(["Home", "Workspace", "Units", "Settings"]);
  });
  test("maintenance sits before Settings", () => {
    expect(labels("admin", { tenancyOps: true, waiting: 0 })).toEqual([
      "Home",
      "Workspace",
      "Units",
      "Maintenance",
      "Settings",
    ]);
  });
  test("Home count equals waiting, absent at 0", () => {
    expect(navItems("admin", { tenancyOps: false, waiting: 4 })[0]!.count).toBe(4);
    expect("count" in navItems("admin", { tenancyOps: false, waiting: 0 })[0]!).toBe(false);
  });
});

describe("screenOf", () => {
  test("maps paths", () => {
    expect(screenOf("/")).toBe("home");
    expect(screenOf("/units/abc/edit")).toBe("units");
    expect(screenOf("/settings/kyc")).toBe("settings");
    expect(screenOf("/work?kind=lease")).toBe("work");
    expect(screenOf("/metrics")).toBe("home");
    expect(screenOf("/applications/1")).toBe("work");
    expect(screenOf("/leases/1")).toBe("work");
    expect(screenOf("/tasks")).toBe("work");
    expect(screenOf("/conversations/2")).toBe("work");
    expect(screenOf("/maintenance/x")).toBe("maintenance");
    expect(screenOf("/unitsfoo")).toBe("other");
    expect(screenOf("/nope")).toBe("other");
  });
});

describe("dockDefault", () => {
  test("by screen and width", () => {
    expect(dockDefault("units", 1440)).toBe(false);
    expect(dockDefault("work", 1440)).toBe(true);
    expect(dockDefault("work", 1100)).toBe(false);
    expect(DOCK_KEY("work")).toBe("dock:work");
  });
});
