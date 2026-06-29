/**
 * Resume-time exact-apply for approved whole-file writes (Cursor deny-only HITL).
 *
 * THE GUARANTEE THIS RESTORES
 * ---------------------------
 * A user must get "what you approve is what gets applied" — the contract the
 * native LangGraph harness and Cursor's own IDE honor by pausing at the exact
 * tool call and applying its exact args on approval. The Cursor deny-only
 * harness cannot pause: it denies the tool, grants the RESOURCE (`write\n<path>`),
 * and reinvokes the model, which REGENERATES content from scratch. So the bytes
 * that land can differ from the bytes the gate showed (observed in production: a
 * gate previewing one edit, an applied file carrying more).
 *
 * The fix turns an approved WHOLE-FILE write into a runner-executed action: the
 * runner writes the EXACT approved bytes itself, marks the tool COMPLETED, and —
 * crucially — issues NO resource grant for it. Any FURTHER write the model makes
 * to that file on reinvocation is therefore re-gated, so the user sees and
 * approves every change. This module owns only the apply; the caller wires the
 * grant exclusion (so further writes re-gate) and the prompt split (so the model
 * is told the write is already applied and does not redo it).
 *
 * SCOPE — whole-file writes only. A hunk edit (`old_string`/`new_string`) is left
 * on the grant + reinvocation path: applying a hunk would require locating the
 * fragment in the file, which would make the runner a second source of truth for
 * the edit result (see shared/gate-file-change.ts). Shell/MCP grants are already
 * command-/name-specific, so their approved==applied property is already tight.
 *
 * SAFETY — exact-apply writes ONLY a fully-resolved body. It never writes a
 * truncated preview or the elision marker (which would silently corrupt the
 * file); an unresolvable body or any write failure degrades to the existing
 * grant + reinvocation path. Corruption is never an option — degradation to the
 * prior behavior is.
 */

import { isAbsolute, relative, resolve } from "node:path";
import {
  ApprovalAction,
  FileChangeCaptureLevel,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  AgentMessage,
  FileChange,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ArtifactStorage } from "../../shared/artifact-storage.js";
import { ELISION_MARKER } from "../../shared/status-offload.js";
import { extractWriteContent } from "../../shared/file-tools.js";
import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import { utcTimestamp } from "../../shared/status.js";

/** Options for {@link applyApprovedWholeFileWrites}. */
export interface ExactApplyOptions {
  /** The (seeded) transcript whose approved tool calls are applied in place. */
  readonly messages: AgentMessage[];
  /** Workspace the files live in (local FS for OSS, sandbox in cloud). */
  readonly workspaceBackend: WorkspaceBackend;
  /** Resolves offloaded `after` bodies; absent disables ref resolution. */
  readonly artifactStorage: ArtifactStorage | undefined;
  /** Configured workspace roots; a write is refused outside all of them. */
  readonly workspaceDirs: readonly string[];
  /** For structured logs. */
  readonly executionId: string;
}

/**
 * Apply every APPROVED whole-file write in `messages` to disk with its EXACT
 * approved bytes, marking each applied tool call COMPLETED in place.
 *
 * Returns the set of tool-call ids that were exact-applied, so the caller can
 * (a) exclude their resources from the approval grants — the key to re-gating a
 * later write — and (b) describe them as "already applied" in the reinvocation
 * prompt rather than asking the model to redo them.
 *
 * Idempotent: a call already COMPLETED (a Temporal activity retry re-runs this
 * phase) is skipped, never written twice. Every uncertain case (no resolvable
 * body, out-of-workspace target, write failure) is SKIPPED, leaving the call
 * WAITING_APPROVAL so the existing grant + reinvocation path handles it — the
 * conservative fallback that can never corrupt a file.
 */
