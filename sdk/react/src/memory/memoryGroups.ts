import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";

/** Memories bucketed by consent lifecycle, pending proposals first. */
export interface MemoryGroups {
  /** Awaiting the caller's decision — the catch-up queue. */
  readonly proposed: readonly Memory[];
  /** Confirmed facts, recalled into future sessions. */
  readonly confirmed: readonly Memory[];
  /** Rejected proposals, kept for audit until deleted. */
  readonly rejected: readonly Memory[];
}

/**
 * Buckets memories by lifecycle state for the pending-proposals-first
 * page layout (DD-005 D4: the memory page is the catch-up surface for
 * proposals scrolled past in session). Input order (newest first from
 * the server) is preserved inside each bucket.
 *
 * A record in the zero `unspecified` state should not exist (create
 * stamps `proposed`); it is bucketed with proposals so a decision
 * surface is always offered rather than hiding the record.
 */
export function groupMemoriesByLifecycle(
  memories: readonly Memory[],
): MemoryGroups {
  const proposed: Memory[] = [];
  const confirmed: Memory[] = [];
  const rejected: Memory[] = [];

  for (const memory of memories) {
    switch (memory.status?.lifecycleState) {
      case MemoryLifecycleState.lifecycle_state_confirmed:
        confirmed.push(memory);
        break;
      case MemoryLifecycleState.lifecycle_state_rejected:
        rejected.push(memory);
        break;
      default:
        proposed.push(memory);
        break;
    }
  }

  return { proposed, confirmed, rejected };
}

/**
 * One-line provenance attribution for a memory, or `null` when the
 * record has none (created directly through the API, not by an agent).
 *
 * Trust requires "where did this come from" beside every fact (DD-004);
 * agent/session display names are not resolvable from the record alone,
 * so ids are shown — they are what links back to the source surfaces.
 */
export function formatMemoryProvenance(memory: Memory): string | null {
  const provenance = memory.spec?.provenance;
  if (!provenance) return null;
  const parts: string[] = [];
  if (provenance.agentId) parts.push(`agent ${provenance.agentId}`);
  if (provenance.sessionId) parts.push(`session ${provenance.sessionId}`);
  if (parts.length === 0) return null;
  return `Proposed by ${parts.join(" in ")}`;
}
