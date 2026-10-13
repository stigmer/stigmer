// `runs logs` — a run's events, one line each.
//
// A run is one turn of its session, and the turn's events are the session's
// log filtered to the run. Without --follow the run's stored events are
// listed (every page) and printed. With --follow the same listing is printed,
// then the session is followed from the last listed event: every new event is
// folded, the run's own are printed, and the follow stops once the fold says
// the turn has ended.
//
// A line is the event's Managed Agents type and its gist: the text of an
// event that carries content (a message, a tool result), else its Managed
// Agents JSON without the type, id and time (a tool use's name and input, an
// ask with its tool_use_id, a status's phase). The tool_use_id on a
// stigmer.permission.asked line is what `runs approve --tool-call` takes.
//
// Ctrl-C ends a follow cleanly: the SIGINT aborts the follow, which then
// simply stops (no stack trace).

import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import { followSession, SessionLog, toManagedAgentsJson, turnOf, type Stigmer, type Turn } from "@stigmer/sdk";
import { shouldColorize, styler } from "../output/style.js";
import { listSessionEvents, sessionOfRun } from "./session.js";

const MAX_LINE_LEN = 200;

export interface LogsOptions {
  readonly runId: string;
  readonly follow: boolean;
}

/** Where rendered log lines go. */
export interface LineSink {
  write(line: string): void;
}

/** A line sink and whether to colour it. */
export interface LogsStreams {
  readonly out: LineSink;
  readonly colorize: boolean;
}

/** Print or follow a run's events. `signal` aborts a follow cleanly. */
export async function streamRunLogs(
  client: Stigmer,
  opts: LogsOptions,
  signal: AbortSignal,
  streams: LogsStreams = defaultStreams(),
): Promise<void> {
  const sessionId = sessionOfRun(await client.run.get(opts.runId));
  const events = await listSessionEvents(client, sessionId, opts.runId);
  if (!opts.follow) {
    if (events.length === 0) {
      streams.out.write("No events recorded for this run.\n");
      return;
    }
    for (const event of events) renderEvent(event, streams);
    return;
  }

  for (const event of events) renderEvent(event, streams);
  const log = new SessionLog();
  log.apply(events);
  const listed = turnOf(log.snapshot(), opts.runId);
  if (listed?.ended === true) {
    renderEnd(listed, streams);
    return;
  }
  for await (const frame of followSession(client, sessionId, { signal, afterSeq: log.snapshot().lastSeq })) {
    if (frame.frame.case === "event" && frame.frame.value.runId === opts.runId) renderEvent(frame.frame.value, streams);
    log.applyFrame(frame);
    const turn = turnOf(log.snapshot(), opts.runId);
    if (turn?.ended === true) {
      renderEnd(turn, streams);
      return;
    }
  }
}

// One event's log line: its type, tinted by who wrote it, and its gist.
function renderEvent(event: SessionEvent, streams: LogsStreams): void {
  const style = styler(streams.colorize);
  const json = toManagedAgentsJson(event);
  const type = String(json.type);
  streams.out.write(`[${tintOf(type, style)(type)}] ${truncate(gistOf(json), MAX_LINE_LEN)}\n`);
}

function renderEnd(turn: Turn, streams: LogsStreams): void {
  const style = styler(streams.colorize);
  streams.out.write(`\n${style.dim("[end]")} run ${turn.status?.phase ?? "ended"}\n`);
}

// A person's events cyan, the agent's green, the session's yellow, Stigmer's own dim.
function tintOf(type: string, style: ReturnType<typeof styler>): (text: string) => string {
  if (type.startsWith("user.")) return style.cyan;
  if (type.startsWith("agent.")) return style.green;
  if (type.startsWith("session.")) return style.yellow;
  return style.dim;
}

// The text an event carries, else its JSON without what the line already says.
function gistOf(json: JsonObject): string {
  const { type: _type, id: _id, processed_at: _processedAt, ...rest } = json;
  const text = textOf(rest.content);
  if (text !== undefined) return text;
  return Object.keys(rest).length === 0 ? "" : JSON.stringify(rest);
}

// The joined text blocks of a content list; undefined when there is no list.
function textOf(content: JsonValue | undefined): string | undefined {
  if (!Array.isArray(content)) return undefined;
  return content
    .map((block) => (isObject(block) && typeof block.text === "string" ? block.text : ""))
    .join("");
}

function isObject(value: JsonValue): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Cap a line (197 + "...").
function truncate(value: string, maxLen: number): string {
  return value.length > maxLen ? `${value.slice(0, maxLen - 3)}...` : value;
}

function defaultStreams(): LogsStreams {
  return {
    out: { write: (line: string) => void process.stdout.write(line) },
    colorize: shouldColorize(process.stdout),
  };
}
