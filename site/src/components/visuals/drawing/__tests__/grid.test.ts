/**
 * The layout engine, on a small picture of its own: a box outside a frame
 * that holds two, a line into the frame across its gutter, and a line
 * between the two inside.
 *
 * It checks what the engine computes rather than any picture's look: a
 * frame's rectangle from the areas it holds, widened by its gutters; a
 * grid's narrowest width from its tracks; the rule that places a frame, in
 * grid lines counted from 1, in each layout; and the stylesheet's own rules.
 */
import { describe, expect, it } from "vitest";
import { expectDrawingStylesheet, expectFrame, expectLine, expectWellFormedMap } from "@/__test-utils__/drawing-checks";
import { corners, drawingCss, frameRect, minWidth, rects, type Connector, type Grid, type Layout } from "../grid";

const RIGHT = { axis: "x", from: "start", to: "end", at: "centre", arrow: true } as const;
const DOWN = { axis: "y", from: "start", to: "end", at: "centre", arrow: true } as const;

/** Wide: the box, a link, then the frame's gutter, its two boxes and its gutter. Compact: the same, down the page. */
const AREAS = {
  wide: {
    columns: ["minmax(40px,80px)", "24px", "16px", "minmax(40px,80px)", "24px", "minmax(40px,80px)", "16px"],
    rows: ["16px", "minmax(40px,auto)", "16px"],
    map: [". . . . . . .", "outer into into first between second .", ". . . . . . ."],
    maxWidth: "none",
    text: [14, 18],
  },
  compact: {
    columns: ["16px", "minmax(0,1fr)", "16px"],
    rows: ["40px", "24px", "16px", "40px", "24px", "40px", "16px"],
    map: [". outer .", ". into .", ". into .", ". first .", ". between .", ". second .", ". . ."],
    maxWidth: "320px",
    text: [14, 18],
  },
} as const satisfies Record<Layout, Grid>;

const CONNECTORS: Record<string, Connector> = {
  into: { part: "into", segments: { wide: [RIGHT], compact: [DOWN] } },
  between: { segments: { wide: [RIGHT], compact: [DOWN] } },
};

const BOXES = ["outer", "first", "second"];
const FRAMES = { system: ["first", "second"] };
const CSS = drawingCss({
  attribute: "fixture",
  areas: AREAS,
  wideFrom: 400,
  frames: FRAMES,
  rules: { compact: ["[data-area=outer]{padding:1px}"], wide: ["[data-area=outer]{padding:2px}"] },
});

describe("a frame", () => {
  it("is the rectangle round the areas it holds, widened by a gutter on each side", () => {
    expect(rects(AREAS.wide).get("first")).toEqual({ x0: 3, x1: 4, y0: 1, y1: 2 });
    expect(frameRect(AREAS.wide, FRAMES.system)).toEqual({ x0: 2, x1: 7, y0: 0, y1: 3 });
    expect(frameRect(AREAS.compact, FRAMES.system)).toEqual({ x0: 0, x1: 3, y0: 2, y1: 7 });
  });

  it("is placed in each layout by grid lines counted from 1", () => {
    const [compact, wide] = CSS.split("@container");
    expect(compact).toContain("[data-fixture] [data-frame=system]{grid-area:3/1/8/4}");
    expect(wide).toContain("[data-fixture] [data-frame=system]{grid-area:1/3/4/8}");
  });

  it("holds exactly its boxes, with only connectors in its gutters", () => {
    for (const layout of ["wide", "compact"] as const) {
      expectWellFormedMap(AREAS[layout], [...BOXES, ...Object.keys(CONNECTORS)]);
      expectFrame(AREAS[layout], FRAMES.system, BOXES, Object.keys(CONNECTORS));
      expectLine(AREAS[layout], layout, CONNECTORS, BOXES, { from: "outer", to: ["first"], through: ["into"], dashed: false });
      expectLine(AREAS[layout], layout, CONNECTORS, BOXES, { from: "first", to: ["second"], through: ["between"], dashed: false });
    }
  });

  it("refuses to hold an area the map does not name", () => {
    expect(() => frameRect(AREAS.wide, ["first", "missing"])).toThrow("missing");
  });
});

describe("a grid's narrowest width", () => {
  it("adds each column's floor: a fixed length, or a minmax's minimum", () => {
    expect(minWidth(AREAS.wide)).toBe(40 + 24 + 16 + 40 + 24 + 40 + 16);
    expect(minWidth(AREAS.compact)).toBe(32);
  });

  it("refuses a track whose floor it cannot read", () => {
    expect(() => minWidth({ ...AREAS.wide, columns: ["auto"] })).toThrow("auto");
  });
});

describe("a corner", () => {
  it("runs on only the ends that meet a perpendicular piece, never an arrow's", () => {
    const across = { axis: "x", from: "start", to: "end", at: "centre" } as const;
    const down = { axis: "y", from: "centre", to: "end", at: "end", arrow: true } as const;
    expect(corners([across, down], across)).toEqual({ from: false, to: true });
    expect(corners([across, down], down)).toEqual({ from: true, to: false });
  });
});

describe("the stylesheet", () => {
  it("goes wide in one query, places every area, and keeps every selector in the figure", () => {
    expectDrawingStylesheet(CSS, "fixture", AREAS, 400);
  });

  it("adds the drawing's own rules to their layout, inside the figure", () => {
    const [compact, wide] = CSS.split("@container");
    expect(compact).toContain("[data-fixture] [data-area=outer]{padding:1px}");
    expect(wide).toContain("[data-fixture] [data-area=outer]{padding:2px}");
  });
});
