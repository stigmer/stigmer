/**
 * Where Stigmer sits in a developer's system, as data, and the stylesheet
 * that lays it out.
 *
 * Your users work in your app, your app calls your backend, and your backend
 * calls Stigmer the way it calls your database; Stigmer calls your model
 * provider. A second, dashed line runs from your app straight to Stigmer:
 * when the app shows the agent's chat, the browser talks to Stigmer itself
 * with a short-lived token your backend fetched (docs/getting-started/
 * embed-agent.mdx). It is the one place the comparison with a database bends,
 * and the first thing a developer embedding the chat asks.
 *
 * Every piece of the picture, each box and each connector, is a named grid
 * area. The two layouts differ only in their map of areas, their tracks and
 * the boxes' text size, so the markup is the same for both and each piece
 * knows only its name. `whereItSitsCss` turns the maps into the stylesheet,
 * so the width the picture goes wide at is written once, here.
 *
 * Connectors are segments anchored to their own area: each end sits on the
 * area's start, centre or end, never at a pixel coordinate, so the lines
 * follow the boxes at every width with no measuring in JavaScript. A box
 * spans two equal tracks (wide: two half-tracks; compact: two quarters, or
 * the chain's two quarters and the gap between them), so the centre a line
 * meets is always a grid line or the middle of one track.
 */

/** The places, in the order the picture tells them, as the docs spell them. */
export const PLACES = {
  users: "Your users",
  app: "Your app",
  backend: "Your backend",
  stigmer: "Stigmer",
  database: "Your database",
  provider: "Your model provider",
} as const;

export type PlaceId = keyof typeof PLACES;

/** The dashed line's label, from "your React app shows them the chat". */
export const CHAT = "the chat";

export type Layout = "wide" | "compact";

/** The container width, in px, from which the picture lays out wide. */
export const WIDE_FROM = 880;

/** Half of a wide box; two make a box, so its centre is a grid line. */
const HALF = "minmax(60px,84px)";
/** A wide link between boxes. */
const LINK = "minmax(40px,72px)";
/** A compact quarter; Stigmer and the database take two each. */
const QUARTER = "minmax(0,1fr)";

export interface Grid {
  columns: readonly string[];
  rows: readonly string[];
  /** One string per row, one area name (or `.`) per column. */
  map: readonly string[];
  /** The widest the grid draws, centred in the figure. */
  maxWidth: string;
  /** The boxes' text: font size and line height, in px. */
  text: readonly [number, number];
}

/**
 * The two maps. Wide, the chain runs across the middle row, Stigmer above it
 * and the database below, so the fork from the backend is symmetric and no
 * piece overlaps another; the chat line runs over the top. Compact, the
 * chain runs down the middle over the pair, and the chat line down the left
 * gutter into Stigmer's side. The compact grid stops at 480px so a tablet's
 * section does not stretch the boxes across it.
 */
export const AREAS = {
  wide: {
    columns: [HALF, HALF, LINK, HALF, HALF, LINK, HALF, HALF, LINK, HALF, HALF, LINK, HALF, HALF],
    rows: ["24px", "32px", "minmax(56px,auto)", "minmax(56px,auto)", "minmax(56px,auto)"],
    map: [
      ". . . . . . chat-label chat-label . . . . . .",
      ". . . . chat-turn chat-run chat-run chat-run chat-run chat-into . . . .",
      ". . . . chat-from . . . fork-stigmer stigmer stigmer l-stigmer provider provider",
      "users users l-users app app l-app backend backend fork-stem . . . . .",
      ". . . . . . . . fork-database database database . . .",
    ],
    maxWidth: "none",
    text: [15, 20],
  },
  compact: {
    columns: ["32px", QUARTER, QUARTER, "12px", QUARTER, QUARTER],
    rows: [
      "minmax(48px,auto)",
      "40px",
      "minmax(48px,auto)",
      "40px",
      "minmax(48px,auto)",
      "48px",
      "minmax(48px,auto)",
      "40px",
      "minmax(48px,auto)",
    ],
    map: [
      ". . users users users .",
      ". . . l-users . .",
      "chat-turn chat-from app app app .",
      "chat-run . . l-app . .",
      "chat-run chat-label backend backend backend .",
      "chat-run . fork-stigmer fork-stem fork-database .",
      "chat-into stigmer stigmer . database database",
      ". . l-stigmer . . .",
      ". provider provider . . .",
    ],
    maxWidth: "480px",
    text: [14, 18],
  },
} as const satisfies Record<Layout, Grid>;

