/**
 * One job through Stigmer, with Stigmer opened up, as data: the picture
 * under "How it fits".
 *
 * Northwind Books, a customer inside your app, hands over its ledger. Your
 * app calls your backend, and your backend calls Stigmer the way it calls
 * your database. Inside Stigmer the call reaches the API, Access checks who
 * may do this, and the job engine starts and keeps the job, which runs in
 * this conversation's own sandbox, beside other customers' sandboxes it
 * cannot reach. The sandbox calls your model provider on your key, stops to
 * ask Northwind before it posts an adjustment (over the chat's own line,
 * straight from your app to Stigmer, as the embedded chat talks: docs/
 * getting-started/embed-agent.mdx), and the report comes back.
 *
 * Each technology named is true in every edition, and the docs say so: the
 * API a backend calls speaks gRPC (gRPC-Web from a browser) and Connect on
 * one port (backend/services/stigmer-server/src/transport/server.ts; its
 * plain-HTTP lanes are side doors, never the API, so the box does not say
 * REST); access is checked against one OpenFGA model in every edition
 * (backend/services/stigmer-server/src/authorization/README.md); and a job
 * runs on Temporal, which `stigmer up` starts too (docs/concepts/
 * runners.mdx). The model call leaves from the sandbox, where the runner
 * works; on Stigmer Cloud it passes Stigmer's model proxy, which adds the
 * key, and elsewhere the runner holds it, so the picture says only "on your
 * key", which holds everywhere.
 *
 * The layout (`drawing/grid.ts`): every box and line piece is a named grid
 * area, the frame round Stigmer's parts is computed from what it holds, and
 * the two maps are checked as the browser reads them. The loop
 * (`drawing/loop.ts`): a light walks the job's seven steps and settles on the
 * finished picture, the sandbox and the report lit.
 */
import { AGENT_GETS, type AgentGetId } from "@/lib/agent-gets";
import { JOB, OPACITY } from "../../../../brand/job-story";
import { drawingCss, type Connector, type Grid, type Layout, type Segment } from "./drawing/grid";
import { loopCss, type Loop, type LoopPart, type Timeline } from "./drawing/loop";

export { JOB };

/** The figure's attribute: `data-job-through-stigmer`. */
export const ATTRIBUTE = "job-through-stigmer";

/** The places, in the order the picture tells them: each box's name and its small line. */
export const PLACES = {
  app: { name: "Your app", detail: `${JOB.customer}, a customer` },
  backend: { name: "Your backend", detail: `sends ${JOB.ledger}` },
  database: { name: "Your database", detail: null },
  api: { name: "API", detail: "gRPC · Connect" },
  access: { name: "Access", detail: "OpenFGA" },
  job: { name: "The job", detail: "Temporal · survives restarts" },
  sandbox: { name: "This conversation's sandbox", detail: "Northwind's own computer" },
  provider: { name: "Your model provider", detail: "on your key" },
} as const;

export type PlaceId = keyof typeof PLACES;

/** The other customers' sandboxes, dimmed beside Northwind's; the first is named. */
export const OTHERS = { "other-a": "Another customer", "other-b": null } as const;

export type OtherId = keyof typeof OTHERS;

/** Every box the maps place. */
export const BOXES = [...(Object.keys(PLACES) as PlaceId[]), ...(Object.keys(OTHERS) as OtherId[])];

/** The frame round Stigmer, opened up, and the boxes it holds. */
export const FRAME = {
  id: "stigmer",
  label: "Stigmer",
  holds: ["api", "access", "job", "other-a", "other-b", "sandbox"],
} as const satisfies { id: string; label: string; holds: readonly (PlaceId | OtherId)[] };

/** The dashed line's label, from "your React app shows them the chat". */
export const CHAT = "the chat";

/** The container width, in px, from which the picture lays out wide: its wide map's narrowest (`minWidth`). */
export const WIDE_FROM = 960;

/** Half of a wide box; two make a box, so its centre is a grid line. */
const HALF = "minmax(64px,1fr)";
/** A wide link between boxes. */
const LINK = "32px";
/** The frame's gutter, round what it holds. */
const GUTTER = "16px";
/** A compact sixth of the content column. */
const SIXTH = "minmax(0,1fr)";

