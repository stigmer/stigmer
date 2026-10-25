// Counts the native runner's marker lines in a run's log: the one-line
// records the runner writes when it repairs an edit, cuts a long tool result,
// retries a failed model call, reads the repository's own instructions, or
// sees a PostToolUse hook fail. They say whether each of those paths fired
// during a run at all, which no sample can: a sample keeps its tool calls'
// targets and outcomes, never what the runner did around them.
// Domain: conformance benchmark (the runner's log, per run).
//
// Each marker is matched by its opening token at the start of a line, the
// way timing-lines.ts matches a `stigmer_timing` line; every other line (the
// timing JSON, the Temporal SDK's objects, prose, a torn last line) is
// skipped, never a failure. The writers, on `main` at 87c96f8e36:
// - `[EDIT-REPAIRED] tier=<tier>`: runner activities/execute-deep-agent/loose-edit.ts.
// - `[TRUNCATED] tool=<name> original_chars=<n> limit=<n> chars_truncated=<n> kept=<yes|no>`:
//   runner middleware/tool-truncation.ts. Before #2542 the same line had no
//   `kept=`, so a run of that code counts as `kept_absent`, line for line. Its
//   follow-up line (`could not keep the whole result`) is not a second cut.
// - `[MODEL-RETRY] phase=<request|stream> decision=<retry|stop> ...`: runner
//   shared/model-retry.ts and middleware/model-retry.ts.
// - `[REPO-INSTRUCTIONS] root=<n> ...` once per turn, and `nested=<n>` once
//   per attachment: runner activities/execute-deep-agent/turn-setup.ts and
//   middleware/folder-instructions.ts.
// - `[hooks] a PostToolUse hook failed: <error>`: runner
//   middleware/approval-gate.ts and execute-cursor/hook-server.ts. Other
//   `[hooks]` lines are not failures.
//
// The lines carry no execution id, so the counts are per run, over every
// cell and the quality arm together: enough to say whether a path fired, and
// how often. A restarted runner writes `runner-<n>.log` beside `runner.log`
// (run.ts `restartRunner`), so every `runner*.log` in the run's directory is
// read, once every execution has ended.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunnerLogMarkers } from "./report";

const EDIT_REPAIRED = "[EDIT-REPAIRED] ";
const TRUNCATED = "[TRUNCATED] ";
const MODEL_RETRY = "[MODEL-RETRY] ";
const REPO_INSTRUCTIONS = "[REPO-INSTRUCTIONS] ";
const HOOK_FAILED = "[hooks] a PostToolUse hook failed";

/** A run's runner logs: `runner.log` and every replacement's `runner-<n>.log`. */
const RUNNER_LOG = /^runner(-\d+)?\.log$/;

/** Zero of every marker, no file read. */
export function emptyMarkers(): RunnerLogMarkers {
  return {
    files: [],
    edit_repaired: {},
    truncated: { kept_yes: 0, kept_no: 0, kept_absent: 0, by_tool: {} },
    model_retry: { request: { retry: 0, stop: 0 }, stream: { retry: 0, stop: 0 } },
    repo_instructions: { root: 0, nested: 0 },
    hook_failures: 0,
  };
}

/** Adds every marker line in `text` to `into`, and returns it. */
export function countMarkers(text: string, into: RunnerLogMarkers = emptyMarkers()): RunnerLogMarkers {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimStart();
    if (line.startsWith(EDIT_REPAIRED)) {
      const tier = field(line, "tier");
      if (tier !== undefined) into.edit_repaired[tier] = (into.edit_repaired[tier] ?? 0) + 1;
    } else if (line.startsWith(TRUNCATED)) {
      const tool = field(line, "tool");
      if (tool === undefined || field(line, "original_chars") === undefined) continue;
      const kept = field(line, "kept");
      if (kept === "yes") into.truncated.kept_yes += 1;
      else if (kept === "no") into.truncated.kept_no += 1;
      else if (kept === undefined) into.truncated.kept_absent += 1;
      else continue;
      into.truncated.by_tool[tool] = (into.truncated.by_tool[tool] ?? 0) + 1;
    } else if (line.startsWith(MODEL_RETRY)) {
      const phase = field(line, "phase");
      const decision = field(line, "decision");
      if ((phase === "request" || phase === "stream") && (decision === "retry" || decision === "stop")) {
        into.model_retry[phase][decision] += 1;
      }
    } else if (line.startsWith(REPO_INSTRUCTIONS)) {
      if (field(line, "root") !== undefined) into.repo_instructions.root += 1;
      else if (field(line, "nested") !== undefined) into.repo_instructions.nested += 1;
    } else if (line.startsWith(HOOK_FAILED)) {
      into.hook_failures += 1;
    }
  }
  return into;
}

/** Every marker in every runner log of the run's directory, the files in name order. */
export async function readRunnerLogMarkers(runDir: string): Promise<RunnerLogMarkers> {
  const names = (await readdir(runDir)).filter((name) => RUNNER_LOG.test(name)).sort(byRestart);
  const markers = emptyMarkers();
  for (const name of names) {
    countMarkers(await readFile(join(runDir, name), "utf8"), markers);
    markers.files.push(name);
  }
  return markers;
}

// `runner.log` first, then each replacement in the order it started.
function byRestart(a: string, b: string): number {
  return restartOf(a) - restartOf(b);
}

function restartOf(name: string): number {
  const match = /^runner-(\d+)\.log$/.exec(name);
  return match === null ? 1 : Number(match[1]);
}

// The value of ` key=<value>` on the line, up to the next space; `undefined` when absent or empty.
function field(line: string, key: string): string | undefined {
  const match = new RegExp(`(?:^|\\s)${key}=(\\S+)`).exec(line);
  return match?.[1];
}

/** The run's marker counts on one line; the log files read, in order, at its end. */
export function renderRunnerLog(markers: RunnerLogMarkers): string {
  const byKey = (counts: Record<string, number>): string => {
    const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
    return entries.length === 0 ? "" : ` (${entries.map(([key, n]) => `${key} ${n}`).join(", ")})`;
  };
  const repaired = Object.values(markers.edit_repaired).reduce((sum, n) => sum + n, 0);
  const { truncated, model_retry: retry, repo_instructions: instructions } = markers;
  return [
    `edits repaired ${repaired}${byKey(markers.edit_repaired)}`,
    `results cut ${truncated.kept_yes + truncated.kept_no + truncated.kept_absent} (kept ${truncated.kept_yes}, not kept ${truncated.kept_no}, unsaid ${truncated.kept_absent})${byKey(truncated.by_tool)}`,
    `model calls retried ${retry.request.retry + retry.stream.retry}, stopped ${retry.request.stop + retry.stream.stop}`,
    `repository instructions read on ${instructions.root} turns, ${instructions.nested} nested`,
    `hook failures ${markers.hook_failures}`,
    `from ${markers.files.join(", ") || "no log"}`,
  ].join("; ");
}
