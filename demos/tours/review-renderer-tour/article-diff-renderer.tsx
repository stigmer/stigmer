/**
 * The depicted custom renderer — the component an embedding app would
 * register for `ui_hint: article-diff`. Deliberately bespoke, tour-local
 * chrome: the guide's lesson is that this component belongs to the
 * integrator, not to Stigmer, so it must not read like an SDK surface.
 * Styled with `--stgm-*`-token utility classes like the rest of the demo
 * chrome (DD-003).
 *
 * Registered through the tour's providers (`.scenar/providers.tsx`), exactly
 * the `StigmerProvider` wiring the guide teaches.
 */
import type { ReviewRendererProps } from "@stigmer/react";
import { type ArticleRevision } from "../_shared/article-review";

export function ArticleDiffRenderer({
  payload,
  outcomes,
  submit,
  isSubmitting,
}: ReviewRendererProps) {
  const revision = payload as unknown as ArticleRevision;

  return (
    <div className="rounded-lg border border-border-prominent border-l-2 border-l-warning p-3">
      <p className="text-sm font-semibold text-foreground">{revision.articleTitle}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{revision.changeSummary}</p>

      <div className="mt-3 space-y-2">
        {revision.changes.map((change) => (
          <div key={change.section} className="rounded-md border border-border p-2">
            <p className="text-xs font-medium text-muted-foreground">{change.section}</p>
            <p className="mt-1 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-foreground line-through decoration-destructive/60">
              {change.before}
            </p>
            <p className="mt-1 rounded bg-success/10 px-1.5 py-0.5 text-xs text-foreground">
              {change.after}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        {outcomes.map((outcome, index) => (
          <button
            key={outcome.name}
            type="button"
            disabled={isSubmitting}
            onClick={() => void submit(outcome.name)}
            className={
              index === 0
                ? "rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
                : "rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            }
          >
            {outcome.label}
          </button>
        ))}
      </div>
    </div>
  );
}
