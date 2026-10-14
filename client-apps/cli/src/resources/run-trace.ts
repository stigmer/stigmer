// `runs trace` — a run's tool-call structure.
//
// The run's events (the session's log filtered to the run, every page) are
// folded into its turn. The table names the run and its lifecycle (phase and
// duration, from the run), then one row per tool use in the order the agent
// made them, each with its state and the head of its output; a subagent's
// tool uses are indented beneath the call that started it. yaml and json list
// the run's events as Claude Managed Agents JSON, the lines `run --json`
// writes for the same turn.

import type { JsonObject } from "@bufbuild/protobuf";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { foldSession, toManagedAgentsJson, turnOf, type Stigmer, type Turn, type TurnItem } from "@stigmer/sdk";
import { stringify as toYaml } from "yaml";
import { shouldColorize, styler } from "../output/style.js";
import { calculateDuration, truncateWithEllipsis } from "./run-format.js";
import { formatAgentPhase } from "./runs.js";
import { listSessionEvents, sessionOfRun } from "./session.js";

/** Output format for trace: a compact structure table, or the run's events. */
export type TraceFormat = "table" | "yaml" | "json";

export interface TraceStreams {
  write(text: string): void;
  readonly colorize: boolean;
}

/** Fetch and render a run's structure. */
export async function traceRun(
  client: Stigmer,
  runId: string,
  format: TraceFormat,
  streams: TraceStreams = defaultStreams(),
): Promise<void> {
  const run = await client.run.get(runId);
  const events = await listSessionEvents(client, sessionOfRun(run), runId);
  if (format === "yaml" || format === "json") {
    const list: JsonObject[] = events.map(toManagedAgentsJson);
    streams.write(format === "yaml" ? toYaml(list) : `${JSON.stringify(list, null, 2)}\n`);
    return;
  }
  renderAgentTrace(run, turnOf(foldSession(events), runId), streams);
}

function renderAgentTrace(run: Run, turn: Turn | undefined, streams: TraceStreams): void {
  const name = run.metadata?.name || run.metadata?.id || "";
  const phase = formatAgentPhase(run.status?.phase ?? 0);
  const duration = calculateDuration(run.status?.startedAt ?? "", run.status?.completedAt ?? "");

  streams.write(`\nAgent: ${name} (${phase}, ${duration})\n\n`);

  if (turn === undefined) {
    streams.write("  (no events recorded)\n\n");
    return;
  }

  const rows = toolRows(turn.items, "", styler(streams.colorize));
  if (rows.length === 0) {
    const messages = turn.items.filter((item) => item.kind === "message").length;
    streams.write(`  ${messages} message(s), no tool calls\n\n`);
    return;
  }
  for (const row of rows) streams.write(`${row}\n`);
  streams.write("\n");
}

// One row per tool use, a subagent's beneath its call, indented.
function toolRows(items: readonly TurnItem[], indent: string, style: ReturnType<typeof styler>): string[] {
  const rows: string[] = [];
  for (const item of items) {
    if (item.kind !== "tool_use") continue;
    const badge = tintOf(item.state, style)(`[${item.state}]`);
    const name = pad(truncateWithEllipsis(item.name, 25), 25);
    const output = style.dim(truncateWithEllipsis(item.result?.text ?? "", 40));
    rows.push(`  ${indent}${badge} ${name}  ${output}`);
    if (item.thread !== undefined) rows.push(...toolRows(item.thread.items, `${indent}  `, style));
  }
  return rows;
}

// Done green, failed red, refused or cut short yellow, still open cyan.
function tintOf(state: string, style: ReturnType<typeof styler>): (text: string) => string {
  switch (state) {
    case "completed":
      return style.green;
    case "failed":
      return style.red;
    case "denied":
    case "stopped":
      return style.yellow;
    default:
      return style.cyan;
  }
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function defaultStreams(): TraceStreams {
  return { write: (text: string) => void process.stdout.write(text), colorize: shouldColorize(process.stdout) };
}
