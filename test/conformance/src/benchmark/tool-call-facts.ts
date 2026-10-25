// Reads what each tool call of a turn did into the sample: which model round
// issued it, what it pointed at, and how it ended; and what the turn's to-do
// list held at the end. Counts alone (`rounds`, `tool_calls`) say that a turn
// took nine rounds; these facts say why: a read repeated, an edit that did
// not match, a test run twice, a list never kept.
// Domain: conformance benchmark (the session's log, per tool call).
//
// Where each fact comes from, and why there:
// - The call itself is a tool use on the turn's PRIMARY thread in the
//   session's log, folded (`Turn`, @stigmer/session-log): name, input,
//   result, state, in the order the agent made the calls. A sub-agent's calls
//   are on its own thread and are not the thread measured.
// - The round is NOT in the log: the runner's turn timeline is the one record
//   of rounds: one `model_round` span per provider call, one `tool:<name>`
//   span per call (`tool:<slug>/<name>` for an MCP tool), in start order
//   (runner harness/turn-timeline.ts). A call takes the round of the first
//   unmatched span of its name, in order. A sub-agent's rounds and tools are
//   spans on the same timeline, so when any `sub_agent:` span is present the
//   alignment is ambiguous and every round is left `null` rather than
//   guessed. A placed call also keeps its span's start (`start_ms`), on the
//   runner's clock, so a reader can tell which calls ran while a background
//   command did (`background-readings.ts`).
// - The outcome is read from the result, because the native engine RETURNS a
//   failed edit as a plain result string ("Error: String not found in
//   file: ..."), so a call can complete and have done nothing (deepagents
//   backends/utils.ts `performStringReplacement`; its sandbox twin words the
//   same two failures differently). The recognised wordings are listed once
//   below; anything else that starts `Error:` is `failed`.
// - Only the target is kept, never a result or a file's content: the report
//   is kept with the record of the work and read by people, and a call's
//   target (a path, a pattern, the head of a command) is what a reader needs
//   to tell a re-read from a new read.
// - A shell call that asked to run its command in the background says so
//   (`background`), because its result is the command's start, not its
//   output: the native shell tool's `background: true` argument (runner
//   middleware/shell.ts `BACKGROUND_ARG`, since #2562).
import type { ToolUse, Turn } from "@stigmer/session-log";
import type { TimingLine, TodoCounts, ToolCallFact, ToolCallOutcome } from "./report";

/** The longest command head a fact keeps: enough to tell `go test ./...` from `ls -la`. */
export const COMMAND_TARGET_CHARS = 80;

/** The native engine's shell tool, the one call that can run in the background. */
export const SHELL_TOOL = "execute";

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

/** Every primary-thread tool call of the turn, in the order the agent made them, each placed on its model round. */
export function toolCallFacts(turn: Turn | undefined, turnPhases: TimingLine | null): ToolCallFact[] {
  const uses = (turn?.items ?? []).filter((item): item is ToolUse => item.kind === "tool_use");
  const rounds = roundsByToolSpan(turnPhases);
  return uses.map((use) => {
    const args = use.input;
    const offset = args["offset"];
    const limit = args["limit"];
    const span = rounds === null ? undefined : takeSpan(rounds, use.name);
    return {
      round: span?.round ?? null,
      start_ms: span?.start_ms ?? null,
      name: use.name,
      target: targetOf(args),
      ...(typeof offset === "number" ? { offset } : {}),
      ...(typeof limit === "number" ? { limit } : {}),
      status: use.state,
      outcome: outcomeOf(use),
      ...(use.name === SHELL_TOOL && args["background"] === true ? { background: true as const } : {}),
    };
  });
}

/** The turn's to-do list at its end, counted by state: what the user's progress card showed. */
export function todoCounts(turn: Turn | undefined): TodoCounts {
  const counts: TodoCounts = { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
  for (const item of turn?.todos ?? []) counts[item.status] += 1;
  return counts;
}

/**
 * How a call ended. A completed call whose result is a returned error is not
 * `ok`; a call a person or a rule refused is `skipped`; one still running,
 * waiting, or stopped by its turn's end is `unsettled`.
 */
export function outcomeOf(use: Pick<ToolUse, "state" | "result">): ToolCallOutcome {
  switch (use.state) {
    case "completed": {
      const head = (use.result?.text ?? "").trimStart();
      if (NOT_FOUND_RESULTS.some((pattern) => pattern.test(head))) return "not_found";
      if (NOT_UNIQUE_RESULTS.some((pattern) => pattern.test(head))) return "not_unique";
      return head.startsWith("Error:") ? "failed" : "ok";
    }
    case "failed":
      return "failed";
    case "denied":
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

/** A tool span: its bare name, the round it started in and its start on the runner's clock. */
interface ToolSpan {
  name: string;
  round: number;
  start_ms: number;
}

// Each tool span's bare name with the 1-based round it started in, in start
// order; `null` when the timeline is absent or carries a sub-agent (see the
// header). A call started before any round is on round 0, which the runner
// never emits and a reader would see as the anomaly it is.
function roundsByToolSpan(turnPhases: TimingLine | null): ToolSpan[] | null {
  if (turnPhases === null) return null;
  const segments = [...turnPhases.segments].sort((a, b) => a.start_ms - b.start_ms);
  if (segments.some((segment) => segment.name.startsWith(SUB_AGENT_SEGMENT_PREFIX))) return null;
  const spans: ToolSpan[] = [];
  let round = 0;
  for (const segment of segments) {
    if (segment.name === MODEL_ROUND_SEGMENT) {
      round += 1;
    } else if (segment.name.startsWith(TOOL_SEGMENT_PREFIX)) {
      const qualified = segment.name.slice(TOOL_SEGMENT_PREFIX.length);
      spans.push({ name: qualified.slice(qualified.lastIndexOf("/") + 1), round, start_ms: segment.start_ms });
    }
  }
  return spans;
}

function takeSpan(spans: ToolSpan[], name: string): ToolSpan | undefined {
  const index = spans.findIndex((span) => span.name === name);
  if (index === -1) return undefined;
  return spans.splice(index, 1)[0];
}
