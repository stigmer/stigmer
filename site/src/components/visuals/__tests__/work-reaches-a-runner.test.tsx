/**
 * The picture on the docs' Runners page, how work reaches a runner: its
 * words, its figure, its maps, lines and frame, and its stillness.
 *
 * Each word the picture uses is held to the docs page that spells it, so the
 * docs never draw something they do not say. The maps, lines and frame are
 * held to the rules every drawn picture keeps
 * (`@/__test-utils__/drawing-checks`). The picture is still: it has no loop
 * stylesheet, so its lit path is its connectors given a part, and nothing
 * in it animates.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  expectDrawingStylesheet,
  expectFrame,
  expectLine,
  expectWellFormedMap,
  expectWideFits,
  type LineSpec,
} from "@/__test-utils__/drawing-checks";
import { LAYOUTS, type Layout } from "../drawing/grid";
import { WorkReachesARunner } from "../WorkReachesARunner";
import {
  AREAS,
  AREA_NAMES,
  ATTRIBUTE,
  BOXES,
  CAPTION,
  CARRIES,
  CONNECTORS,
  DRAWING_CSS,
  FRAME,
  LABELS,
  PATH,
  PLACES,
  WIDE_FROM,
} from "../work-reaches-a-runner";

afterEach(cleanup);

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../docs");

/** Each word the picture draws, and the docs page that spells it. */
const SPELLED_IN: [string, string][] = [
  ["your app", "concepts/what-is-stigmer.mdx"],
  ["your model provider", "concepts/what-is-stigmer.mdx"],
  ["Session", "concepts/sessions.mdx"],
  ["server", "concepts/runners.mdx"],
  ["Temporal", "concepts/runners.mdx"],
  ["task queue", "concepts/runners.mdx"],
  ["stigmer_runner", "concepts/runners.mdx"],
  ["polls", "concepts/runners.mdx"],
  ["Harness", "concepts/runners.mdx"],
  ["credential", "concepts/runners.mdx"],
  ["runner", "concepts/runners.mdx"],
  ["agent", "vocabulary.md"],
];

/** Each line: the box it leaves, the boxes it points at, and its pieces, in each layout. */
const SHARED_LINES: LineSpec[] = [
  { from: "app", to: ["server"], through: ["l-app"], dashed: false },
  { from: "server", to: ["temporal"], through: ["l-queue"], dashed: false },
  { from: "runner", to: ["temporal"], through: ["l-poll"], dashed: false },
  { from: "runner", to: ["provider"], through: ["l-provider"], dashed: false },
  { from: "runner", to: ["server"], through: ["write-back", "write-run", "write-in"], dashed: true },
];
const LINES: Record<Layout, LineSpec[]> = { wide: SHARED_LINES, compact: SHARED_LINES };

function figure(): HTMLElement {
  render(<WorkReachesARunner />);
  return screen.getByRole("figure");
}

function drawing(): HTMLElement {
  return figure().querySelector<HTMLElement>(`[data-${ATTRIBUTE}-drawing]`)!;
}

describe("WorkReachesARunner", () => {
  it("names each place once, in the order a run passes them, the runner holding what the run carries", () => {
    const picture = drawing();

    for (const { name } of Object.values(PLACES)) expect(picture.textContent?.split(name).length, name).toBe(2);
    expect([...picture.querySelectorAll("[data-box]")].map((box) => box.getAttribute("data-area"))).toEqual(BOXES);
    const runner = picture.querySelector("[data-area=runner]")!;
    for (const carried of CARRIES) expect(runner.textContent, carried).toContain(carried);
    for (const label of Object.values(LABELS)) expect(picture.textContent, label).toContain(label);
  });

  it("spells each word as the docs do", () => {
    const drawn = `${drawing().textContent} ${CAPTION}`.toLowerCase();
    for (const [word, file] of SPELLED_IN) {
      expect(drawn, `the picture says ${word}`).toContain(word.toLowerCase());
      expect(readFileSync(resolve(DOCS, file), "utf8").toLowerCase(), `docs/${file} spells ${word}`).toContain(word.toLowerCase());
    }
  });

  it("is one figure with a caption telling the run's way in order, its drawing hidden, nothing to focus", () => {
    const picture = figure();

    expect(picture.querySelector(`[data-${ATTRIBUTE}-drawing]`)?.getAttribute("aria-hidden")).toBe("true");
    expect(picture.querySelector("figcaption")?.textContent).toBe(CAPTION);
    expect(CAPTION).toMatch(
      /Your app sends a message to a Session\..*server puts the run on a Temporal task queue, stigmer_runner.*never picks a runner\..*runner polls the queue.*Harness.*credential.*calls your model provider.*writes what the Agent did back to the server\./,
    );
    expect(picture.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0);
    expect(picture.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
  });

  it("draws every area the maps name, each layout's segments, and the frame round Stigmer", () => {
    const picture = drawing();

    const drawn = [...picture.querySelectorAll("[data-area]")].map((area) => area.getAttribute("data-area"));
    expect(drawn.sort()).toEqual([...AREA_NAMES].sort());
    for (const layout of LAYOUTS) {
      const segments = Object.values(CONNECTORS).flatMap((connector) => connector.segments[layout]);
      expect(picture.querySelectorAll(`[data-layout=${layout}]`), layout).toHaveLength(segments.length);
    }
    expect(picture.querySelector(`[data-frame=${FRAME.id}]`)?.textContent).toBe(FRAME.label);
  });

  it("is still: the run's path lit in the foreground, the write-back quiet, no ring and no loop", () => {
    const picture = drawing();

    const lit = [...picture.querySelectorAll(`[data-stroke=${PATH}]`)].map((stroke) => stroke.parentElement!.getAttribute("data-area"));
    expect(lit.sort()).toEqual(["l-app", "l-poll", "l-provider", "l-queue"]);
    for (const id of ["write-back", "write-run", "write-in"]) {
      const quiet = picture.querySelector(`[data-area=${id}]`)!;
      expect(quiet.querySelector("[data-stroke]"), id).toBeNull();
      expect(quiet.className, id).toContain("text-muted-foreground");
    }
    expect(picture.querySelectorAll("[data-ring], [data-ink], [data-part]")).toHaveLength(0);
    expect(DRAWING_CSS).not.toMatch(/@keyframes|animation/);
  });
});

describe.each(LAYOUTS)("the %s map", (layout) => {
  const grid = AREAS[layout];
  const connectorIds = Object.keys(CONNECTORS);

  it("has a cell per track in every row, makes each name one rectangle, and names every area drawn", () => {
    expectWellFormedMap(grid, AREA_NAMES);
  });

  it("holds the server, Temporal and the runner in Stigmer's frame, and nothing but crossing lines in its gutters", () => {
    expectFrame(grid, FRAME.holds, BOXES, connectorIds);
  });

  it.each(LINES[layout])("runs a line from $from to $to, joined at every turn", (spec) => {
    expectLine(grid, layout, CONNECTORS, BOXES, spec);
  });
});

describe("the stylesheet", () => {
  it("goes wide in one container query, at a width the wide map fits in", () => {
    expectWideFits(AREAS.wide, WIDE_FROM);
    expectDrawingStylesheet(DRAWING_CSS, ATTRIBUTE, AREAS, WIDE_FROM);
  });
});
