"use client";

import { memo, useMemo, useState } from "react";
import type { RecalledMemoryFact } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import type { MemoryRecall } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { ThreadCardBody, ThreadCardHeader, ThreadCardShell } from "../internal/thread-card/ThreadCardShell.js";

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

/** Props for {@link RecalledMemoriesCard}. */
export interface RecalledMemoriesCardProps {
  /** Which memories the turn recalled, from the session's fold (`Turn.memory`). */
  readonly recall: MemoryRecall;
  /** The full candidate set from `spec.recalled_memories.facts`. */
  readonly facts: readonly RecalledMemoryFact[];
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * The semantic retriever's selection for one run, as a quiet line:
 * "Recalled 3 memories", opening on its rail to the facts the turn was given
 * (stigmer/stigmer#293 Phase 3's transparency promise) and the model that
 * chose them.
 *
 * Renders at the top of the run's {@link MessageThread} segment,
 * right after the user's turn — `spec.message` is the query the
 * retriever embedded, so the line reads as "for this message, these
 * memories were most relevant".
 *
 * Renders NOTHING unless the recall says selection was active: an
 * absent recall and `selectionActive=false` both mean wholesale (every
 * snapshot fact injected — the shipped Phase 2 behavior), and unchanged
 * behavior earns no UI noise. The same rule is applied by the thread
 * builder; it is repeated here so directly-embedding platform builders
 * get the correct contract by construction.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @see resolveInjectedFacts - the recall→snapshot join this line renders
 * @see SummarizationCard - the sibling quiet event
 */
export const RecalledMemoriesCard = memo(function RecalledMemoriesCard({
  recall,
  facts,
  className,
}: RecalledMemoriesCardProps) {
  const [expanded, setExpanded] = useState(false);
  const injectedFacts = useMemo(
    () => resolveInjectedFacts(recall, facts),
    [recall, facts],
  );

  if (!recall.selectionActive) return null;

  const injectedCount = recall.injectedMemoryIds.length;
  const summary = `Recalled ${injectedCount} ${injectedCount === 1 ? "memory" : "memories"}`;

  return (
    <div role="status" aria-label={summary} className={cn("stg:px-4", className)}>
      <ThreadCardShell variant="quiet">
        <ThreadCardHeader gesture={{ kind: "expand", expanded, onToggle: () => setExpanded((prev) => !prev), label: summary }}>
          <MemoryIcon />
          <span className="stg:min-w-0 stg:flex-1 stg:truncate stg:text-muted-foreground">{summary}</span>
        </ThreadCardHeader>
        {expanded && (
          <ThreadCardBody rail>
            <ul className="stg:m-0 stg:flex stg:list-none stg:flex-col stg:gap-2 stg:p-0">
              {injectedFacts.map((fact) => (
                <li key={fact.memoryId} className="stg:text-sm stg:text-muted-foreground">
                  {fact.content}
                </li>
              ))}
            </ul>
            {recall.embeddingModel && <p className="stg:mb-0 stg:mt-2 stg:text-xs stg:text-muted-foreground">Chosen by {recall.embeddingModel}</p>}
          </ThreadCardBody>
        )}
      </ThreadCardShell>
    </div>
  );
});

function MemoryIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:shrink-0 stg:text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M8 2a3 3 0 0 0-3 3c-1.2.4-2 1.5-2 2.8 0 1 .5 1.9 1.3 2.4A2.8 2.8 0 0 0 7 13.8c.4.1.7.2 1 .2s.6-.1 1-.2a2.8 2.8 0 0 0 2.7-3.6c.8-.5 1.3-1.4 1.3-2.4 0-1.3-.8-2.4-2-2.8a3 3 0 0 0-3-3z" />
      <path d="M8 2v12" />
    </svg>
  );
}
