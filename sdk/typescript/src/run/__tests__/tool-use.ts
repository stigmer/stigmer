// A test helper: a folded tool use (`ToolUse`, @stigmer/session-log) from
// the row-shaped fields the tool-view tests and the shared fixtures under
// test/fixtures/tool-view/ are written in (name, mcpServerSlug, args,
// result, error, state, outputRef). A failed state reads as an error
// result carrying the error text (or the result); an output reference reads
// as the result's full-output location.

import type { JsonObject } from "@bufbuild/protobuf";
import type { ToolUse } from "@stigmer/session-log";

export interface ToolRowInit {
  /** The row's call id; the tool use's id is `run_1.<id>`. */
  readonly id?: string;
  readonly name?: string;
  readonly mcpServerSlug?: string;
  readonly args?: JsonObject;
  readonly result?: string;
  readonly error?: string;
  /** How the call ended: completed or failed; unset reads as completed once it has a result. */
  readonly status?: "completed" | "failed";
  readonly outputRef?: {
    readonly storageKey?: string;
    readonly sizeBytes?: bigint;
    readonly contentHash?: string;
    readonly mimeType?: string;
    readonly isImage?: boolean;
  };
}

export function toolUseOf(init: ToolRowInit): ToolUse {
  const failed = init.status === "failed";
  const text = failed ? init.error || init.result || "" : init.result ?? "";
  const returned = failed || init.status === "completed" || text !== "";
  return {
    kind: "tool_use",
    id: `run_1.${init.id ?? "call_1"}`,
    runId: "run_1",
    threadId: "",
    name: init.name ?? "",
    mcpServerName: init.mcpServerSlug ?? "",
    input: init.args ?? {},
    evaluatedPermission: "",
    state: failed ? "failed" : returned ? "completed" : "running",
    ask: undefined,
    confirmation: undefined,
    grant: undefined,
    result: returned ? { id: `run_1.${init.id ?? "call_1"}.r`, text, isError: failed, processedAt: "" } : undefined,
    fullOutput:
      init.outputRef === undefined
        ? undefined
        : {
            storageKey: init.outputRef.storageKey ?? "",
            sizeBytes: init.outputRef.sizeBytes ?? 0n,
            contentHash: init.outputRef.contentHash ?? "",
            mimeType: init.outputRef.mimeType ?? "",
            isImage: init.outputRef.isImage ?? false,
          },
    liveOutput: "",
    background: undefined,
    stoppedBackground: undefined,
    thread: undefined,
    processedAt: "",
  };
}
