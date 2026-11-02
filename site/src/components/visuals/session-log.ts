/**
 * Northwind Books' Session as its log, as data: the picture on the docs'
 * Sessions page.
 *
 * Two messages, two runs. The first asks for this quarter's variance report
 * and names the ledger; the agent stops to ask before it posts an adjustment,
 * is allowed, and writes the report. The second asks for the flagged accounts
 * only, and never names the ledger again: the run reads the first one's
 * messages, and a message's Files stay with the conversation
 * (docs/concepts/files.mdx).
 *
 * Each run's events are exactly the order the server keeps on the Claude
 * Managed Agents format, which the conformance suite asserts in
 * test/conformance/src/suites-execution/session-events-managed-agents.conformance.test.ts
 * (a plain turn, and a turn whose MCP tool waits for an approval). A change
 * to that order changes this picture. Stigmer's own `stigmer.*` events are
 * not on that format, so they are not drawn; the page links them.
 *
 * Who writes each event follows its type, as the server's event catalog
 * rules (backend/services/stigmer-server/src/domain/session/events/catalog.ts):
 * the server writes the person's messages and answers and every status, and
 * a runner writes what the agent did. The phase lane is folded from the
 * log's own status events (`sessionPhases`), never set by hand, and the
 * picture holds no clock: no time, no duration, no figure.
 *
 * The stylesheet is the list's own: four columns from `WIDE_FROM`, and below
 * it each row's type over its words with the lane down its left edge. Every
 * selector starts at the figure's attribute, because React hoists the sheet
 * into the page's head, and it holds no `<`.
 *
 * Imports stay relative: the docs' markdown export reads `sessionLogText`
 * under `tsx`, which does not resolve the site's `@/` alias.
 */
import { JOB } from "../../../../brand/job-story";

/** The figure's attribute: `data-session-log`. */
export const ATTRIBUTE = "session-log";

/** The container width, in px, from which the log lays out in four columns. */
export const WIDE_FROM = 600;

/** The event types the picture draws, as the docs spell them. */
export type EventType =
  | "user.message"
  | "user.tool_confirmation"
  | "session.status_running"
  | "session.status_idle"
  | "agent.mcp_tool_use"
  | "agent.mcp_tool_result"
  | "agent.message";

/** Who writes an event to the log. */
export type Writer = "server" | "runner";

/** Why a Session went idle. */
export type StopReason = "requires_action" | "end_turn";

/** One event in the log. */
export interface LogEvent {
  type: EventType;
  /** What it says, in words. */
  says: string;
  writer: Writer;
  /** The files a message names or a reply hands back. */
  file?: string;
  /** The tool a call or its result names. */
  tool?: string;
  /** A call's `evaluated_permission`: `ask` when it waits for a person. */
  permission?: "ask";
  /** A confirmation's answer. */
  result?: "allow";
  /** An idle's `stop_reason`. */
  stopReason?: StopReason;
}

/** One message's run: its label and its events, in log order. */
export interface LogRun {
  id: string;
  label: string;
  events: readonly LogEvent[];
}

/** The figure's name for a screen reader. */
export const LABEL = `${JOB.customer}' Session, as its log of events`;

/** The second message, as the Sessions page tells it ("the flagged accounts only"). */
export const FOLLOW_UP = "Now only the flagged accounts.";

/** Northwind's Session: two messages, two runs. */
export const RUNS: readonly LogRun[] = [
  {
    id: "run-1",
    label: "Run 1",
    events: [
      { type: "user.message", says: `“${JOB.message}”`, writer: "server", file: JOB.ledger },
      { type: "session.status_running", says: "The Session starts working.", writer: "server" },
      {
        type: "agent.mcp_tool_use",
        says: "The Agent asks to post an adjustment.",
        writer: "runner",
        tool: JOB.tool,
        permission: "ask",
      },
      {
        type: "session.status_idle",
        says: `It stops to ask ${JOB.customer}.`,
        writer: "server",
        stopReason: "requires_action",
      },
      { type: "user.tool_confirmation", says: `${JOB.customer} allows it.`, writer: "server", result: "allow" },
      { type: "session.status_running", says: "It works again.", writer: "server" },
      { type: "agent.mcp_tool_result", says: "The adjustment is posted.", writer: "runner", tool: JOB.tool },
      { type: "agent.message", says: "The Agent hands back its report.", writer: "runner", file: JOB.report },
      { type: "session.status_idle", says: "The run is done.", writer: "server", stopReason: "end_turn" },
    ],
  },
  {
    id: "run-2",
    label: "Run 2",
    events: [
      { type: "user.message", says: `“${FOLLOW_UP}”`, writer: "server" },
      { type: "session.status_running", says: "The Session starts working.", writer: "server" },
      { type: "agent.message", says: "The flagged accounts only, from the same ledger.", writer: "runner" },
      { type: "session.status_idle", says: "The run is done.", writer: "server", stopReason: "end_turn" },
    ],
  },
];

