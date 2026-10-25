/**
 * The picture under "How it fits": its words, its figure, its two maps and
 * the lines between its boxes.
 *
 * The places are named as the docs name them, once each and in the order the
 * picture tells them. The maps are checked as the browser would read them,
 * because a malformed `grid-template-areas` is dropped without an error: each
 * row has a cell per track and each name is one rectangle. The lines are
 * checked from the data with no browser: every segment end is turned into a
 * grid coordinate, and each connector must run from its box's edge to the
 * next box's, joined at every turn, so an edit to a map cannot quietly break
 * a line.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HowItFits } from "@/components/sections/HowItFits";
import { WhereItSits } from "../WhereItSits";
import {
  AREAS,
  CHAT,
  CONNECTORS,
  PLACES,
  WIDE_FROM,
  areaNames,
  fraction,
  whereItSitsCss,
  type Anchor,
  type ConnectorId,
  type Layout,
  type PlaceId,
  type Segment,
} from "../where-it-sits";

afterEach(cleanup);

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../docs");

/** The page that spells each of the picture's words. */
const SPELLED_IN: Record<PlaceId | "chat", string> = {
  users: "getting-started/embed-agent.mdx",
  app: "concepts/what-is-stigmer.mdx",
  backend: "getting-started/embed-agent.mdx",
  stigmer: "concepts/what-is-stigmer.mdx",
  database: "concepts/what-is-stigmer.mdx",
  provider: "concepts/what-is-stigmer.mdx",
  chat: "getting-started/embed-agent.mdx",
};

/** Each line: the box it leaves, the boxes it points at, and its pieces. */
const LINES: { from: PlaceId; to: PlaceId[]; through: ConnectorId[]; dashed: boolean }[] = [
  { from: "users", to: ["app"], through: ["l-users"], dashed: false },
  { from: "app", to: ["backend"], through: ["l-app"], dashed: false },
  {
    from: "backend",
    to: ["stigmer", "database"],
    through: ["fork-stem", "fork-stigmer", "fork-database"],
    dashed: false,
  },
  { from: "stigmer", to: ["provider"], through: ["l-stigmer"], dashed: false },
  { from: "app", to: ["stigmer"], through: ["chat-from", "chat-turn", "chat-run", "chat-into"], dashed: true },
];

const CSS = whereItSitsCss();
const LAYOUTS: Layout[] = ["wide", "compact"];
const NAMES = [...Object.keys(PLACES), ...Object.keys(CONNECTORS), "chat-label"].sort();

/** An area's place in its grid, in grid lines: columns `x0`..`x1`, rows `y0`..`y1`. */
interface Rect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

type Point = readonly [number, number];

function rects(layout: Layout): Map<string, Rect> {
  const found = new Map<string, Rect>();
  AREAS[layout].map.forEach((row, y) =>
    row.split(" ").forEach((name, x) => {
      if (name === ".") return;
      const rect = found.get(name);
      found.set(
        name,
        rect
          ? { x0: Math.min(rect.x0, x), x1: Math.max(rect.x1, x + 1), y0: Math.min(rect.y0, y), y1: Math.max(rect.y1, y + 1) }
          : { x0: x, x1: x + 1, y0: y, y1: y + 1 },
      );
    }),
  );
  return found;
}

/**
 * Where an anchor falls in grid lines. A centre is exact only across one
 * track: across two, it would be a grid line only while the tracks match.
 */
function line(low: number, high: number, anchor: Anchor, where: string): number {
  if (anchor === "centre") expect(high - low, `${where} centres on one track`).toBe(1);
  return low + fraction(anchor) * (high - low);
}

function ends(rect: Rect, segment: Segment, where: string): [Point, Point] {
  const point = (along: Anchor): Point =>
    segment.axis === "x"
      ? [line(rect.x0, rect.x1, along, where), line(rect.y0, rect.y1, segment.at, where)]
      : [line(rect.x0, rect.x1, segment.at, where), line(rect.y0, rect.y1, along, where)];
  return [point(segment.from), point(segment.to)];
}

const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];

/** Whether a point lies on a straight piece, its ends included. */
function lies(point: Point, [a, b]: [Point, Point]): boolean {
  const between = (value: number, p: number, q: number) => Math.min(p, q) <= value && value <= Math.max(p, q);
  return (
    (a[0] === b[0] && point[0] === a[0] && between(point[1], a[1], b[1])) ||
    (a[1] === b[1] && point[1] === a[1] && between(point[0], a[0], b[0]))
  );
}

/** The middle of each side of a box, with the axis a line meeting it runs on. */
function sides(rect: Rect): [Point, "x" | "y"][] {
  const midX = (rect.x0 + rect.x1) / 2;
  const midY = (rect.y0 + rect.y1) / 2;
  return [
    [[rect.x0, midY], "x"],
    [[rect.x1, midY], "x"],
    [[midX, rect.y0], "y"],
    [[midX, rect.y1], "y"],
  ];
}

function figure(): HTMLElement {
  render(<WhereItSits />);
  return screen.getByRole("figure");
}