/**
 * The two maps. Wide, the call runs left to right along the middle row into
 * the frame, the job drops into the sandbox row, and the sandbox calls out
 * across the frame's right gutter to your model provider; your database sits
 * under your backend, and the chat line runs over the top into the API.
 * Compact, everything runs down the page through the centre line, your
 * database forked off to the right, the other customers' sandboxes as small
 * tiles either side of the job's line and Northwind's whole width under
 * them, and the chat line down the left lane into the API's side. Every box a line
 * meets in its middle spans tracks symmetric about that line.
 */
export const AREAS = {
  wide: {
    columns: [HALF, HALF, LINK, HALF, HALF, LINK, GUTTER, HALF, HALF, LINK, HALF, HALF, LINK, HALF, HALF, GUTTER, LINK, HALF, HALF],
    rows: ["24px", "28px", "32px", "minmax(88px,auto)", "32px", "minmax(88px,auto)", "16px"],
    map: [
      ". . . chat-label chat-label . . . . . . . . . . . . . .",
      ". chat-turn chat-run chat-run chat-run chat-run chat-run chat-into . . . . . . . . . . .",
      ". chat-from . . . . . chat-in . . . . . . . . . . .",
      "app app l-app backend backend l-backend l-backend api api l-api access access l-access job job . . . .",
      ". . . l-database . . . . . . . . . l-job . . . . .",
      ". . . database database . . other-a other-a . other-b other-b . sandbox sandbox l-provider l-provider provider provider",
      ". . . . . . . . . . . . . . . . . . .",
    ],
    maxWidth: "none",
    text: [14, 20],
  },
  compact: {
    columns: ["24px", GUTTER, SIXTH, SIXTH, SIXTH, SIXTH, SIXTH, SIXTH, GUTTER],
    rows: [
      "minmax(88px,auto)",
      "28px",
      "minmax(56px,auto)",
      "20px",
      "minmax(48px,auto)",
      "32px",
      "minmax(56px,auto)",
      "24px",
      "minmax(48px,auto)",
      "24px",
      "minmax(56px,auto)",
      "24px",
      "minmax(64px,auto)",
      "12px",
      "minmax(88px,auto)",
      "16px",
      "20px",
      "minmax(56px,auto)",
    ],
    map: [
      "chat-turn chat-from app app app app app app .",
      "chat-run . . . l-app . . . .",
      "chat-run . backend backend backend backend backend backend .",
      "chat-run . . . l-backend l-database l-database . .",
      "chat-run chat-label chat-label chat-label l-backend . database database .",
      "chat-run . . . l-backend . . . .",
      "chat-into chat-in api api api api api api .",
      ". . . . l-api . . . .",
      ". . access access access access access access .",
      ". . . . l-access . . . .",
      ". . job job job job job job .",
      ". . . . l-job . . . .",
      ". . other-a other-a l-job . other-b other-b .",
      ". . . . l-job . . . .",
      ". . sandbox sandbox sandbox sandbox sandbox sandbox .",
      ". . . . l-provider . . . .",
      ". . . . l-provider . . . .",
      ". . . provider provider provider provider . .",
    ],
    maxWidth: "480px",
    text: [14, 20],
  },
} as const satisfies Record<Layout, Grid>;

const RIGHT: Segment = { axis: "x", from: "start", to: "end", at: "centre", arrow: true };
/** Down the end edge of a one-track area: the centre line of a box over the tracks either side of it. */
const DOWN_EDGE: Segment = { axis: "y", from: "start", to: "end", at: "end", arrow: true };

/** The steps of the job, in order: the light walks them, then the finished picture holds. */
export const STEPS = ["hands-over", "sends", "checks", "starts", "works", "asks", "returns"] as const;

export type Step = (typeof STEPS)[number];

