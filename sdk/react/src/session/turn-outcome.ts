// What one turn produced, gathered for the block that closes it: the Files
// it returned, the files it changed, how it ended, how long it took, and
// its estimated cost.
//
// The Files are the conversation's Files whose run is this turn's, never
// the newest-wins view of the outputs folder, which would credit an
// earlier turn's file to the latest. The changes are the run's captured
// changes (its file record, each with a before and after a dialog can
// diff), else the paths its review sets name, else the paths its edit and
// write calls named (`path` on the Stigmer harness, `file_path` on the
// Claude one), less the Files it returned, which the agent saved under the
// workspace's `.stigmer/outputs/`; only a captured change
// can be shown without the inspector. The cost is the runner's
// display-only estimate (RunStatus.streaming_usage); zero or absent reads
// as no figure.

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  describeTurnActivity,
  resolveToolKind,
  type DisplayFileChange,
  type ToolUse,
  type Turn,
  type TurnPhase,
} from "@stigmer/client";
import { deriveRunFileChanges } from "../run/deriveRunFileChanges.js";

/** A path the turn changed, with its captured change when the run recorded one. */
export interface TurnChange {
  readonly path: string;
  readonly captured: DisplayFileChange | undefined;
}

/** One turn's outcome. */
export interface TurnOutcomeView {
  readonly runId: string;
  /** How the turn ended; undefined while it works. */
  readonly phase: TurnPhase | undefined;
  readonly elapsedMs: number;
  /** The Files the turn returned, oldest first. */
  readonly files: readonly StigmerFile[];
  /** The workspace paths the turn changed, in the order it changed them. */
  readonly changes: readonly TurnChange[];
  /** The runner's estimated cost in USD; undefined when it reported none. */
  readonly estimatedCostUsd: number | undefined;
}

const CHANGING_KINDS = new Set(["file_write", "file_edit", "file_delete"]);

/** The outcome of `turn` (module header). */
export function turnOutcome(turn: Turn, files: readonly StigmerFile[], run: Run | undefined): TurnOutcomeView {
  const returned = files.filter((file) => file.status?.runId === turn.runId);
  const returnedNames = new Set(returned.map((file) => file.status?.outputPath ?? ""));
  const reviewed = turn.fileReview.flatMap((set) => set.files.map((file) => file.path));
  const called = turn.items
    .filter((item): item is ToolUse => item.kind === "tool_use" && CHANGING_KINDS.has(resolveToolKind(item)))
    .map((tool) => pathOf(tool))
    .filter((path) => path !== "" && !isReturnedFile(path, returnedNames));
  const captured = run === undefined ? [] : deriveRunFileChanges([run]);
  const capturedByPath = new Map(captured.map((change) => [change.path, change]));
  const paths = captured.length > 0 ? captured.map((change) => change.path) : reviewed.length > 0 ? reviewed : called;
  const cost = run?.status?.streamingUsage?.estimatedCostUsd;
  return {
    runId: turn.runId,
    phase: turn.ended ? turn.status?.phase : undefined,
    elapsedMs: describeTurnActivity(turn, Date.now()).elapsedMs,
    files: returned,
    changes: [...new Set(paths)].map((path) => ({ path, captured: capturedByPath.get(path) })),
    estimatedCostUsd: cost !== undefined && cost > 0 ? cost : undefined,
  };
}

/** The path an edit or write call names, whichever harness made it; "" when it names none. */
function pathOf(tool: ToolUse): string {
  for (const key of ["path", "file_path"]) {
    const value = tool.input[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return "";
}

/** Where a path lands in the outputs folder, from the workspace's `.stigmer/outputs/` link. */
const OUTPUTS_FOLDER = /(?:^|\/)\.stigmer\/outputs\/(.+)$/;

/** Whether a written path is one of the Files the turn returned (saved in its outputs folder). */
function isReturnedFile(path: string, returned: ReadonlySet<string>): boolean {
  const saved = OUTPUTS_FOLDER.exec(path)?.[1];
  return saved !== undefined && returned.has(saved);
}
