// The recalled memories a turn was given, joined from its recall and the
// run's snapshot: pure, so the kit's headless entry can export it without
// reaching the line that draws them (RecalledMemoriesCard.tsx).

import type { RecalledMemoryFact } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import type { MemoryRecall } from "@stigmer/client";

/**
 * Resolve the recall's injected memory ids against the run's
 * snapshot facts, preserving snapshot order (the stable prompt order —
 * the selector re-sorts its subset the same way, so this join renders
 * the facts exactly as the agent saw them).
 *
 * The contract guarantees injected ids are a subset of the snapshot
 * (the merge path's never-invent pin), so an unknown id can only mean a
 * bug upstream — it is skipped, never invented. The summary count stays
 * the event's truth (`injectedMemoryIds.length`) regardless.
 */
export function resolveInjectedFacts(
  recall: MemoryRecall,
  facts: readonly RecalledMemoryFact[],
): RecalledMemoryFact[] {
  const injected = new Set(recall.injectedMemoryIds);
  return facts.filter((fact) => injected.has(fact.memoryId));
}