/** A point along or across an area. */
export type Anchor = "start" | "centre" | "end";

/** One straight piece of a connector, inside its area. */
export interface Segment {
  /** `x` runs left and right, `y` up and down. */
  axis: "x" | "y";
  /** Where it starts and ends along its axis; it points from `from` to `to`. */
  from: Anchor;
  to: Anchor;
  /** Where it sits across its axis. */
  at: Anchor;
  /** Whether it ends in a chevron at `to`. */
  arrow?: true;
}

export interface Connector {
  /** The chat line is dashed and brighter; every other line is solid. */
  dashed?: true;
  segments: Record<Layout, readonly Segment[]>;
}

const RIGHT: Segment = { axis: "x", from: "start", to: "end", at: "centre", arrow: true };
const DOWN: Segment = { axis: "y", from: "start", to: "end", at: "centre", arrow: true };

/** The connectors, each in its own area, in both layouts. */
export const CONNECTORS = {
  "l-users": { segments: { wide: [RIGHT], compact: [DOWN] } },
  "l-app": { segments: { wide: [RIGHT], compact: [DOWN] } },
  "fork-stem": {
    segments: {
      wide: [
        { axis: "x", from: "start", to: "centre", at: "centre" },
        { axis: "y", from: "start", to: "end", at: "centre" },
      ],
      compact: [
        { axis: "y", from: "start", to: "centre", at: "centre" },
        { axis: "x", from: "start", to: "end", at: "centre" },
      ],
    },
  },
  "fork-stigmer": {
    segments: {
      wide: [
        { axis: "y", from: "end", to: "centre", at: "centre" },
        { axis: "x", from: "centre", to: "end", at: "centre", arrow: true },
      ],
      compact: [
        { axis: "x", from: "end", to: "start", at: "centre" },
        { axis: "y", from: "centre", to: "end", at: "start", arrow: true },
      ],
    },
  },
  "fork-database": {
    segments: {
      wide: [
        { axis: "y", from: "start", to: "centre", at: "centre" },
        { axis: "x", from: "centre", to: "end", at: "centre", arrow: true },
      ],
      compact: [
        { axis: "x", from: "start", to: "end", at: "centre" },
        { axis: "y", from: "centre", to: "end", at: "end", arrow: true },
      ],
    },
  },
  "l-stigmer": {
    segments: {
      wide: [RIGHT],
      compact: [{ axis: "y", from: "start", to: "end", at: "start", arrow: true }],
    },
  },
  "chat-from": {
    dashed: true,
    segments: {
      wide: [{ axis: "y", from: "end", to: "start", at: "start" }],
      compact: [{ axis: "x", from: "end", to: "start", at: "centre" }],
    },
  },
  "chat-turn": {
    dashed: true,
    segments: {
      wide: [
        { axis: "y", from: "end", to: "centre", at: "start" },
        { axis: "x", from: "start", to: "end", at: "centre" },
      ],
      compact: [
        { axis: "x", from: "end", to: "centre", at: "centre" },
        { axis: "y", from: "centre", to: "end", at: "centre" },
      ],
    },
  },
  "chat-run": {
    dashed: true,
    segments: {
      wide: [{ axis: "x", from: "start", to: "end", at: "centre" }],
      compact: [{ axis: "y", from: "start", to: "end", at: "centre" }],
    },
  },
  "chat-into": {
    dashed: true,
    segments: {
      wide: [
        { axis: "x", from: "start", to: "end", at: "centre" },
        { axis: "y", from: "centre", to: "end", at: "end", arrow: true },
      ],
      compact: [
        { axis: "y", from: "start", to: "centre", at: "centre" },
        { axis: "x", from: "centre", to: "end", at: "centre", arrow: true },
      ],
    },
  },
} as const satisfies Record<string, Connector>;

