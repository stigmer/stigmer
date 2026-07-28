/**
 * The depicted review gate: one editorial revision, reviewed on two surfaces.
 *
 * `docs/guides/workflows/review-payloads.mdx` places two stills thirty lines
 * apart — `review-renderer-tour` (a surface that registered an `article-diff`
 * renderer) and `review-fallback-tour` (a surface with none) — and its prose
 * promises they show "the same gate — same payload, same `ui_hint`". This
 * module owns that identity as settled state so the promise holds by
 * construction: both tours import the gate's task name, hint, outcomes, and
 * payload from here and cannot build a drifted variant. (Same taxonomy as
 * `order-management-mcp.ts` — a depicted resource with more than one
 * consumer lives in `_shared/`.)
 *
 * The identity trio (`TASK_NAME`, `UI_HINT`, the two outcomes) also matches
 * the workflow YAML printed on that docs page — change one side only with
 * the other in hand.
 *
 * Pure data, importable from `steps.ts` under plain Node (the narrate/gate
 * import discipline): no React, no component packages.
 */

/** The gate's task name — matches the docs page's workflow YAML. */
export const TASK_NAME = "editorial_review";

/** The renderer discriminator — matches the docs page's workflow YAML. */
export const UI_HINT = "article-diff";

/** The reviewer-facing prompt from the task config. */
export const REVIEW_PROMPT = "Review the proposed revision before publishing.";

/** Configured outcomes — match the docs page's workflow YAML. */
export const OUTCOMES = [
  { name: "approve", label: "Approve" },
  { name: "request_changes", label: "Request changes" },
] as const;

/**
 * The resolved review payload — the material under review, exactly what the
 * runtime attached to the gate's `approval_requested` event. The dates in the
 * article copy are displayed prose, not fixture instants.
 */
export const REVIEW_PAYLOAD = {
  articleTitle: "Introducing Stigmer Workflows",
  changeSummary: "Corrects the launch date and strengthens the durability claim.",
  changes: [
    {
      section: "Introduction",
      before: "Stigmer Workflows launch in early 2027.",
      after: "Stigmer Workflows launch in November 2026.",
    },
    {
      section: "Execution model",
      before: "Every step runs on a best-effort basis.",
      after: "Every step runs with durable, resumable execution.",
    },
  ],
};

/** The payload's shape, for the renderer that presents it. */
export type ArticleRevision = typeof REVIEW_PAYLOAD;
