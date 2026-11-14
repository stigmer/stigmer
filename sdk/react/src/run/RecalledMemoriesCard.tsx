"use client";

import { memo, useMemo, useState } from "react";
import type { RecalledMemoryFact } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import type { MemoryRecall } from "@stigmer/client";
import { resolveInjectedFacts } from "./recalled-facts.js";
import { ThreadCardBody, ThreadCardHeader, ThreadCardShell } from "../internal/thread-card/ThreadCardShell.js";

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
 * (stigmer/stigmer#293 Phase 3's transparency promise). It leads with its
 * chevron, flush to the column, as a thought's line does; the model that
 * chose the facts stays on `MemoryRecall.embeddingModel` for a host that
 * wants to say it.
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
    <div role="status" aria-label={summary} className={className}>
      <ThreadCardShell variant="quiet">
        <ThreadCardHeader chevron="lead" gesture={{ kind: "expand", expanded, onToggle: () => setExpanded((prev) => !prev), label: summary }}>
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
          </ThreadCardBody>
        )}
      </ThreadCardShell>
    </div>
  );
});