describe("WhereItSits", () => {
  it("names each place once, in the order the picture tells them", () => {
    const drawing = figure().querySelector<HTMLElement>("[data-where-it-sits-drawing]")!;

    for (const label of [...Object.values(PLACES), CHAT]) {
      expect(drawing.textContent?.split(label).length, label).toBe(2);
    }
    expect([...drawing.querySelectorAll("[data-box]")].map((box) => box.textContent)).toEqual([
      "Your users",
      "Your app",
      "Your backend",
      "Stigmer",
      "Your database",
      "Your model provider",
    ]);
  });

  it("spells each word as the docs do", () => {
    const words: [keyof typeof SPELLED_IN, string][] = [
      ...(Object.entries(PLACES) as [PlaceId, string][]),
      ["chat", CHAT],
    ];
    for (const [key, word] of words) {
      const page = readFileSync(resolve(DOCS, SPELLED_IN[key]), "utf8").toLowerCase();
      expect(page.includes(word.toLowerCase()), `docs/${SPELLED_IN[key]} spells ${word}`).toBe(true);
    }
  });

  it("is one figure with a caption, no heading and nothing to focus", () => {
    const picture = figure();

    expect(picture.querySelector("[data-where-it-sits-drawing]")?.getAttribute("aria-hidden")).toBe("true");
    expect(picture.querySelector("figcaption")?.textContent).toMatch(
      /your backend.*your database.*your model provider.*chat/i,
    );
    expect(picture.querySelectorAll("h1, h2, h3, h4, h5, h6")).toHaveLength(0);
    expect(picture.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
  });

  it("draws every area the maps name, and each layout's segments", () => {
    const picture = figure();

    const drawn = [...picture.querySelectorAll("[data-area]")].map((area) => area.getAttribute("data-area"));
    expect(drawn.sort()).toEqual(NAMES);
    for (const layout of LAYOUTS) {
      const segments = Object.values(CONNECTORS).flatMap((connector) => connector.segments[layout]);
      expect(picture.querySelectorAll(`[data-layout=${layout}]`), layout).toHaveLength(segments.length);
    }
  });

  it("sits between the heading and the steps under How it fits", () => {
    render(<HowItFits />);

    const heading = screen.getByRole("heading", { level: 2 });
    const picture = screen.getByRole("figure");
    const firstStep = screen.getAllByRole("heading", { level: 3 })[0];
    expect(heading.compareDocumentPosition(picture) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(picture.compareDocumentPosition(firstStep) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe.each(LAYOUTS)("the %s map", (layout) => {
  const grid = AREAS[layout];
  const placed = rects(layout);

  it("has a cell per track in every row and makes each name one rectangle", () => {
    expect(grid.map).toHaveLength(grid.rows.length);
    for (const row of grid.map) expect(row.split(" "), row).toHaveLength(grid.columns.length);
    for (const [name, rect] of placed) {
      const cells = grid.map.flatMap((row) => row.split(" ")).filter((cell) => cell === name).length;
      expect(cells, name).toBe((rect.x1 - rect.x0) * (rect.y1 - rect.y0));
    }
  });

  it("names every area the picture draws, and a rule places each", () => {
    expect([...areaNames(grid)].sort()).toEqual(NAMES);
    for (const name of NAMES) expect(CSS, name).toContain(`[data-area=${name}]{grid-area:${name}}`);
  });

  it.each(LINES)("runs a line from $from to $to, joined at every turn", ({ from, to, through, dashed }) => {
    const pieces = through.flatMap((id) => {
      const connector = CONNECTORS[id];
      expect("dashed" in connector, `${id} dashed`).toBe(dashed);
      const segments: readonly Segment[] = connector.segments[layout];
      return segments.map((segment, index) => ({
        segment,
        ends: ends(placed.get(id)!, segment, `${layout} ${id}`),
        name: `${layout} ${id} #${index}`,
      }));
    });

    /** The box a point meets head-on, if any. */
    const meets = ([point, segment]: [Point, Segment]) =>
      (Object.keys(PLACES) as PlaceId[]).find((place) =>
        sides(placed.get(place)!).some(([side, axis]) => same(side, point) && axis === segment.axis),
      );

    const left: PlaceId[] = [];
    const reached: PlaceId[] = [];
    const joined = new Map(pieces.map((piece) => [piece, new Set([piece])]));
    for (const piece of pieces) {
      piece.ends.forEach((point, end) => {
        const box = meets([point, piece.segment]);
        const arrow = end === 1 && piece.segment.arrow === true;
        if (box) {
          (arrow ? reached : left).push(box);
          return;
        }
        expect(arrow, `${piece.name} points at a box`).toBe(false);
        const others = pieces.filter((other) => other !== piece && lies(point, other.ends));
        expect(others.length, `${piece.name} joins another piece`).toBeGreaterThan(0);
        for (const other of others) {
          const group = new Set([...joined.get(piece)!, ...joined.get(other)!]);
          for (const member of group) joined.set(member, group);
        }
      });
    }

    expect(left).toEqual([from]);
    expect(reached.sort()).toEqual([...to].sort());
    expect(joined.get(pieces[0])!.size, "one unbroken line").toBe(pieces.length);
  });
});

describe("the stylesheet", () => {
  it("goes wide in one container query, at the one width", () => {
    const [compact, wide, ...rest] = CSS.split("@container");

    expect(rest).toHaveLength(0);
    expect(CSS.split(String(WIDE_FROM))).toHaveLength(2);
    expect(wide.startsWith(` (min-width:${WIDE_FROM}px){`)).toBe(true);
    expect(compact).toContain("[data-layout=wide]{display:none}");
    expect(compact).toContain(`grid-template-areas:${AREAS.compact.map.map((row) => `"${row}"`).join(" ")}`);
    expect(wide).toContain("[data-layout=compact]{display:none}");
    expect(wide).toContain("[data-layout=wide]{display:block}");
    expect(wide).toContain(`grid-template-areas:${AREAS.wide.map.map((row) => `"${row}"`).join(" ")}`);
  });

  it("keeps every selector inside the figure and holds no <", () => {
    expect(CSS).not.toContain("<");
    const selectors = CSS.replace(/@container[^{]*\{/, "")
      .split("}")
      .map((rule) => rule.split("{")[0].trim())
      .filter(Boolean);
    for (const selector of selectors) expect(selector, selector).toMatch(/^\[data-where-it-sits\] /);
  });
});