/** The connectors, each in its own area, in both layouts, with the part that lights it. */
export const CONNECTORS = {
  "l-app": { part: "to-backend", segments: { wide: [RIGHT], compact: [DOWN_EDGE] } },
  "l-backend": { part: "to-api", segments: { wide: [RIGHT], compact: [DOWN_EDGE] } },
  "l-database": {
    segments: {
      wide: [DOWN_EDGE],
      compact: [
        { axis: "x", from: "start", to: "end", at: "centre" },
        { axis: "y", from: "centre", to: "end", at: "end", arrow: true },
      ],
    },
  },
  "l-api": { part: "to-access", segments: { wide: [RIGHT], compact: [DOWN_EDGE] } },
  "l-access": { part: "to-job", segments: { wide: [RIGHT], compact: [DOWN_EDGE] } },
  "l-job": { part: "to-sandbox", segments: { wide: [DOWN_EDGE], compact: [DOWN_EDGE] } },
  "l-provider": { part: "to-provider", segments: { wide: [RIGHT], compact: [DOWN_EDGE] } },
  "chat-from": {
    dashed: true,
    part: "chat",
    segments: {
      wide: [{ axis: "y", from: "end", to: "start", at: "start" }],
      compact: [{ axis: "x", from: "end", to: "start", at: "centre" }],
    },
  },
  "chat-turn": {
    dashed: true,
    part: "chat",
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
    part: "chat",
    segments: {
      wide: [{ axis: "x", from: "start", to: "end", at: "centre" }],
      compact: [{ axis: "y", from: "start", to: "end", at: "centre" }],
    },
  },
  "chat-into": {
    dashed: true,
    part: "chat",
    segments: {
      wide: [
        { axis: "x", from: "start", to: "end", at: "centre" },
        { axis: "y", from: "centre", to: "end", at: "end" },
      ],
      compact: [
        { axis: "y", from: "start", to: "centre", at: "centre" },
        { axis: "x", from: "centre", to: "end", at: "centre" },
      ],
    },
  },
  "chat-in": {
    dashed: true,
    part: "chat",
    segments: {
      wide: [{ axis: "y", from: "start", to: "end", at: "end", arrow: true }],
      compact: [RIGHT],
    },
  },
} as const satisfies Record<string, Connector & { part?: PartId }>;

export type ConnectorId = keyof typeof CONNECTORS;

/** Every area the maps name: the boxes, the connectors and the chat's label. */
export const AREA_NAMES = [...BOXES, ...(Object.keys(CONNECTORS) as ConnectorId[]), "chat-label"];

/**
 * When each part shows and is lit. The boxes are the stage and always show;
 * the files and the question in your app show at their step and go when
 * handed on, so your app's one slot holds one at a time; the report and the
 * ledger in the sandbox stay. The finished picture lights the sandbox and
 * the report: the job done where it ran, and its result back in your app.
 */
export const PARTS = {
  app: { shows: "always", lit: ["hands-over", "asks", "returns"], litAtHold: false, layers: ["ring", "ink"] },
  "app-ledger": { shows: "hands-over", hides: "sends", lit: ["hands-over"], litAtHold: false, layers: ["ring", "ink"] },
  "app-ask": { shows: "asks", hides: "returns", lit: ["asks"], litAtHold: false, layers: ["ring", "ink"] },
  "app-report": { shows: "returns", lit: ["returns"], litAtHold: true, layers: ["ring", "ink"] },
  "to-backend": { shows: "always", lit: ["sends"], litAtHold: false, layers: ["stroke"] },
  backend: { shows: "always", lit: ["sends"], litAtHold: false, layers: ["ring", "ink"] },
  "to-api": { shows: "always", lit: ["sends"], litAtHold: false, layers: ["stroke"] },
  api: { shows: "always", lit: ["sends"], litAtHold: false, layers: ["ring", "ink"] },
  "to-access": { shows: "always", lit: ["checks"], litAtHold: false, layers: ["stroke"] },
  access: { shows: "always", lit: ["checks"], litAtHold: false, layers: ["ring", "ink"] },
  "to-job": { shows: "always", lit: ["starts"], litAtHold: false, layers: ["stroke"] },
  job: { shows: "always", lit: ["starts"], litAtHold: false, layers: ["ring", "ink"] },
  "to-sandbox": { shows: "always", lit: ["starts"], litAtHold: false, layers: ["stroke"] },
  sandbox: { shows: "always", lit: ["works"], litAtHold: true, layers: ["ring", "ink"] },
  "sandbox-ledger": { shows: "works", lit: ["works"], litAtHold: false, layers: ["ring", "ink"] },
  "to-provider": { shows: "always", lit: ["works"], litAtHold: false, layers: ["stroke"] },
  provider: { shows: "always", lit: ["works"], litAtHold: false, layers: ["ring", "ink"] },
  chat: { shows: "always", lit: ["asks"], litAtHold: false, layers: ["ink", "stroke"] },
} as const satisfies Record<string, LoopPart<Step>>;