export async function applyApprovedWholeFileWrites(
  opts: ExactApplyOptions,
): Promise<Set<string>> {
  const applied = new Set<string>();

  for (const msg of opts.messages) {
    for (const tc of msg.toolCalls) {
      if (!isApprovedWholeFileWrite(tc)) continue;

      const fc = tc.fileChanges[0];
      const target = fc.absolutePath;
      if (!target) {
        // The gate always records an absolutePath for a whole-file capture; a
        // missing one is unexpected — do not guess a path, fall back.
        logSkip(opts.executionId, tc, "no absolute path on the file change");
        continue;
      }
      if (!isWithinWorkspace(target, opts.workspaceDirs)) {
        logSkip(opts.executionId, tc, `target outside workspace: ${target}`);
        continue;
      }

      const content = await resolveApprovedWholeFileContent(
        tc,
        fc,
        opts.artifactStorage,
      );
      if (content === null) {
        logSkip(opts.executionId, tc, "exact approved bytes unresolvable");
        continue;
      }

      try {
        await opts.workspaceBackend.writeFile(target, content);
      } catch (err) {
        logSkip(
          opts.executionId,
          tc,
          `write failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      // The tool is now genuinely done: the runner applied exactly what the user
      // approved. Mark COMPLETED in place (same id — the backend's append-only-
      // at-identity guard accepts a status change) and keep its file_changes as
      // the authoritative record (applied == approved). The approval_action is
      // preserved as the audit trail; the status flip removes it from the
      // server's pending_approvals projection (which keys on WAITING_APPROVAL).
      tc.status = ToolCallStatus.TOOL_CALL_COMPLETED;
      if (!tc.completedAt) tc.completedAt = utcTimestamp();
      tc.error = "";
      applied.add(tc.id);
      console.log(
        `ExecuteCursor exact-apply: wrote approved bytes to ${target} ` +
          `(tool=${tc.id}); no resource grant issued, so a further change ` +
          `re-gates. execution=${opts.executionId}`,
      );
    }
  }

  return applied;
}

/**
 * The exact approved bytes for a whole-file write, or `null` when they cannot be
 * recovered (in which case the caller must fall back, never write).
 *
 * Resolution order, by reliability of "this is exactly what the user saw":
 *  1. inline `after` body — the rendered diff's after side (files under the
 *     128 KiB offload cap; the overwhelming common case);
 *  2. inline whole-file `args` content — present when `after` was offloaded but
 *     the structured args were not yet elided;
 *  3. offloaded `after` ref — fetched from artifact storage via a presigned URL,
 *     the same body the UI fetches to render the diff;
 *  4. otherwise `null`.
 *
 * It NEVER returns a truncated preview or the elision marker: those are lossy
 * stand-ins, and writing them would corrupt the file. The marker is only ever
 * found inline (placed by enforceStatusSizeLimit), so an inline value equal to
 * it is treated as unresolved; a ref's `truncatedPreview` is never read at all
 * (the ref branch fetches the full body).
 */
export async function resolveApprovedWholeFileContent(
  tc: ToolCall,
  fc: FileChange,
  artifactStorage: ArtifactStorage | undefined,
): Promise<string | null> {
  // 1. Inline after — the canonical "what was shown", unless it was elided.
  if (fc.after?.body.case === "inline") {
    const value = fc.after.body.value;
    if (value !== ELISION_MARKER) return value;
  }

  // 2. Inline whole-file args content (args is not offloaded; it is only dropped
  //    wholesale by the aggregate backstop, so when present it is intact).
  if (tc.args) {
    const argsContent = extractWriteContent(tc.args as Record<string, unknown>);
    if (argsContent !== null && argsContent !== ELISION_MARKER) return argsContent;
  }

  // 3. Offloaded after — fetch the full body from artifact storage. This is the
  //    same path the UI uses to render the diff, so it is exactly what was shown.
  if (fc.after?.body.case === "ref" && artifactStorage) {
    const ref = fc.after.body.value;
    try {
      const url = await artifactStorage.getDownloadUrl(ref.storageKey);
      const resp = await fetch(url);
      if (resp.ok) return await resp.text();
    } catch {
      // Fall through to null — the caller degrades to grant + reinvocation.
    }
  }

  return null;
}

/**
 * Whether `tc` is an approved, still-pending WHOLE-FILE write eligible for
 * exact-apply. APPROVE and APPROVE_ALL both approve the clicked tool (the latter
 * also leases the class, handled separately by the caller). A SKIP/REJECT, a
 * non-whole-file capture (a hunk edit), and an already-applied (COMPLETED) call
 * are all excluded.
 */
function isApprovedWholeFileWrite(tc: ToolCall): boolean {
  if (tc.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) return false;
  if (
    tc.approvalAction !== ApprovalAction.APPROVE &&
    tc.approvalAction !== ApprovalAction.APPROVE_ALL
  ) {
    return false;
  }
  const fc = tc.fileChanges[0];
  return (
    fc !== undefined &&
    fc.captureLevel === FileChangeCaptureLevel.WHOLE_FILE
  );
}

/** Whether `absTarget` resolves inside one of the configured workspace roots. */
function isWithinWorkspace(
  absTarget: string,
  workspaceDirs: readonly string[],
): boolean {
  const target = resolve(absTarget);
  return workspaceDirs.some((dir) => {
    const root = resolve(dir);
    if (target === root) return true;
    const rel = relative(root, target);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  });
}

function logSkip(executionId: string, tc: ToolCall, reason: string): void {
  console.log(
    `ExecuteCursor exact-apply skipped (falling back to grant+reinvocation): ` +
      `tool=${tc.id} reason="${reason}" execution=${executionId}`,
  );
}
