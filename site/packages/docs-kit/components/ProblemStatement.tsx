import type { ReactNode } from "react";

export interface ProblemStatementProps {
  /** The problem narrative — prose, code blocks, and consequence bullets */
  children: ReactNode;
}

/**
 * Visual container for the "what goes wrong" problem section on concept pages.
 * Wraps arbitrary MDX content (narrative, code blocks, consequence bullets)
 * in a distinct container that signals "this is the problem" to scanning readers.
 *
 * The section heading belongs in MDX (`## The problem X solves`) so it appears
 * in the Fumadocs table of contents. This component renders only the content
 * beneath the heading.
 *
 * Uses fd-muted-foreground for the left bar (vs DefinitionBanner's accent)
 * and a subtle muted background to differentiate from the thesis statement.
 */
export function ProblemStatement({ children }: ProblemStatementProps) {
  return (
    <section className="relative my-6 overflow-hidden rounded-xl border border-fd-border bg-fd-muted/30 p-5 ps-7 [&_ul>li]:marker:text-fd-muted-foreground">
      <div
        aria-hidden="true"
        className="absolute inset-y-0 start-0 w-1 rounded-s-xl bg-fd-muted-foreground"
      />
      {children}
    </section>
  );
}
