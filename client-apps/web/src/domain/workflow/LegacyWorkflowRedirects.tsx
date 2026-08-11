"use client";

import { useLegacyPathRedirect } from "@/domain/_shared/hooks/useLegacyPathRedirect";

const PLACEHOLDER = "__placeholder__";

// Target builders live at module level so the redirect effect runs once
// per mount (see useLegacyPathRedirect's contract).

/** `/workflows/[org]/[slug]` → `/library/workflows/[org]/[slug]` */
function workflowDetailTarget(segments: string[]): string | null {
  const org = segments[1];
  const slug = segments[2];
  if (!org || !slug || org === PLACEHOLDER || slug === PLACEHOLDER) {
    return null;
  }
  return `/library/workflows/${org}/${slug}`;
}

/** `/workflows/executions/[id]` → `/executions/[id]` */
function workflowExecutionTarget(segments: string[]): string | null {
  const id = segments[2];
  if (!id || id === PLACEHOLDER) return null;
  return `/executions/${id}`;
}

function RedirectingNotice() {
  return (
    <p className="px-6 py-8 text-sm text-muted-foreground">Redirecting…</p>
  );
}

/**
 * Legacy alias for workflow detail pages, kept alive for bookmarks from
 * the era when `/workflows` was the live zone (retired into `/library`).
 */
export function LegacyWorkflowDetailRedirect() {
  useLegacyPathRedirect(workflowDetailTarget);
  return <RedirectingNotice />;
}

/**
 * Legacy alias for workflow execution pages
 * (`/workflows/executions/[id]` predates the `/executions/[id]` zone).
 */
export function LegacyWorkflowExecutionRedirect() {
  useLegacyPathRedirect(workflowExecutionTarget);
  return <RedirectingNotice />;
}
