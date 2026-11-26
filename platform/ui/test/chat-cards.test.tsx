import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CardNote, CardShell, Facts } from "../src/chat/card-shell";
import { RecordCard } from "../src/chat/record-card";
import { StageStepper } from "../src/chat/stage-stepper";
import { UnitCard } from "../src/chat/unit-card";

const base = {
  ref: "A-1",
  name: "Sara Khan",
  unit: "Marina 101",
  stageLabel: "Offer",
  stages: [
    { name: "Viewing", state: "done" as const },
    { name: "Offer", state: "current" as const },
    { name: "Contract", state: "todo" as const },
  ],
  nextStep: "Send the offer",
  href: "/work?id=1",
};

describe("RecordCard", () => {
  test("shows the next step and a link fallback when there are no actions", () => {
    const html = renderToStaticMarkup(<RecordCard card={base} />);
    expect(html).toContain("Send the offer");
    expect(html).toContain('href="/work?id=1"');
    expect(html).toContain("Open in the Workspace");
    expect(html).toContain('aria-current="step"');
  });
  test("renders one button per prompt action, enabled with onSend", () => {
    const html = renderToStaticMarkup(
      <RecordCard
        card={{
          ...base,
          actions: [
            { type: "prompt", key: "a", label: "Draft offer", prompt: "draft" },
            { type: "prompt", key: "b", label: "Chase", prompt: "chase" },
          ],
        }}
        onSend={() => {}}
      />,
    );
    expect(html.match(/<button/g)).toHaveLength(2);
    expect(html).toContain("Draft offer");
    expect(html).not.toContain("disabled=");
  });
  test("relabels a stage and shows extra", () => {
    const html = renderToStaticMarkup(
      <RecordCard card={{ ...base, stageLabels: { Offer: "Tawtheeq" }, extra: <i>more</i> }} />,
    );
    expect(html).toContain("Tawtheeq");
    expect(html).toContain("<i>more</i>");
  });
});

describe("StageStepper", () => {
  test("marks done, current and to do for screen readers", () => {
    const html = renderToStaticMarkup(<StageStepper stages={base.stages} />);
    expect(html).toContain("(done)");
    expect(html).toContain("(current)");
    expect(html).toContain("(to do)");
  });
});

describe("UnitCard", () => {
  const props = {
    name: "M",
    title: "Marina",
    price: "AED 1",
    facts: ["2 bed"],
    bookLabel: "Book",
    applyLabel: "Apply",
    disabled: false,
  };
  test("hides Book and Apply when no handler is given", () => {
    const html = renderToStaticMarkup(<UnitCard {...props} detailsHref="/u/1" />);
    expect(html).not.toContain("Book");
    expect(html).not.toContain("Apply");
    expect(html).toContain('href="/u/1"');
    expect(html).toContain("2 bed");
  });
  test("shows them when handlers are given", () => {
    const html = renderToStaticMarkup(<UnitCard {...props} onBook={() => {}} onApply={() => {}} />);
    expect(html).toContain("Book");
    expect(html).toContain("Apply");
  });
});

describe("CardShell", () => {
  test("renders title, status and children", () => {
    const html = renderToStaticMarkup(
      <CardShell title="T" status="Waiting" tone="waiting">
        <Facts>
          <dt>k</dt>
          <dd>v</dd>
        </Facts>
        <CardNote>note</CardNote>
      </CardShell>,
    );
    expect(html).toContain("Waiting");
    expect(html).toContain("note");
  });
});
