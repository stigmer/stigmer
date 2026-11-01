/**
 * The rules every drawn picture's maps, lines, frames and stylesheet keep,
 * as assertions a picture's test calls inside its own cases.
 *
 * The maps are checked as the browser would read them, because a malformed
 * `grid-template-areas` is dropped without an error: each row has a cell per
 * track and each name is one rectangle. The lines are checked from the data
 * with no browser: every segment end is turned into a grid coordinate, and
 * each line must run from its box's edge to the next box's, joined at every
 * turn, so an edit to a map cannot quietly break a line. A frame must hold
 * exactly the boxes it names, with nothing but connectors in its gutters.
 * The stylesheet goes wide in one container query, at a width the wide map
 * fits in, with every selector inside the figure.
 */
import { expect } from "vitest";
import {
  areaNames,
  fraction,
  frameRect,
  minWidth,
  rects,
  type Anchor,
  type Connector,
  type Grid,
  type Layout,
  type Rect,
  type Segment,
} from "@/components/visuals/drawing/grid";

type Point = readonly [number, number];

/** One line of a picture: the box it leaves, the boxes it points at, the connectors it runs through. */
export interface LineSpec {
  from: string;
  to: readonly string[];
  through: readonly string[];
  dashed: boolean;
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

/** Each row has a cell per track, each name is one rectangle, and the map names exactly the areas the picture draws. */
export function expectWellFormedMap(grid: Grid, names: readonly string[]): void {
  expect(grid.map).toHaveLength(grid.rows.length);
  for (const row of grid.map) expect(row.split(" "), row).toHaveLength(grid.columns.length);
  for (const [name, rect] of rects(grid)) {
    const cells = grid.map.flatMap((row) => row.split(" ")).filter((cell) => cell === name).length;
    expect(cells, name).toBe((rect.x1 - rect.x0) * (rect.y1 - rect.y0));
  }
  expect([...areaNames(grid)].sort()).toEqual([...names].sort());
}

/** A line runs from its box's side to each box it points at, in one unbroken piece, joined at every turn. */
export function expectLine(
  grid: Grid,
  layout: Layout,
  connectors: Readonly<Record<string, Connector>>,
  boxes: readonly string[],
  { from, to, through, dashed }: LineSpec,
): void {
  const placed = rects(grid);
  const pieces = through.flatMap((id) => {
    const connector = connectors[id];
    expect(connector?.dashed === true, `${id} dashed`).toBe(dashed);
    return connector.segments[layout].map((segment, index) => ({
      segment,
      ends: ends(placed.get(id)!, segment, `${layout} ${id}`),
      name: `${layout} ${id} #${index}`,
    }));
  });

  /** The box a point meets head-on, if any. */
  const meets = (point: Point, segment: Segment) =>
    boxes.find((box) => sides(placed.get(box)!).some(([side, axis]) => same(side, point) && axis === segment.axis));

  const left: string[] = [];
  const reached: string[] = [];
  const joined = new Map(pieces.map((piece) => [piece, new Set([piece])]));
  for (const piece of pieces) {
    piece.ends.forEach((point, end) => {
      const box = meets(point, piece.segment);
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

  expect(left, `${layout} line from ${from}`).toEqual([from]);
  expect(reached.sort(), `${layout} line from ${from}`).toEqual([...to].sort());
  expect(joined.get(pieces[0])!.size, `${layout} line from ${from} is one unbroken line`).toBe(pieces.length);
}

/**
 * A frame holds exactly the boxes it names, each whole, and no other box;
 * its gutters (the frame's edge track and row on each side) hold nothing but
 * connectors.
 */
export function expectFrame(
  grid: Grid,
  members: readonly string[],
  boxes: readonly string[],
  connectors: readonly string[],
): void {
  const frame = frameRect(grid, members);
  const placed = rects(grid);
  const inside = (rect: Rect) => rect.x0 >= frame.x0 && rect.x1 <= frame.x1 && rect.y0 >= frame.y0 && rect.y1 <= frame.y1;
  const overlaps = (rect: Rect) => rect.x0 < frame.x1 && rect.x1 > frame.x0 && rect.y0 < frame.y1 && rect.y1 > frame.y0;

  const held = boxes.filter((box) => overlaps(placed.get(box)!));
  expect(held.sort(), "the boxes the frame holds").toEqual([...members].sort());
  for (const member of members) expect(inside(placed.get(member)!), `${member} lies wholly in its frame`).toBe(true);

  grid.map.forEach((row, y) =>
    row.split(" ").forEach((name, x) => {
      const inFrame = x >= frame.x0 && x < frame.x1 && y >= frame.y0 && y < frame.y1;
      const inGutter = inFrame && (x === frame.x0 || x === frame.x1 - 1 || y === frame.y0 || y === frame.y1 - 1);
      if (inGutter && name !== ".") expect(connectors, `the gutter cell ${x},${y} holds ${name}`).toContain(name);
    }),
  );
}

/** The wide map fits the width it goes wide at, so a box added later cannot overflow quietly. */
export function expectWideFits(wide: Grid, wideFrom: number): void {
  expect(minWidth(wide), `the wide map's narrowest against ${wideFrom}px`).toBeLessThanOrEqual(wideFrom);
}

/**
 * The stylesheet goes wide in one container query, at the one width; each
 * layout shows its own segments and grid; a rule places every area; every
 * selector starts at the figure; and it holds no `<`.
 */
export function expectDrawingStylesheet(
  css: string,
  attribute: string,
  areas: Record<Layout, Grid>,
  wideFrom: number,
): void {
  const [compact, wide, ...rest] = css.split("@container");
  const template = (grid: Grid) => `grid-template-areas:${grid.map.map((row) => `"${row}"`).join(" ")}`;

  expect(rest).toHaveLength(0);
  expect(wide.startsWith(` (min-width:${wideFrom}px){`)).toBe(true);
  expect(css.match(new RegExp(`\\b${wideFrom}px`, "g"))).toHaveLength(1);
  expect(compact).toContain("[data-layout=wide]{display:none}");
  expect(compact).toContain(template(areas.compact));
  expect(wide).toContain("[data-layout=compact]{display:none}");
  expect(wide).toContain("[data-layout=wide]{display:block}");
  expect(wide).toContain(template(areas.wide));
  for (const name of areaNames(areas.compact)) expect(css, name).toContain(`[data-area=${name}]{grid-area:${name}}`);

  expect(css).not.toContain("<");
  const selectors = css
    .replace(/@container[^{]*\{/, "")
    .split("}")
    .map((rule) => rule.split("{")[0].trim())
    .filter(Boolean);
  for (const selector of selectors) expect(selector, selector).toMatch(new RegExp(`^\\[data-${attribute}\\] `));
}
