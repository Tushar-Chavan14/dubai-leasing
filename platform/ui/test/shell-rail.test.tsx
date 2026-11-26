import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Rail } from "../src/shell/rail";

const Icon = () => <svg />;
const icons = { a: Icon, b: Icon };
const brand = { mark: "S", label: "Sales, home", title: "Sales" };

describe("shared Rail", () => {
  const html = renderToStaticMarkup(
    <Rail
      items={[
        { href: "/", label: "One", key: "a" },
        { href: "/b", label: "Two", key: "b", count: 3, title: "Two (view only)" },
      ]}
      current="b"
      icons={icons}
      brand={brand}
      extra={<span id="extra-node">bell</span>}
      footer={<i>f</i>}
    />,
  );
  test("marks the current item", () => {
    expect(html.match(/aria-current="page"/g)?.length).toBe(1);
    expect(html).toContain("bg-rail-active");
  });
  test("count, title override and brand", () => {
    expect(html).toContain('aria-label="3 waiting for you"');
    expect(html).toContain('title="Two (view only)"');
    expect(html).toContain('title="One"');
    expect(html).toContain('aria-label="Sales, home"');
  });
  test("extra renders before the command button", () => {
    expect(html.indexOf("extra-node")).toBeGreaterThan(0);
    expect(html.indexOf("extra-node")).toBeLessThan(html.indexOf("⌘K"));
  });
});
