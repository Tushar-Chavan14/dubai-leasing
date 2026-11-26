import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Cover } from "../src/media/cover";
import { Gallery } from "../src/media/gallery";
import { hueOf, placeholderStyle } from "../src/media/hue";
import { checkPhotoFile } from "../src/media/photo-check";
import { moveItem } from "../src/media/photo-picker";

describe("hueOf", () => {
  test("gives the numbers leasing's placeholders always had", () => {
    expect(hueOf("Marina Heights")).toBe(168);
    expect(hueOf("")).toBe(140);
    expect(hueOf("Demo Salamah Residence")).toBe(162);
  });
  test("placeholderStyle is stable for a seed", () => {
    expect(placeholderStyle("a")).toEqual(placeholderStyle("a"));
    expect(placeholderStyle("a").background).toContain("hsl(");
  });
});

describe("Cover", () => {
  test("renders an img when it has a src", () => {
    const html = renderToStaticMarkup(<Cover name="Marina Heights" src="/api/x.jpg" />);
    expect(html).toContain('<img src="/api/x.jpg"');
    expect(html).toContain('alt="Marina Heights"');
  });
  test("renders a labelled placeholder without a src", () => {
    const html = renderToStaticMarkup(<Cover name="Marina Heights" src={undefined} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Marina Heights"');
    expect(html).toContain("No photo yet");
  });
  test("label={false} hides the caption and emptyLabel overrides it", () => {
    expect(renderToStaticMarkup(<Cover name="X" src={undefined} label={false} />)).not.toContain("No photo yet");
    expect(renderToStaticMarkup(<Cover name="X" src={undefined} emptyLabel="Soon" />)).toContain("Soon");
  });
});

describe("Gallery", () => {
  test("shows the placeholder or the empty label without photos", () => {
    expect(renderToStaticMarkup(<Gallery title="Unit 1" photos={[]} placeholder={<i>plan</i>} />)).toContain(
      "<i>plan</i>",
    );
    expect(renderToStaticMarkup(<Gallery title="Unit 1" photos={[]} />)).toContain("No photos yet.");
  });
  test("renders the first photo with the title in its alt and thumbs for several", () => {
    const html = renderToStaticMarkup(
      <Gallery
        title="Unit 1"
        photos={[
          { id: "a", src: "/p/a", caption: null },
          { id: "b", src: "/p/b", caption: "Living room" },
        ]}
      />,
    );
    expect(html).toContain('src="/p/a"');
    expect(html).toContain('alt="Unit 1, photo 1"');
    expect(html).toContain("1 / 2");
    expect(html).toContain("Show Living room");
  });
});

describe("checkPhotoFile", () => {
  test("rejects too large and wrong type, accepts a small jpeg", () => {
    const big = new File([new Uint8Array(26 * 1024 * 1024)], "big.jpg", { type: "image/jpeg" });
    expect(checkPhotoFile(big)).toContain("larger than 25 MB");
    expect(checkPhotoFile(new File(["x"], "a.txt", { type: "text/plain" }))).toContain("use JPEG, PNG or WebP");
    expect(checkPhotoFile(new File(["x"], "a.jpg", { type: "image/jpeg" }))).toBeNull();
  });
});

describe("moveItem", () => {
  test("moves an item and clamps the target", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a", "b"], 0, 9)).toEqual(["b", "a"]);
    expect(moveItem(["a"], 5, 0)).toEqual(["a"]);
  });
});
