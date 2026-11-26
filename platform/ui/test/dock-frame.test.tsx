import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { ComposerCard, CHIP } from "../src/shell/composer";
import { DockFrame, type DockState, initialOpen } from "../src/shell/dock-frame";

const noop = () => {};
const state = (o: Partial<DockState>): DockState => ({
  ready: true,
  overlay: false,
  open: true,
  show: noop,
  focusComposer: noop,
  ...o,
});
const frame = (s: DockState) =>
  render(
    <DockFrame state={s} title="Agent" contextLabel="Anything">
      body
    </DockFrame>,
  );

describe("DockFrame", () => {
  test("closed docked: the Open tab and an inert aside", () => {
    const html = frame(state({ open: false }));
    expect(html).toContain('aria-label="Open the agent"');
    expect(html).toContain("inert");
    expect(html).toContain("hidden");
  });
  test("open docked: 380px aside titled Agent, no scrim", () => {
    const html = frame(state({}));
    expect(html).toContain("w-[380px]");
    expect(html).toContain('aria-label="Agent"');
    expect(html).toContain(">Anything<");
    expect(html).not.toContain("cp-fade");
  });
  test("dock frame starts closed in overlay mode, open overlay renders the scrim", () => {
    expect(frame(state({ overlay: true, open: false }))).toContain("translate-x-full");
    expect(frame(state({ overlay: true, open: true }))).toContain("cp-fade");
  });
  test("not ready renders nothing", () => {
    expect(frame(state({ ready: false }))).toBe("");
  });
});

describe("initialOpen", () => {
  const base = { screen: "work", width: 1400, defaultOpen: (s: string) => s !== "inventory" };
  test("overlay is always closed", () => {
    expect(initialOpen({ ...base, stored: "1", overlay: true })).toBe(false);
  });
  test("a stored 0 stays closed, a stored 1 open", () => {
    expect(initialOpen({ ...base, stored: "0", overlay: false })).toBe(false);
    expect(initialOpen({ ...base, stored: "1", overlay: false, screen: "inventory" })).toBe(true);
  });
  test("no stored choice uses the default", () => {
    expect(initialOpen({ ...base, stored: null, overlay: false })).toBe(true);
    expect(initialOpen({ ...base, stored: null, overlay: false, screen: "inventory" })).toBe(false);
  });
});

describe("ComposerCard", () => {
  test("field and tools in a rounded card, below under it", () => {
    const html = render(
      <ComposerCard onSubmit={noop} field={<textarea />} tools={<b>t</b>} send={<button>s</button>} below={<u>x</u>} />,
    );
    expect(html).toContain("rounded-[18px]");
    expect(html.indexOf("<textarea")).toBeLessThan(html.indexOf("<u>"));
    expect(CHIP).toContain("rounded-full");
  });
});
