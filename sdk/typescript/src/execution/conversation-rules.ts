// Framework-agnostic conversation-assembly rules for every Stigmer surface.
//
// A session's conversation is reassembled from its AgentExecution list by
// several independent consumers: the React thread (@stigmer/react
// buildThreadItems / useSessionConversation), the CLI's session replay
// (snapshotToEvents), and the canonical transcript assembler (transcript.ts).
// Before this module each consumer carried its own copy of the same small
// rules, and the copies had already drifted (the CLI's replay lacks the
// Build-from-plan skip). These are the shared, canonical rules; presentation
// concerns (plan cards, todos anchoring, event interleaving) stay in the
// consumers.
//
// This module has no React or framework dependency so it can be shared by
// @stigmer/react, @stigmer/ink, and the CLI.

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

/**
 * Returns the executions in chronological (oldest-first) order — the order a
 * conversation reads top-to-bottom.
 *
 * Defense-in-depth against an unordered list response: the executions ARE the
 * transcript, so a scrambled order drops the newest turns out of view (they no
 * longer sort to the bottom). The server orders this list, but consumers must
 * never depend on that alone. Resource ids are time-sortable ULIDs
 * (`aex_01k…`), so an ascending id sort is creation order without parsing
 * timestamps; entries missing an id sort last but keep a stable relative order.
 */
export function sortChronologically(
  executions: readonly AgentExecution[],
): AgentExecution[] {
  return [...executions].sort((a, b) => {
    const aId = a.metadata?.id ?? "";
    const bId = b.metadata?.id ?? "";
    if (aId === bId) return 0;
    if (!aId) return 1;
    if (!bId) return -1;
    return aId < bId ? -1 : 1;
  });
}

/**
 * Collects the ids of executions replaced via edit-and-resubmit.
 *
 * The successor execution carries `spec.supersedes_execution_id`; hiding the
 * superseded turn makes the edited message read as a single corrected exchange
 * (in-place replace). The raw execution list still contains superseded records
 * — execution-history surfaces show them deliberately — so this is a
 * conversation-view rule, applied by whoever renders or exports a
 * conversation.
 *
 * @param extraSupersededId An id known only outside the list — the live stream
 * copy's `supersedesExecutionId`: right after a resubmit, the successor
 * streams before the list refetch delivers it.
 */
export function supersededExecutionIds(
  executions: readonly AgentExecution[],
  extraSupersededId?: string | null,
): Set<string> {
  const ids = new Set<string>();
  for (const e of executions) {
    const superseded = e.spec?.supersedesExecutionId;
    if (superseded) ids.add(superseded);
  }
  if (extraSupersededId) ids.add(extraSupersededId);
  return ids;
}

/**
 * `true` when the execution is a Build-from-plan turn.
 *
 * Such a turn's `spec.message` is a machine-written label ("Build from
 * plan"), not user prose — the real instruction is runner-injected from the
 * same flag. Rendering or exporting the label as a user message would
 * attribute words to the user they never typed; the plan the turn builds from
 * is the visible cause.
 */
export function isBuildFromPlanTurn(exec: AgentExecution): boolean {
  return exec.spec?.executionConfig?.buildFromPlan === true;
}

/**
 * The user prose that opens an execution's turn, or `null` when the turn has
 * none.
 *
 * `spec.message` is the submitted prompt, but three shapes of it are not user
 * prose and synthesize no user turn:
 *  - empty — nothing was typed (programmatic creates);
 *  - the literal `"execute"` — the legacy placeholder stamped on runs started
 *    without a message;
 *  - a Build-from-plan turn's machine-written label (see
 *    {@link isBuildFromPlanTurn}).
 */
export function syntheticUserPrompt(exec: AgentExecution): string | null {
  const specMessage = exec.spec?.message;
  if (!specMessage || specMessage === "execute" || isBuildFromPlanTurn(exec)) {
    return null;
  }
  return specMessage;
}

/**
 * Extracts the execution id from an artifact storage key of the form
 * `artifacts/{executionId}/...`. Returns `null` for an unexpected shape so the
 * caller skips the fetch rather than issuing a request the server would
 * reject.
 *
 * The fetch id must always derive from the key, never from render or export
 * context: offloaded outputs inside a sub-agent's transcript are stored under
 * the PARENT execution's id (the execution whose status was persisted), and
 * the key is the record of that.
 */
export function execIdFromStorageKey(storageKey: string): string | null {
  const parts = storageKey.split("/");
  if (parts.length >= 3 && parts[0] === "artifacts" && parts[1]) {
    return parts[1];
  }
  return null;
}
