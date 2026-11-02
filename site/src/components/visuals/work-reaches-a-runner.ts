/**
 * How work reaches a runner, as data: the picture on the docs' Runners page,
 * drawn still in the homepage drawing's language.
 *
 * Your app sends a message to a Session. Inside Stigmer, the server puts
 * the run on a Temporal task queue and never picks a runner; a runner polls
 * the queue and takes the run, which carries the Session's Harness and a
 * credential minted for that run alone. The runner calls your model
 * provider, and writes what the Agent did back to the server through the
 * same API your backend calls (backend/services/runner/src/client/). Every
 * way of running Stigmer starts the runner beside the server, so it sits
 * inside Stigmer's frame; the picture names no edition, because it holds in
 * every one (docs/concepts/runners.mdx).
 *
 * The layout is the shared engine's (`drawing/grid.ts`): every box, line
 * piece and label is a named grid area, the frame is computed from what it
 * holds, and the picture goes wide from 600px, the docs column's width on
 * a laptop. It is still: the path the run takes is its lit connectors, and
 * the dashed write-back is quiet.
 *
 * Imports stay relative: the docs' markdown export reads `CAPTION` under
 * `tsx`, which does not resolve the site's `@/` alias.
 */
import { drawingCss, type Connector, type Grid, type Layout, type Segment } from "./drawing/grid";

/** The figure's attribute: `data-work-reaches-a-runner`. */
export const ATTRIBUTE = "work-reaches-a-runner";

/** The places, in the order a run passes them: each box's name and its small line. */
export const PLACES = {
  app: { name: "Your app", detail: "sends a message to a Session" },
  server: { name: "Server", detail: "puts each run on the queue" },
  temporal: { name: "Temporal", detail: "task queue stigmer_runner" },
  runner: { name: "Runner", detail: "polls the queue" },
  provider: { name: "Your model provider", detail: "the runner calls it" },
} as const;

export type PlaceId = keyof typeof PLACES;

export const BOXES = Object.keys(PLACES) as PlaceId[];

/** What each run carries to the runner that takes it, drawn as chips in the runner. */
export const CARRIES = ["the Session's Harness", "a credential for this run"] as const;

/** The frame round what Stigmer runs, and the boxes it holds. */
export const FRAME = {
  id: "stigmer",
  label: "Stigmer",
  holds: ["server", "temporal", "runner"],
} as const satisfies { id: string; label: string; holds: readonly PlaceId[] };

/** The lines' labels. */
export const LABELS = { "poll-label": "polls", "write-label": "writes what the Agent did" } as const;

export type LabelId = keyof typeof LABELS;

/** The container width, in px, from which the picture lays out wide; its wide map's narrowest is 552px. */
export const WIDE_FROM = 600;

/** Half of a wide box; two make a box, so its centre is a grid line. */
const HALF = "minmax(56px,1fr)";
/** A wide link between boxes. */
const LINK = "24px";
/** The frame's gutter, round what it holds. */
const GUTTER = "16px";
/** A compact sixth of the content column. */
const SIXTH = "minmax(0,1fr)";
/** The compact frame's side gutter, wide enough to carry the dashed line down its middle. */
const SIDE = "24px";

/**
 * The two maps. Wide, an L: your app, the server and Temporal along the top
 * row, the runner under Temporal and your model provider to its right,
 * outside the frame; the runner's poll runs up into the queue, and the
 * dashed write-back runs left from the runner and up into the server. Compact,
 * everything runs down the page through the centre line, and the dashed
 * write-back climbs the frame's left gutter into the server's side.
 */
export const AREAS = {
  wide: {
    columns: [HALF, HALF, LINK, GUTTER, HALF, HALF, LINK, HALF, HALF, GUTTER, LINK, HALF, HALF],
    rows: ["32px", "minmax(72px,auto)", "minmax(48px,auto)", "minmax(88px,auto)", "16px"],
    map: [
      ". . . . . . . . . . . . .",
      "app app l-app l-app server server l-queue temporal temporal . . . .",
      ". . . . write-in write-label write-label l-poll poll-label . . . .",
      ". . . . . write-run write-back runner runner l-provider l-provider provider provider",
      ". . . . . . . . . . . . .",
    ],
    maxWidth: "none",
    text: [14, 20],
  },
  compact: {
    columns: [SIDE, SIXTH, SIXTH, SIXTH, SIXTH, SIXTH, SIXTH, SIDE],
    rows: [
      "minmax(64px,auto)",
      "20px",
      "32px",
      "minmax(64px,auto)",
      "28px",
      "minmax(64px,auto)",
      "minmax(40px,auto)",
      "minmax(88px,auto)",
      "16px",
      "20px",
      "minmax(64px,auto)",
    ],
    map: [
      ". app app app app app app .",
      ". . . l-app . . . .",
      ". . . l-app . . . .",
      "write-in server server server server server server .",
      "write-run . . l-queue . . . .",
      "write-run temporal temporal temporal temporal temporal temporal .",
      "write-run write-label write-label l-poll poll-label poll-label poll-label .",
      "write-back runner runner runner runner runner runner .",
      ". . . l-provider . . . .",
      ". . . l-provider . . . .",
      ". . provider provider provider provider . .",
    ],
    maxWidth: "480px",
    text: [14, 20],
  },
} as const satisfies Record<Layout, Grid>;

