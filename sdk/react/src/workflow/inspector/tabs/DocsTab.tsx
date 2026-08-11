"use client";

import { memo } from "react";
import type { TaskKindDescriptor } from "../../types.js";

/** Props for {@link DocsTab}. */
export interface DocsTabProps {
  readonly descriptor: TaskKindDescriptor;
}

/**
 * Docs tab — YAML examples and documentation link for the selected task kind.
 *
 * Shows YAML usage examples from the task kind registry and a link to the
 * full documentation page when available.
 *
 * @since T10 (Inspector Panel Refactor)
 */
export const DocsTab = memo(function DocsTab({ descriptor }: DocsTabProps) {
  const hasExamples = descriptor.yamlExamples && descriptor.yamlExamples.length > 0;
  const hasDocsUrl = !!descriptor.documentationUrl;

  return (
    <div className="stg:flex stg:flex-col stg:gap-4 stg:px-3 stg:py-3">
      {descriptor.description && (
        <section className="stg:flex stg:flex-col stg:gap-1">
          <h4 className="stg:text-[11px] stg:font-semibold stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
            Description
          </h4>
          <p className="stg:text-xs stg:leading-relaxed stg:text-[var(--stgm-foreground,#1a1a2e)]">
            {descriptor.description}
          </p>
        </section>
      )}

      {hasExamples && (
        <section className="stg:flex stg:flex-col stg:gap-2">
          <h4 className="stg:text-[11px] stg:font-semibold stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
            YAML examples
          </h4>
          {descriptor.yamlExamples!.map((example, i) => (
            <pre
              key={i}
              className="stg:overflow-x-auto stg:rounded-md stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-muted,#f5f5f5)] stg:p-2 stg:text-[11px] stg:leading-relaxed stg:text-[var(--stgm-foreground,#1a1a2e)]"
            >
              <code>{example}</code>
            </pre>
          ))}
        </section>
      )}

      {hasDocsUrl && (
        <section className="stg:flex stg:flex-col stg:gap-1">
          <h4 className="stg:text-[11px] stg:font-semibold stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
            Documentation
          </h4>
          <a
            href={descriptor.documentationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="stg:text-xs stg:font-medium stg:text-[var(--stgm-primary,#6366f1)] stg:hover:underline"
          >
            View full documentation →
          </a>
        </section>
      )}

      {!hasExamples && !hasDocsUrl && !descriptor.description && (
        <p className="stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
          No documentation available for this task kind.
        </p>
      )}
    </div>
  );
});
