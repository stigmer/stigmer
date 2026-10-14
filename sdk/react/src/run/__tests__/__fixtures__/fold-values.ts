// Test fixtures for the component suites: a folded tool use, subagent
// thread and file review, built as plain values in the shapes the session
// fold produces (`ToolUse`, `Thread`, `FileReviewSet`, `FileReviewFile`),
// so a component test states only the fields it is about. A tool use that
// returned starts at 10:00:00 and returns `durationMs` later; one that asks
// carries a `stigmer.permission.asked`-shaped ask and waits until answered.
// The state follows the fields (denied, failed, waiting, else completed)
// unless a test sets it.

import type { JsonObject } from "@bufbuild/protobuf";
import type {
  FileReviewFile,
  FileReviewSet,
  PermissionGrant,
  Thread,
  ToolAsk,
  ToolConfirmation,
  ToolFullOutput,
  ToolUse,
  ToolUseState,
  TurnItem,
} from "@stigmer/sdk";

/** When every fixture tool use starts. */
export const TOOL_STARTED_AT = "2026-08-13T10:00:00.000Z";

export interface ToolUseInit {
  readonly name: string;
  /** The call's id; defaults to `run_1.<name>`. */
  readonly id?: string;
  readonly runId?: string;
  readonly threadId?: string;
  readonly mcpServerName?: string;
  readonly input?: JsonObject;
  /** The result's text; omitted, the call has no result (it completed with no output unless `state` says otherwise). */
  readonly result?: string;
  readonly isError?: boolean;
  /** Overrides the state the other fields imply. */
  readonly state?: ToolUseState;
  /** How long after its start the result arrived. */
  readonly durationMs?: number;
  readonly ask?: Partial<ToolAsk>;
  readonly confirmation?: "allow" | "deny";
  readonly grant?: Partial<PermissionGrant>;
  readonly fullOutput?: Partial<ToolFullOutput>;
  readonly liveOutput?: string;
  readonly thread?: Thread;
}

/** A folded tool use from the fields a test cares about. */
export function toolUse(init: ToolUseInit): ToolUse {
  const id = init.id ?? `run_1.${init.name}`;
  const returned = init.result !== undefined || init.isError === true;
  const state: ToolUseState =
    init.state ??
    (init.confirmation === "deny"
      ? "denied"
      : init.isError
        ? "failed"
        : init.ask && !init.confirmation && !init.grant && !returned
          ? "waiting"
          : "completed");
  const finishedAt = new Date(Date.parse(TOOL_STARTED_AT) + (init.durationMs ?? 0)).toISOString();
  return {
    kind: "tool_use",
    id,
    runId: init.runId ?? "run_1",
    threadId: init.threadId ?? "",
    name: init.name,
    mcpServerName: init.mcpServerName ?? "",
    input: init.input ?? {},
    evaluatedPermission: init.ask ? "ask" : "",
    state,
    ask: init.ask
      ? {
          id: `${id}.ask`,
          message: "",
          argsPreview: "",
          policySource: "builtin_category",
          policyHook: "",
          processedAt: TOOL_STARTED_AT,
          ...init.ask,
        }
      : undefined,
    confirmation: init.confirmation ? confirmationOf(id, init.confirmation) : undefined,
    grant: init.grant
      ? {
          id: `${id}.grant`,
          scope: "turn",
          category: "",
          server: "",
          hook: undefined,
          tool: "",
          processedAt: TOOL_STARTED_AT,
          ...init.grant,
        }
      : undefined,
    result: returned
      ? { id: `${id}.r`, text: init.result ?? "", isError: init.isError ?? false, processedAt: finishedAt }
      : undefined,
    fullOutput: init.fullOutput
      ? {
          storageKey: "",
          sizeBytes: 0n,
          contentHash: "",
          mimeType: "",
          isImage: false,
          ...init.fullOutput,
        }
      : undefined,
    liveOutput: init.liveOutput ?? "",
    thread: init.thread,
    processedAt: TOOL_STARTED_AT,
  };
}

function confirmationOf(id: string, result: "allow" | "deny"): ToolConfirmation {
  return { id: `${id}.confirm`, result, denyMessage: "", processedAt: TOOL_STARTED_AT };
}

/** A subagent's thread. */
export function thread(init: Partial<Thread> & { readonly items?: ReadonlyArray<TurnItem> }): Thread {
  return {
    id: "run_1.task",
    agentName: "researcher",
    input: "",
    reply: "",
    state: "running",
    items: [],
    ...init,
  };
}

/** One file of a turn's review. */
export function reviewFile(init: Partial<FileReviewFile> & { readonly path: string }): FileReviewFile {
  return {
    fileChangeId: `fc-${init.path}`,
    previousPath: "",
    change: "modified",
    digest: `digest-${init.path}`,
    linesAdded: 0,
    linesRemoved: 0,
    reviewable: "complete",
    state: "undecided",
    decidedBy: "",
    ...init,
  };
}

/** A turn's file review; `undecided` follows its files unless given. */
export function reviewSet(init: Partial<FileReviewSet> & { readonly files: readonly FileReviewFile[] }): FileReviewSet {
  return {
    changeSetId: "cs-1",
    runId: "run_1",
    aggregateDigest: "agg-1",
    decisions: [],
    reconciles: [],
    undecided: init.files.some((file) => file.state === "undecided"),
    processedAt: TOOL_STARTED_AT,
    ...init,
  };
}