const RIGHT: Segment = { axis: "x", from: "start", to: "end", at: "centre", arrow: true };
/** Down the end edge of a one-track area: the centre line of a box over the tracks either side of it. */
const DOWN_EDGE: Segment = { axis: "y", from: "start", to: "end", at: "end", arrow: true };
/** Up the end edge of a one-track area. */
const UP_EDGE: Segment = { axis: "y", from: "end", to: "start", at: "end", arrow: true };

/** The part a still picture lights: the run's path from your app to your model provider. */
export const PATH = "path";

/** The connectors, each in its own area, in both layouts; the run's path is lit and the write-back is quiet. */
export const CONNECTORS = {
  "l-app": { part: PATH, segments: { wide: [RIGHT], compact: [DOWN_EDGE] } },
  "l-queue": { part: PATH, segments: { wide: [RIGHT], compact: [DOWN_EDGE] } },
  "l-poll": { part: PATH, segments: { wide: [UP_EDGE], compact: [UP_EDGE] } },
  "l-provider": { part: PATH, segments: { wide: [RIGHT], compact: [DOWN_EDGE] } },
  "write-back": {
    dashed: true,
    segments: {
      wide: [{ axis: "x", from: "end", to: "start", at: "centre" }],
      compact: [
        { axis: "x", from: "end", to: "centre", at: "centre" },
        { axis: "y", from: "centre", to: "start", at: "centre" },
      ],
    },
  },
  "write-run": {
    dashed: true,
    segments: {
      wide: [
        { axis: "x", from: "end", to: "start", at: "centre" },
        { axis: "y", from: "centre", to: "start", at: "start" },
      ],
      compact: [{ axis: "y", from: "end", to: "start", at: "centre" }],
    },
  },
  "write-in": {
    dashed: true,
    segments: {
      wide: [{ axis: "y", from: "end", to: "start", at: "end", arrow: true }],
      compact: [
        { axis: "y", from: "end", to: "centre", at: "centre" },
        { axis: "x", from: "centre", to: "end", at: "centre", arrow: true },
      ],
    },
  },
} as const satisfies Record<string, Connector>;

export type ConnectorId = keyof typeof CONNECTORS;

/** Every area the compact map names: the boxes, the connectors and the labels. */
export const AREA_NAMES = [...BOXES, ...(Object.keys(CONNECTORS) as ConnectorId[]), ...(Object.keys(LABELS) as LabelId[])];

/**
 * The drawing's stylesheet: its grids, its frame, its labels set just beside
 * their lines, and, wide, your model provider held to the runner's middle
 * rather than stretched to the runner's height.
 */
export const DRAWING_CSS = drawingCss({
  attribute: ATTRIBUTE,
  areas: AREAS,
  wideFrom: WIDE_FROM,
  frames: { [FRAME.id]: FRAME.holds },
  rules: {
    compact: ['[data-area$="-label"]{align-self:center;justify-self:start;padding:4px 8px}'],
    wide: ["[data-area=provider]{align-self:center}"],
  },
});

/** A place as it reads mid-sentence: "your app". */
function inSentence(id: "app" | "provider"): string {
  return `your ${PLACES[id].name.slice("Your ".length)}`;
}

/** The text alternative, and what the docs' markdown exports carry in the picture's place. */
export const CAPTION = [
  `${PLACES.app.name} sends a message to a Session.`,
  `Inside Stigmer, the server puts the run on a Temporal task queue, stigmer_runner by default, and never picks a runner.`,
  `A runner polls the queue and takes the run, which carries ${CARRIES[0]} and ${CARRIES[1]} alone.`,
  `The runner calls ${inSentence("provider")}, and writes what the Agent did back to the server.`,
].join(" ");
