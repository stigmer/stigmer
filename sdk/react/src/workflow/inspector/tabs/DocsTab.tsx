"use client";

import { memo } from "react";
import type { TaskKindDescriptor } from "../../types";

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
    <div className="flex flex-col gap-4 px-3 py-3">
      {descriptor.description && (
        <section className="flex flex-col gap-1">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--stgm-muted-foreground,#737373)]">
            Description
          </h4>
          <p className="text-xs leading-relaxed text-[var(--stgm-foreground,#1a1a2e)]">
            {descriptor.description}
          </p>
        </section>
      )}

      {hasExamples && (
        <section className="flex flex-col gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--stgm-muted-foreground,#737373)]">
            YAML examples
          </h4>
          {descriptor.yamlExamples!.map((example, i) => (
            <pre
              key={i}
              className="overflow-x-auto rounded-md border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-muted,#f5f5f5)] p-2 text-[11px] leading-relaxed text-[var(--stgm-foreground,#1a1a2e)]"
            >
              <code>{example}</code>
            </pre>
          ))}
        </section>
      )}

      {hasDocsUrl && (
        <section className="flex flex-col gap-1">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--stgm-muted-foreground,#737373)]">
            Documentation
          </h4>
          <a
            href={descriptor.documentationUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-[var(--stgm-primary,#6366f1)] hover:underline"
          >
            View full documentation →
          </a>
        </section>
      )}

      {!hasExamples && !hasDocsUrl && !descriptor.description && (
        <p className="text-xs text-[var(--stgm-muted-foreground,#737373)]">
          No documentation available for this task kind.
        </p>
      )}
    </div>
  );
});