export type ConnectorId = keyof typeof CONNECTORS;

/** Every area the maps name: the places, the connectors and the chat label. */
export type AreaId = PlaceId | ConnectorId | "chat-label";

const FRACTION: Record<Anchor, number> = { start: 0, centre: 0.5, end: 1 };

/** Where an anchor falls along an area, as a fraction of it. */
export function fraction(anchor: Anchor): number {
  return FRACTION[anchor];
}

/** Whether a segment passes through or ends at a fraction along its axis. */
function covers(segment: Segment, along: number): boolean {
  const [low, high] = [fraction(segment.from), fraction(segment.to)].sort((a, b) => a - b);
  return low <= along && along <= high;
}

/**
 * Which ends of a segment turn a corner: they meet a perpendicular segment of
 * the same area. Two lines centred on crossing grid lines stop half their
 * thickness short of each other, so the renderer runs such an end on by half
 * a thickness to close the corner; an end at a box or a chevron stops at its
 * anchor.
 */
export function corners(segments: readonly Segment[], segment: Segment): { from: boolean; to: boolean } {
  const turns = (end: Anchor) =>
    segments.some(
      (other) =>
        other.axis !== segment.axis &&
        fraction(other.at) === fraction(end) &&
        covers(other, fraction(segment.at)),
    );
  return { from: turns(segment.from), to: !segment.arrow && turns(segment.to) };
}

/** One layout's grid, its boxes' text, and its segments shown and the other's hidden. */
function layoutRules(layout: Layout): string {
  const grid: Grid = AREAS[layout];
  const other: Layout = layout === "wide" ? "compact" : "wide";
  const areas = grid.map.map((row) => `"${row}"`).join(" ");
  return (
    `[data-where-it-sits] [data-where-it-sits-drawing]{grid-template-columns:${grid.columns.join(" ")};` +
    `grid-template-rows:${grid.rows.join(" ")};grid-template-areas:${areas};max-width:${grid.maxWidth}}` +
    `[data-where-it-sits] [data-box]{font-size:${grid.text[0]}px;line-height:${grid.text[1]}px}` +
    `[data-where-it-sits] [data-layout=${other}]{display:none}` +
    `[data-where-it-sits] [data-layout=${layout}]{display:block}`
  );
}

/** The area names a map uses, once each. */
export function areaNames(grid: Grid): Set<string> {
  return new Set(grid.map.flatMap((row) => row.split(" ")).filter((name) => name !== "."));
}

/**
 * The picture's stylesheet: the compact grid by default, a rule placing each
 * area, and the wide grid inside one container query. Every selector starts
 * at `[data-where-it-sits]`, because React hoists the sheet into the page's
 * head.
 *
 * `grid-template-areas` needs quoted strings. React escapes only `<style`
 * and `</style` in a hoisted style's text, so quotes reach the page as
 * written; the sheet holds no `<`, the one character that escaping touches.
 */
export function whereItSitsCss(): string {
  const names = [...areaNames(AREAS.compact)];
  return [
    `[data-where-it-sits] [data-where-it-sits-drawing]{display:grid;justify-content:center;margin-inline:auto}`,
    layoutRules("compact"),
    ...names.map((name) => `[data-where-it-sits] [data-area=${name}]{grid-area:${name}}`),
    `[data-where-it-sits] [data-area=chat-label]{align-self:center;justify-self:start;padding-left:6px}`,
    `@container (min-width:${WIDE_FROM}px){${layoutRules("wide")}` +
      `[data-where-it-sits] [data-area=chat-label]{justify-self:center;padding-left:0}}`,
  ].join("\n");
}
