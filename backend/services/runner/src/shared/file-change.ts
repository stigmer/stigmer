/**
 * Pure constructor for `FileChange` / `FileContent` protos, shared by the native
 * (deepagents) and Cursor harnesses.
 *
 * Deliberately dependency-free and side-effect-free: it does NO file IO and NO
 * diff computation. Each harness supplies only what its source authoritatively
 * provides — native supplies whole-file before/after; Cursor supplies the SDK's
 * `unified_diff` + line counts — and everything derivable (a unified diff for a
 * WHOLE_FILE capture, line counts for native) is left to the single diff
 * implementation in the presentation layer. `capture_level` tells consumers
 * which rendering to use.
 *
 * @since First-Class Diff Review (#186)
 */

import { isAbsolute, join, relative } from "node:path";
import { create } from "@bufbuild/protobuf";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  FileChangeSchema,
  FileContentSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  FileChangeType,
  FileChangeCaptureLevel,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * Normalized input for a single file mutation. `before`/`after` are raw inline
 * bodies; offloading oversized bodies to a `ToolCallOutputRef` happens later at
 * the persist chokepoint (status-offload.ts), not here.
 *
 * A `before`/`after` of `undefined` omits that side entirely (e.g. no `before`
 * for a CREATE, no `after` for a DELETE). An empty string is a real value (an
 * empty file) and is preserved.
 */
export interface FileChangeInput {
  /** Workspace-root-relative display path (see {@link resolveWorkspacePath}). */
  readonly path: string;
  /** Absolute on-disk path. */
  readonly absolutePath: string;
  readonly changeType: FileChangeType;
  readonly captureLevel: FileChangeCaptureLevel;
  /** Pre-edit inline content (WHOLE_FILE). Omit for CREATE / HUNK_ONLY. */
  readonly before?: string;
  /** Post-edit inline content (WHOLE_FILE). Omit for DELETE / HUNK_ONLY. */
  readonly after?: string;
  /** Hunk-level unified diff (HUNK_ONLY) or a source-provided diff. */
  readonly unifiedDiff?: string;
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
  /** Source path for RENAME; `path` holds the destination. */
  readonly renameFrom?: string;
}

/**
 * Heuristic binary detection: a NUL byte never appears in valid UTF-8 text. This
 * is a safety net, not a feature — the native edit/write tools are string-based,
 * so captured content is text in practice.
 */
export function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

/**
 * Byte-level binary detection: a NUL byte never appears in valid UTF-8 text. The
 * single definition of "binary" shared by every substrate that reads raw bytes
 * (the git substrate's blob reads and the CAS substrate's captured bodies), so
 * "what is binary" is decided one way across the whole file-review subsystem.
 *
 * Prefer this over {@link looksBinary} whenever the raw bytes are in hand: it is
 * exact, whereas scanning a UTF-8-decoded string can miss a NUL that a lossy
 * decode dropped.
 */
export function bytesLookBinary(bytes: Uint8Array): boolean {
  return bytes.includes(0);
}

/** Build a `FileContent` carrying an inline body. */
function inlineFileContent(content: string) {
  return create(FileContentSchema, {
    body: { case: "inline", value: content },
    isBinary: looksBinary(content),
  });
}

/** Build a `FileChange` proto from already-resolved, harness-agnostic input. */
export function buildFileChange(input: FileChangeInput): FileChange {
  const fc = create(FileChangeSchema, {
    path: input.path,
    absolutePath: input.absolutePath,
    changeType: input.changeType,
    captureLevel: input.captureLevel,
    unifiedDiff: input.unifiedDiff ?? "",
    linesAdded: input.linesAdded ?? 0,
    linesRemoved: input.linesRemoved ?? 0,
    renameFrom: input.renameFrom ?? "",
  });
  if (input.before !== undefined) {
    fc.before = inlineFileContent(input.before);
  }
  if (input.after !== undefined) {
    fc.after = inlineFileContent(input.after);
  }
  return fc;
}

/**
 * Derive the workspace-root-relative display path and the absolute on-disk path
 * for a file a tool touched.
 *
 * `virtualRoot` distinguishes the two harness path conventions:
 *  - native (deepagents) addresses files against a virtual root where a leading
 *    "/" denotes the workspace root — mirrors `InlinePublisher.normalizePath`;
 *  - Cursor passes real filesystem paths that may be absolute.
 *
 * A path that is absolute but outside `rootDir` is displayed as-is (we never
 * surface an escaping `../../` relative path).
 */
export function resolveWorkspacePath(
  rawPath: string,
  rootDir: string,
  virtualRoot: boolean,
): { path: string; absolutePath: string } {
  if (virtualRoot || !isAbsolute(rawPath)) {
    const rel = rawPath.replace(/^\/+/, "").replace(/^\.\//, "");
    return { path: rel, absolutePath: join(rootDir, rel) };
  }
  const rel = relative(rootDir, rawPath);
  if (rel && !rel.startsWith("..") && !isAbsolute(rel)) {
    return { path: rel, absolutePath: rawPath };
  }
  return { path: rawPath, absolutePath: rawPath };
}

/**
 * Attach `changes` to the `ToolCall` whose `id` matches `toolCallId`, searching
 * the shared status proto from the end (the just-finished call is the most
 * recent). Returns true when a call was found and updated.
 *
 * Used by both the v2 and v3 status builders: both share the same proto and set
 * `ToolCall.id` to the id available at the streaming dispatch site (v3 `callId`,
 * v2 `run_id`), so a single proto-level search is harness-agnostic.
 */
export function attachFileChangesToStatus(
  status: AgentExecutionStatus,
  toolCallId: string,
  changes: FileChange[],
): boolean {
  for (let i = status.messages.length - 1; i >= 0; i--) {
    const toolCalls = status.messages[i].toolCalls;
    for (let j = toolCalls.length - 1; j >= 0; j--) {
      if (toolCalls[j].id === toolCallId) {
        toolCalls[j].fileChanges = changes;
        return true;
      }
    }
  }
  return false;
}
