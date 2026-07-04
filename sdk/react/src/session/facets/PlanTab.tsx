"use client";

import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { cn } from "@stigmer/theme";
import {
  PLAN_DOCUMENT_MARKDOWN_COMPONENTS,
  REMARK_PLUGINS,
  extractLeadingH1,
  unwrapEnclosingMarkdownFence,
} from "../../internal/markdown-components.js";
import { useArtifactContent } from "../../execution/useArtifactContent.js";
import { useBuildFromPlanHotkey } from "../../execution/use-build-from-plan-hotkey.js";
import { formatArtifactSize } from "../../execution/artifact-utils.js";
import type { SessionPlan } from "../../library/detect-plan-artifact.js";
import type { PlanDraftController } from "../usePlanDraft.js";

/** Props for {@link PlanTab}. */
export interface PlanTabProps {
  /** The session's latest plan (from `findLatestSessionPlan`). */
  readonly plan: SessionPlan;
  /** Draft controller owned by the viewer (survives facet unmounts). */
  readonly draft: PlanDraftController;
  /** Builds from the plan — the same action as the thread card's primary. */
  readonly onBuildFromPlan?: () => void;
  /** Disables the Build action (execution in flight, or build submitting). */
  readonly buildDisabled?: boolean;
}

type PlanTabView = "rendered" | "source" | "edit";

/**
 * Plan facet for the session panel (a `useSessionRailViews` rail view): the
 * session's current plan as a reviewable, refinable document.
 *
 * Three views over one text:
 * - **Rendered** — the plan as a document (same typography as the thread's
 *   `PlanDocumentMessage`, title lifted from the leading H1).
 * - **Source** — the raw markdown.
 * - **Edit** — a plain-textarea editor over a LOCAL draft
 *   ({@link PlanDraftController}); the published artifact is never mutated.
 *   Building from an edited plan delivers the draft to the implement
 *   execution (edit-as-input).
 *
 * All three views show the *effective* plan — the draft when one exists, the
 * published artifact otherwise — so what the user reviews is exactly what
 * Build will implement. An "Edited" indicator plus Revert makes the overlay
 * visible and reversible.
 *
 * Editing is disabled for truncated content (the content RPC caps at 512 KB):
 * editing a truncated plan would silently drop its tail on handoff. The
 * document still renders read-only with the truncation notice.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export function PlanTab({
  plan,
  draft,
  onBuildFromPlan,
  buildDisabled,
}: PlanTabProps) {
  const [view, setView] = useState<PlanTabView>("rendered");
  const handleKeyDown = useBuildFromPlanHotkey(onBuildFromPlan, buildDisabled);

  const { content, isTruncated, isLoading, error, refetch } =
    useArtifactContent(
      plan.executionId,
      plan.artifact.storageKey,
      undefined,
      plan.artifact.contentHash,
    );

  const effectiveText = draft.draftText ?? content;

  if (isLoading) {
    return <PlanTabSkeleton />;
  }

  if (error || effectiveText === null) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
        <p className="text-xs text-muted-foreground">
          Couldn&rsquo;t load the plan{error ? `: ${error.message}` : "."}
        </p>
        <button
          type="button"
          onClick={refetch}
          className="rounded text-xs font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry
        </button>
      </div>
    );
  }

  const editDisabled = isTruncated && !draft.isEdited;

  return (
    <div className="flex flex-col gap-3" onKeyDown={handleKeyDown}>
      {/* Action bar: one prominent primary (Build), view tabs beneath. */}
      {onBuildFromPlan && (
        <button
          type="button"
          disabled={buildDisabled}
          onClick={onBuildFromPlan}
          className={cn(
            "inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2",
            "text-xs font-medium transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <ImplementIcon />
          {buildDisabled ? "Starting build…" : "Build from plan"}
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-md bg-muted p-0.5"
          role="tablist"
          aria-label="Plan view"
        >
          <ViewTab active={view === "rendered"} onClick={() => setView("rendered")} label="Rendered" />
          <ViewTab active={view === "source"} onClick={() => setView("source")} label="Source" />
          <ViewTab
            active={view === "edit"}
            onClick={() => setView("edit")}
            label="Edit"
            disabled={editDisabled}
            title={
              editDisabled
                ? "This plan is too large to edit in place — download it instead."
                : undefined
            }
          />
        </div>
        <span className="text-[0.65rem] tabular-nums text-muted-foreground-faint">
          {formatArtifactSize(plan.artifact.sizeBytes)}
        </span>
        {draft.isEdited && (
          <span className="ml-auto inline-flex items-center gap-2">
            <span className="rounded-md bg-accent px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
              Edited
            </span>
            <button
              type="button"
              onClick={() => draft.setDraft(null)}
              className="rounded text-[0.65rem] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Revert
            </button>
          </span>
        )}
      </div>

      {view === "rendered" && <RenderedPlan text={effectiveText} />}
      {view === "source" && (
        <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-foreground">
          {effectiveText}
        </pre>
      )}
      {view === "edit" && (
        <textarea
          value={effectiveText}
          onChange={(e) => draft.setDraft(e.target.value)}
          aria-label="Edit plan"
          spellCheck={false}
          rows={24}
          className={cn(
            "w-full resize-y rounded-md border border-border bg-card p-3",
            "font-mono text-xs leading-relaxed text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          )}
        />
      )}

      {isTruncated && (
        <p role="status" className="text-[0.65rem] text-muted-foreground">
          Preview truncated — download the artifact for the full plan.
        </p>
      )}
    </div>
  );
}

/**
 * The plan document: title lifted from the leading H1, body in the shared
 * plan-document typography — identical treatment to the thread's
 * `PlanDocumentMessage`, so the plan reads the same on every surface.
 */
function RenderedPlan({ text }: { readonly text: string }) {
  const { title, body } = useMemo(
    () => extractLeadingH1(unwrapEnclosingMarkdownFence(text, true)),
    [text],
  );

  return (
    <div className="overflow-hidden rounded-lg border border-border-muted bg-card">
      {title && (
        <header className="border-b border-border-muted bg-muted-faint px-3 py-2">
          <span className="text-sm font-semibold text-foreground">{title}</span>
        </header>
      )}
      <div className="stgm-prose px-3 py-3">
        <Markdown
          remarkPlugins={REMARK_PLUGINS}
          components={PLAN_DOCUMENT_MARKDOWN_COMPONENTS}
        >
          {body}
        </Markdown>
      </div>
    </div>
  );
}

function PlanTabSkeleton() {
  return (
    <div className="space-y-2 px-1 py-2" aria-hidden="true">
      <div className="h-8 w-full animate-pulse rounded-md bg-muted" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-4 w-full animate-pulse rounded bg-muted" />
      <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  label,
  disabled,
  title,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
  readonly disabled?: boolean;
  readonly title?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "rounded px-2 py-0.5 text-[0.65rem] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      {label}
    </button>
  );
}

function ImplementIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 6h8M7 3l3 3-3 3" />
    </svg>
  );
}
