import { describe, expect, test } from "bun:test";
import { stagesForStaffStage } from "../components/chat-ui/stages.ts";

const states = (stage: string) => stagesForStaffStage(stage).map((s) => s.state);

describe("record card stage stepper", () => {
  test("current stage highlighted, past done, future to do", () => {
    expect(states("Documents")).toEqual(["done", "current", "todo", "todo", "todo"]);
    expect(states("Contract")).toEqual(["done", "done", "done", "current", "todo"]);
    expect(states("Reserved")).toEqual(states("Contract"));
  });
  test("enquiry has not started, registered is finished", () => {
    expect(states("Enquiry")).toEqual(["todo", "todo", "todo", "todo", "todo"]);
    expect(states("Registered").every((s) => s === "done")).toBe(true);
  });
});