export type PartId = keyof typeof PARTS;

/**
 * Where things happen in the cycle, in percent: the job picture's cycle and ramp,
 * so the two pictures breathe alike. The finished picture holds across the
 * seam for about five seconds, then the seven steps take about a second and
 * a half each.
 */
export const TIMELINE = {
  cycleSeconds: 16,
  rampSeconds: 0.3,
  clears: 18,
  steps: { "hands-over": 21, sends: 30, checks: 38, starts: 46, works: 55, asks: 65, returns: 75 },
  settles: 85,
} as const satisfies Timeline<Step>;

export const LOOP = {
  prefix: ATTRIBUTE,
  steps: STEPS,
  parts: PARTS,
  timeline: TIMELINE,
  opacity: OPACITY,
} as const satisfies Loop<Step, PartId>;

/** The stage the drawing and its pause button share, as wide as the drawing in each layout. */
const STAGE = `[data-${ATTRIBUTE}-stage]`;

/** The drawing's stylesheet: its grids, its frame, the stage's width and the chat label's place. */
export const DRAWING_CSS = drawingCss({
  attribute: ATTRIBUTE,
  areas: AREAS,
  wideFrom: WIDE_FROM,
  frames: { [FRAME.id]: FRAME.holds },
  rules: {
    compact: [
      `${STAGE}{max-width:${AREAS.compact.maxWidth}}`,
      "[data-area=chat-label]{align-self:center;justify-self:start;padding-left:4px}",
    ],
    wide: [
      `${STAGE}{max-width:${AREAS.wide.maxWidth}}`,
      "[data-area=chat-label]{align-self:center;justify-self:center;padding-left:0}",
    ],
  },
});

/** The loop's stylesheet. */
export const LOOP_CSS = loopCss(LOOP);

/** The parts the list under the picture names, each with the row higher up the page that proves it. */
export const PROVEN_AT = [
  { part: "access", proof: "walls", href: "#hard-parts-walls" },
  { part: "job", proof: "hours", href: "#hard-parts-hours" },
  { part: "sandbox", proof: "own-computer", href: "#sandbox" },
  { part: "provider", proof: "keys", href: "#hard-parts-keys" },
] as const satisfies readonly { part: PlaceId; proof: AgentGetId; href: `#${string}` }[];

/** A list item's words: the part's short name and its proof's title. */
export function provenAt(item: (typeof PROVEN_AT)[number]): { name: string; title: string } {
  const names: Record<(typeof PROVEN_AT)[number]["part"], string> = {
    access: PLACES.access.name,
    job: PLACES.job.name,
    sandbox: "The sandbox",
    provider: PLACES.provider.name,
  };
  return { name: names[item.part], title: AGENT_GETS[item.proof].title };
}

/** A place as it reads mid-sentence: "your app". */
function inSentence(id: "app" | "database" | "provider"): string {
  return `your ${PLACES[id].name.slice("Your ".length)}`;
}

/** The text alternative: one sentence per step, from the same words the picture draws. */
export const CAPTION = [
  `${JOB.customer}, a customer in ${inSentence("app")}, hands over ${JOB.ledger}.`,
  `${PLACES.backend.name} sends it to Stigmer's ${PLACES.api.name}, the way it calls ${inSentence("database")}.`,
  `${PLACES.access.name} checks who may do this.`,
  `${PLACES.job.name} starts on Temporal and survives restarts.`,
  `It works in this conversation's own sandbox, beside other customers' sandboxes it cannot reach, ` +
    `and calls ${inSentence("provider")} on your key.`,
  `It asks ${JOB.customer} before it runs ${JOB.tool}, over ${CHAT} straight to ${inSentence("app")}.`,
  `${JOB.report} comes back to ${inSentence("app")}.`,
].join(" ");
