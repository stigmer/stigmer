// Reads what each tool call of a turn did into the sample: which model round
// issued it, what it pointed at, and how it ended; and what the turn's to-do
// list held at the end. Counts alone (`rounds`, `tool_calls`) say that a turn
// took nine rounds; these facts say why: a read repeated, an edit that did
// not match, a test run twice, a list never kept.
// Domain: conformance benchmark (the status-borne facts, per tool call).
//
// Where each fact comes from, and why there:
// - The call itself is the ROOT transcript's tool-call row
//   (`status.messages[].tool_calls[]`): name, args, result, status. Sub-agent
//   rows live under `sub_agent_executions` and are not the thread measured.
// - The round is NOT the row's message: the one transcript builder attaches a
//   tool row to the latest AI message WITH TEXT, so the calls of a round that
//   wrote no text sit on an earlier message (runner harness/transcript/
//   builder.ts, "The AI-message boundary"). The runner's turn timeline is the
//   one record of rounds: one `model_round` span per provider call, one
//   `tool:<name>` span per call (`tool:<slug>/<name>` for an MCP tool), in
//   start order (runner harness/turn-timeline.ts). A row takes the round of
//   the first unmatched span of its name, in order. A sub-agent's rounds and
//   tools are spans on the same timeline, so when any `sub_agent:` span is
//   present the alignment is ambiguous and every round is left `null` rather
//   than guessed.
// - The outcome is read from the row, because the native engine RETURNS a
//   failed edit as a plain result string ("Error: String not found in
//   file: ..."), so a row can be COMPLETED and have done nothing (deepagents
//   backends/utils.ts `performStringReplacement`; its sandbox twin words the
//   same two failures differently). The recognised wordings are listed once
//   below; anything else that starts `Error:` is `failed`.
// - Only the target is kept, never a result or a file's content: the report
//   is kept with the record of the work and read by people, and a call's
//   target (a path, a pattern, the head of a command) is what a reader needs
//   to tell a re-read from a new read.
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { TodoStatus, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { TimingLine, TodoCounts, ToolCallFact, ToolCallOutcome } from "./report";

/** The longest command head a fact keeps: enough to tell `go test ./...` from `ls -la`. */
export const COMMAND_TARGET_CHARS = 80;

const MODEL_ROUND_SEGMENT = "model_round";
const TOOL_SEGMENT_PREFIX = "tool:";
const SUB_AGENT_SEGMENT_PREFIX = "sub_agent:";

// The argument that names what a call points at, in the order a call is read:
// the file tools' `file_path` (native `read_file`, `edit_file`, `write_file`),
// a listing's or a search's `path`, a search's `pattern`. `command` is read
// last and cut to its head.
const TARGET_ARGS = ["file_path", "path", "pattern"] as const;

// Failed edits the native engine returns as a result rather than an error,
// in both of its backends' words.
const NOT_FOUND_RESULTS = [/^Error: String not found in file/, /^String not found in file/];
const NOT_UNIQUE_RESULTS = [/has multiple occurrences/, /^Multiple occurrences found in/];

/** Every root tool call of the turn, in the order the calls started, each placed on its model round. */
export function toolCallFacts(execution: AgentExecution, turnPhases: TimingLine | null): ToolCallFact[] {
  const rows = (execution.status?.messages ?? [])
    .flatMap((message) => message.toolCalls)
    .map((row, index) => ({ row, index }))
    .sort((a, b) => instantOf(a.row.startedAt) - instantOf(b.row.startedAt) || a.index - b.index)
    .map(({ row }) => row);
  const rounds = roundsByToolSpan(turnPhases);
  return rows.map((row) => {
    const args = row.args ?? {};
    const offset = args["offset"];
    const limit = args["limit"];
    return {
      round: rounds === null ? null : takeRound(rounds, row.name),
      name: row.name,
      target: targetOf(args),
      ...(typeof offset === "number" ? { offset } : {}),
      ...(typeof limit === "number" ? { limit } : {}),
      status: statusName(row.status),
      outcome: outcomeOf(row),
    };
  });
}

/** The turn's to-do list at its end, counted by state: what the user's progress card showed. */
export function todoCounts(execution: AgentExecution): TodoCounts {
  const counts: TodoCounts = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const item of Object.values(execution.status?.todos ?? {})) {
    switch (item.status) {
      case TodoStatus.TODO_IN_PROGRESS:
        counts.in_progress += 1;
        break;
      case TodoStatus.TODO_COMPLETED:
        counts.completed += 1;
        break;
      case TodoStatus.TODO_CANCELLED:
        counts.cancelled += 1;
        break;
      default:
        counts.pending += 1;
    }
  }
  return counts;
}

/** How a row ended. A COMPLETED row whose result is a returned error is not `ok`. */
export function outcomeOf(row: Pick<ToolCall, "status" | "result" | "error">): ToolCallOutcome {
  switch (row.status) {
    case ToolCallStatus.TOOL_CALL_COMPLETED: {
      const head = row.result.trimStart();
      if (NOT_FOUND_RESULTS.some((pattern) => pattern.test(head))) return "not_found";
      if (NOT_UNIQUE_RESULTS.some((pattern) => pattern.test(head))) return "not_unique";
      return head.startsWith("Error:") ? "failed" : "ok";
    }
    case ToolCallStatus.TOOL_CALL_FAILED:
      return "failed";
    case ToolCallStatus.TOOL_CALL_SKIPPED:
      return "skipped";
    default:
      return "unsettled";
  }
}

/** What a call points at: the first of the target arguments present, else the command's head, else "". */
export function targetOf(args: Readonly<Record<string, unknown>>): string {
  for (const key of TARGET_ARGS) {
    const value = args[key];
    if (typeof value === "string" && value !== "") return value;
  }
  const command = args["command"];
  return typeof command === "string" ? command.slice(0, COMMAND_TARGET_CHARS) : "";
}

// Each tool span's bare name with the 1-based round it started in, in start
// order; `null` when the timeline is absent or carries a sub-agent (see the
// header). A call started before any round is on round 0, which the runner
// never emits and a reader would see as the anomaly it is.
function roundsByToolSpan(turnPhases: TimingLine | null): { name: string; round: number }[] | null {
  if (turnPhases === null) return null;
  const segments = [...turnPhases.segments].sort((a, b) => a.start_ms - b.start_ms);
  if (segments.some((segment) => segment.name.startsWith(SUB_AGENT_SEGMENT_PREFIX))) return null;
  const spans: { name: string; round: number }[] = [];
  let round = 0;
  for (const segment of segments) {
    if (segment.name === MODEL_ROUND_SEGMENT) {
      round += 1;
    } else if (segment.name.startsWith(TOOL_SEGMENT_PREFIX)) {
      const qualified = segment.name.slice(TOOL_SEGMENT_PREFIX.length);
      spans.push({ name: qualified.slice(qualified.lastIndexOf("/") + 1), round });
    }
  }
  return spans;
}

function takeRound(spans: { name: string; round: number }[], name: string): number | null {
  const index = spans.findIndex((span) => span.name === name);
  if (index === -1) return null;
  const [span] = spans.splice(index, 1);
  return span?.round ?? null;
}

// A row's start as milliseconds, by parse rather than by string order: two ISO
// stamps whose fractional digits differ do not sort as text. A row with no
// stamp keeps its transcript order among the others.
function instantOf(startedAt: string): number {
  const at = Date.parse(startedAt);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

function statusName(status: ToolCallStatus): string {
  return (ToolCallStatus[status] ?? "TOOL_CALL_STATUS_UNSPECIFIED").replace(/^TOOL_CALL_/, "").toLowerCase();
}
