"use client";

import { memo, useId, useMemo, useState } from "react";
import type { RecalledMemoriesReport } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { RecalledMemoryFact } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import { cn } from "@stigmer/theme";

/**
 * Resolve the report's injected memory ids against the execution's
 * snapshot facts, preserving snapshot order (the stable prompt order —
 * the selector re-sorts its subset the same way, so this join renders
 * the facts exactly as the agent saw them).
 *
 * The contract guarantees injected ids are a subset of the snapshot
 * (the merge path's never-invent pin), so an unknown id can only mean a
 * bug upstream — it is skipped, never invented. The summary count stays
 * the wire truth (`injectedMemoryIds.length`) regardless.
 */
export function resolveInjectedFacts(
  report: RecalledMemoriesReport,
  facts: readonly RecalledMemoryFact[],
): RecalledMemoryFact[] {
  const injected = new Set(report.injectedMemoryIds);
  return facts.filter((fact) => injected.has(fact.memoryId));
}

/** Props for {@link RecalledMemoriesCard}. */
export interface RecalledMemoriesCardProps {
  /** The runner's injection report from the execution's status. */
  readonly report: RecalledMemoriesReport;
  /** The full candidate set from `spec.recalled_memories.facts`. */
  readonly facts: readonly RecalledMemoryFact[];
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Inline timeline card disclosing the semantic retriever's selection for
 * one execution: "Recalled N of M memories", expandable to the injected
 * facts (stigmer/stigmer#293 Phase 3a, DD-008 D5's transparency promise).
 *
 * Renders at the top of the execution's {@link MessageThread} segment,
 * right after the user's turn — `spec.message` is the query the
 * retriever embedded, so the card reads as "for this message, these
 * memories were most relevant".
 *
 * Renders NOTHING unless the report says selection was active: an
 * absent report and `selection_active=false` both mean wholesale (every
 * snapshot fact injected — the shipped Phase 2 behavior), and unchanged
 * behavior earns no UI noise. The same rule is applied by the thread
 * builder; it is repeated here so directly-embedding platform builders
 * get the correct contract by construction.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @see resolveInjectedFacts - the report→snapshot join this card renders
 * @see SummarizationCard - the sibling system-event card this follows
 */
export const RecalledMemoriesCard = memo(function RecalledMemoriesCard({
  report,
  facts,
  className,
}: RecalledMemoriesCardProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  const injectedFacts = useMemo(
    () => resolveInjectedFacts(report, facts),
    [report, facts],
  );

  if (!report.selectionActive) return null;

  const injectedCount = report.injectedMemoryIds.length;
  const summary = `Recalled ${injectedCount} of ${facts.length} memories`;

  return (
    <div
      role="status"
      aria-label={summary}
      className={cn(
        "stg:mx-4 stg:rounded-md stg:border stg:border-border/50 stg:bg-muted/30",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((prev) => !prev)}
        className={cn(
          "stg:flex stg:w-full stg:items-center stg:gap-3 stg:px-3 stg:py-2 stg:text-left",
          "stg:text-xs stg:text-muted-foreground hover:stg:text-foreground",
        )}
      >
        <MemoryIcon />
        <span className="stg:flex stg:min-w-0 stg:flex-1 stg:flex-wrap stg:items-baseline stg:gap-x-2">
          <span className="stg:font-medium">{summary}</span>
          {report.embeddingModel && (
            <>
              <span aria-hidden="true" className="stg:text-muted-foreground/50">&middot;</span>
              <span className="stg:text-muted-foreground/80">{report.embeddingModel}</span>
            </>
          )}
        </span>
        <ChevronIcon expanded={expanded} />
      </button>
      {expanded && (
        <ul
          id={listId}
          className="stg:m-0 stg:flex stg:list-none stg:flex-col stg:gap-1.5 stg:border-t stg:border-border/50 stg:px-3 stg:py-2"
        >
          {injectedFacts.map((fact) => (
            <li
              key={fact.memoryId}
              className="stg:text-xs stg:leading-relaxed stg:text-muted-foreground"
            >
              {fact.content}
            </li>
          ))}
        </ul>
      )}
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
      className="stg:shrink-0 stg:text-muted-foreground/70"
      aria-hidden="true"
    >
      <path d="M8 2a3 3 0 0 0-3 3c-1.2.4-2 1.5-2 2.8 0 1 .5 1.9 1.3 2.4A2.8 2.8 0 0 0 7 13.8c.4.1.7.2 1 .2s.6-.1 1-.2a2.8 2.8 0 0 0 2.7-3.6c.8-.5 1.3-1.4 1.3-2.4 0-1.3-.8-2.4-2-2.8a3 3 0 0 0-3-3z" />
      <path d="M8 2v12" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:shrink-0 stg:text-muted-foreground/70"
      aria-hidden="true"
    >
      {expanded ? <path d="M4 10l4-4 4 4" /> : <path d="M4 6l4 4 4-4" />}
    </svg>
  );
}