/** What the Session is doing at an event: working, waiting for a person, or idle. */
export type Phase = "working" | "waiting" | "idle";

/** Each phase in words, for the legend, the export and a screen reader. */
export const PHASES: Record<Phase, string> = {
  working: "working",
  waiting: "waiting for a person",
  idle: "idle",
};

/**
 * Each event's phase, folded from the status events at or above it: a
 * Session is idle until it runs, working from `session.status_running`,
 * waiting from an idle that `requires_action`, and idle again at `end_turn`.
 */
export function sessionPhases(runs: readonly LogRun[]): Phase[][] {
  let phase: Phase = "idle";
  return runs.map((run) =>
    run.events.map((event) => {
      if (event.type === "session.status_running") phase = "working";
      if (event.type === "session.status_idle") phase = event.stopReason === "requires_action" ? "waiting" : "idle";
      return phase;
    }),
  );
}

/** The small mono marks an event carries after its type: its stop reason, tool, permission, answer or file. */
export function marks(event: LogEvent): string[] {
  return [event.stopReason, event.tool, event.permission, event.result, event.file].filter(
    (mark): mark is string => typeof mark === "string",
  );
}

/** The columns' headings, in order; the lane's is read from the legend. */
export const HEADINGS = { type: "Event", says: "What it says", writer: "Written by" } as const;

/** A table cell's text: backslashes, then pipes, escaped, on one line. */
export function cell(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/**
 * The log as the docs' markdown exports carry it: one table per run, each
 * row its event, its words, its writer and the Session's phase, from the
 * same data the picture draws. The page's own lead-in names the Session, so
 * the text starts at the first run.
 */
export function sessionLogText(): string {
  const phases = sessionPhases(RUNS);
  const tables = RUNS.map((run, index) => {
    const rows = run.events.map((event, at) => {
      const type = [event.type, ...marks(event)].map((mark) => `\`${mark}\``).join(" ");
      return `| ${type} | ${cell(event.says)} | ${event.writer} | ${PHASES[phases[index][at]]} |`;
    });
    return [
      `**${run.label}**`,
      "",
      `| ${HEADINGS.type} | ${HEADINGS.says} | ${HEADINGS.writer} | The Session |`,
      "| --- | --- | --- | --- |",
      ...rows,
    ].join("\n");
  });
  return tables.join("\n\n");
}

const SCOPE = `[data-${ATTRIBUTE}]`;

/** The type column's width: `agent.mcp_tool_result`, 21 characters of 12px Geist Mono, is about 151px. */
const TYPE = "160px";
/** The writer column: "Written by" in the headings' small caps. */
const WRITER = "80px";
/** The phase lane. */
const LANE = "24px";

/** A lane's look per phase, on its narrow bar and on the legend's swatch: working solid, waiting hatched, idle empty. */
const LANES: Record<Phase, string> = {
  working: "background:currentColor",
  waiting: "background:repeating-linear-gradient(135deg,currentColor 0 2px,transparent 2px 6px)",
  idle: "background:none",
};

/**
 * The list's stylesheet. Compact: each row its lane down the left edge, its
 * type and writer on one line and its words under them. Wide: four columns,
 * the lane last, the headings shown.
 */
export const SESSION_LOG_CSS = [
  `${SCOPE} [data-${ATTRIBUTE}-head]{display:none}`,
  `${SCOPE} [data-${ATTRIBUTE}-row]{display:grid;grid-template-columns:8px minmax(0,1fr) auto;column-gap:12px;` +
    `grid-template-areas:"lane type writer" "lane says says"}`,
  ...(["type", "says", "writer", "lane"] as const).map((area) => `${SCOPE} [data-cell=${area}]{grid-area:${area}}`),
  `${SCOPE} [data-cell=type],${SCOPE} [data-cell=writer]{padding-top:10px}`,
  `${SCOPE} [data-cell=says]{padding:2px 0 10px}`,
  `${SCOPE} [data-cell=type]{display:flex;flex-wrap:wrap;align-content:flex-start;column-gap:8px}`,
  `${SCOPE} [data-cell=lane]{display:flex;justify-content:center}`,
  `${SCOPE} [data-bar]{width:6px}`,
  ...(Object.entries(LANES) as [Phase, string][]).map(
    ([phase, look]) => `${SCOPE} [data-phase=${phase}] [data-bar],${SCOPE} [data-swatch=${phase}]{${look}}`,
  ),
  `@container (min-width:${WIDE_FROM}px){` +
    [
      `${SCOPE} [data-${ATTRIBUTE}-head],${SCOPE} [data-${ATTRIBUTE}-row]{display:grid;` +
        `grid-template-columns:${TYPE} minmax(0,1fr) ${WRITER} ${LANE};column-gap:16px;` +
        `grid-template-areas:"type says writer lane"}`,
      `${SCOPE} [data-cell=type],${SCOPE} [data-cell=says],${SCOPE} [data-cell=writer]{padding:10px 0}`,
    ].join("") +
    "}",
].join("\n");
