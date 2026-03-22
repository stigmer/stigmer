import type { ReactNode } from "react";

export interface DefinitionBannerProps {
  /** Short analogy label rendered as a badge (e.g., "Docker image", "docker run") */
  analogy?: string;
  /** The definition text — typically one sentence */
  children: ReactNode;
}

/**
 * Page-level TL;DR that opens every concept doc. Renders the one-sentence
 * definition of a Stigmer resource with an optional analogy badge.
 *
 * Visually distinct from Fumadocs Callout — this is not a warning/info box,
 * it is the page's thesis statement.
 */
export function DefinitionBanner({
  analogy,
  children,
}: DefinitionBannerProps) {
  return (
    <aside
      role="note"
      className="not-prose relative my-6 overflow-hidden rounded-xl border border-fd-border bg-fd-card p-5 ps-7 text-fd-card-foreground shadow-md"
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 start-0 w-1 rounded-s-xl bg-accent"
      />
      {analogy ? (
        <span className="mb-3 inline-block rounded-full bg-accent/15 px-3 py-0.5 text-xs font-medium text-accent">
          {analogy}
        </span>
      ) : null}
      <p className="text-base/relaxed font-medium">{children}</p>
    </aside>
  );
}
