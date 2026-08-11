"use client";

import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { cn } from "@stigmer/theme";
import {
  PLAN_DOCUMENT_MARKDOWN_COMPONENTS,
  REMARK_PLUGINS,
  extractLeadingH1,
  unwrapEnclosingMarkdownFence,
} from "../internal/markdown-components.js";
import { useArtifactContent } from "../execution/useArtifactContent.js";
import { useBuildFromPlanHotkey } from "../execution/use-build-from-plan-hotkey.js";
import { formatArtifactSize } from "../execution/artifact-utils.js";
import type { SessionPlan } from "../library/detect-plan-artifact.js";
import type { PlanDraftController } from "./usePlanDraft.js";

/** Props for {@link PlanEditor}. */
export interface PlanEditorProps {
  /** The plan to display (latest, or a superseded plan opened from its card). */
  readonly plan: SessionPlan;
  /**
   * Draft controller owned by the viewer (survives panel collapse/unmounts).
   * Consulted only when editable — a read-only (superseded) plan renders its
   * own artifact text, never the current plan's draft.
   */
  readonly draft?: PlanDraftController;
  /** Builds from the plan — the same action as the thread card's primary. */
  readonly onBuildFromPlan?: () => void;
  /** Disables the Build action (execution in flight, or build submitting). */
  readonly buildDisabled?: boolean;
  /**
   * Renders the plan as a historical, read-only document: no Edit view, no
   * Build action, and a "superseded" notice. Used when the user opens a plan
   * that a newer plan has since replaced.
   */
  readonly readOnly?: boolean;
}

type PlanEditorView = "rendered" | "source" | "edit";

/**
 * The plan document for the workspace surface's editor area — the wide-pane
 * successor of the retired Plan sidebar facet, mounted as a virtual document
 * (`SurfaceVirtualDocument`) under the {@link PLAN_DOCUMENT_ENTRY_ID} tab.
 *
 * Three views over one text:
 * - **Rendered** — the plan as a document (same typography as the thread's
 *   plan rendering, title lifted from the leading H1).
 * - **Source** — the raw markdown.
 * - **Edit** — a plain-textarea editor over a LOCAL draft
 *   ({@link PlanDraftController}); the published artifact is never mutated.
 *   Building from an edited plan delivers the draft to the implement
 *   execution (edit-as-input).
 *
 * All views show the *effective* plan — the draft when one exists, the
 * published artifact otherwise — so what the user reviews is exactly what
 * Build will implement. An "Edited" indicator plus Revert makes the overlay
 * visible and reversible.
 *
 * Editing is disabled for truncated content (the content RPC caps at 512 KB):
 * editing a truncated plan would silently drop its tail on handoff. The
 * document still renders read-only with the truncation notice.
 *
 * Holds no must-survive local state: the panel region unmounts wholesale on
 * collapse, so anything that must outlive it (the draft, the fetched content
 * cache) is owned above. The view pick resetting to Rendered on reopen is
 * deliberate.
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export function PlanEditor({
  plan,
  draft,
  onBuildFromPlan,
  buildDisabled,
  readOnly,
}: PlanEditorProps) {
  const [view, setView] = useState<PlanEditorView>("rendered");
  const canBuild = !readOnly && onBuildFromPlan !== undefined;
  const handleKeyDown = useBuildFromPlanHotkey(
    canBuild ? onBuildFromPlan : undefined,
    buildDisabled,
  );

  const { content, isTruncated, isLoading, error, refetch } =
    useArtifactContent(
      plan.executionId,
      plan.artifact.storageKey,
      undefined,
      plan.artifact.contentHash,
    );

  const activeDraft = readOnly ? undefined : draft;
  const effectiveText = activeDraft?.draftText ?? content;
  // A read-only plan (or one without a draft controller) never offers Edit;
  // a truncated plan only keeps it while an existing draft needs rescuing.
  const canEdit = activeDraft !== undefined && (!isTruncated || activeDraft.isEdited);
  const activeView: PlanEditorView = view === "edit" && !canEdit ? "rendered" : view;

  if (isLoading) {
    return (
      <PlanEditorFrame>
        <PlanEditorSkeleton />
      </PlanEditorFrame>
    );
  }

  if (error || effectiveText === null) {
    return (
      <PlanEditorFrame>
        <div className="stg:flex stg:flex-col stg:items-center stg:gap-2 stg:px-4 stg:py-8 stg:text-center">
          <p className="stg:text-xs stg:text-muted-foreground">
            Couldn&rsquo;t load the plan{error ? `: ${error.message}` : "."}
          </p>
          <button
            type="button"
            onClick={refetch}
            className="stg:rounded stg:text-xs stg:font-medium stg:text-foreground stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      </PlanEditorFrame>
    );
  }

  return (
    <PlanEditorFrame onKeyDown={handleKeyDown}>
      {/* Toolbar: view tabs lead; state + the one primary action trail.
          Narrow panes are first-class: rows wrap (flex-wrap) and every item
          can shrink (min-w-0 + truncating labels), so the toolbar reflows
          instead of forcing the document pane to scroll sideways. */}
      <div className="stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:gap-2">
        <div
          className="stg:inline-flex stg:shrink-0 stg:rounded-md stg:bg-muted stg:p-0.5"
          role="tablist"
          aria-label="Plan view"
        >
          <ViewTab
            active={activeView === "rendered"}
            onClick={() => setView("rendered")}
            label="Rendered"
          />
          <ViewTab
            active={activeView === "source"}
            onClick={() => setView("source")}
            label="Source"
          />
          {activeDraft !== undefined && (
            <ViewTab
              active={activeView === "edit"}
              onClick={() => setView("edit")}
              label="Edit"
              disabled={!canEdit}
              title={
                !canEdit
                  ? "This plan is too large to edit in place — download it instead."
                  : undefined
              }
            />
          )}
        </div>
        <span className="stg:text-[0.65rem] stg:tabular-nums stg:text-muted-foreground-faint">
          {formatArtifactSize(plan.artifact.sizeBytes)}
        </span>

        <div className="stg:ml-auto stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:gap-3">
          {activeDraft?.isEdited && (
            <span className="stg:inline-flex stg:items-center stg:gap-2">
              <span className="stg:rounded-md stg:bg-accent stg:px-1.5 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground">
                Edited
              </span>
              <button
                type="button"
                onClick={() => activeDraft.setDraft(null)}
                className="stg:rounded stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground stg:underline-offset-2 stg:hover:text-foreground stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
              >
                Revert
              </button>
            </span>
          )}
          {readOnly ? (
            <span
              role="status"
              className="stg:rounded-md stg:bg-muted stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground"
            >
              Superseded by a newer plan
            </span>
          ) : (
            onBuildFromPlan && (
              <button
                type="button"
                disabled={buildDisabled}
                onClick={onBuildFromPlan}
                className={cn(
                  "stg:inline-flex stg:min-w-0 stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5",
                  "stg:text-xs stg:font-medium stg:transition-colors",
                  "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                )}
              >
                <ImplementIcon />
                <span className="stg:truncate">
                  {buildDisabled ? "Starting build…" : "Build"}
                </span>
              </button>
            )
          )}
        </div>
      </div>

      {activeView === "rendered" && <RenderedPlan text={effectiveText} />}
      {activeView === "source" && (
        <pre className="stg:overflow-x-auto stg:rounded-md stg:bg-muted stg:p-3 stg:font-mono stg:text-xs stg:whitespace-pre-wrap stg:text-foreground">
          {effectiveText}
        </pre>
      )}
      {activeView === "edit" && activeDraft !== undefined && (
        <textarea
          value={effectiveText}
          onChange={(e) => activeDraft.setDraft(e.target.value)}
          aria-label="Edit plan"
          spellCheck={false}
          rows={28}
          className={cn(
            "stg:w-full stg:flex-1 stg:resize-y stg:rounded-md stg:border stg:border-border stg:bg-card stg:p-3",
            "stg:font-mono stg:text-xs stg:leading-relaxed stg:text-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          )}
        />
      )}

      {isTruncated && (
        <p role="status" className="stg:text-[0.65rem] stg:text-muted-foreground">
          Preview truncated — download the artifact for the full plan.
        </p>
      )}
    </PlanEditorFrame>
  );
}

/**
 * The editor-area envelope: a centered document column so the plan reads as a
 * page rather than stretching across the full pane width.
 */
function PlanEditorFrame({
  children,
  onKeyDown,
}: {
  readonly children: React.ReactNode;
  readonly onKeyDown?: React.KeyboardEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      role="article"
      aria-label="Plan document"
      onKeyDown={onKeyDown}
      className="stg:mx-auto stg:flex stg:w-full stg:max-w-3xl stg:flex-col stg:gap-3 stg:px-4 stg:py-3"
    >
      {children}
    </div>
  );
}

/**
 * The plan document: title lifted from the leading H1, body in the shared
 * plan-document typography — identical treatment to the thread's plan
 * rendering, so the plan reads the same on every surface.
 */
function RenderedPlan({ text }: { readonly text: string }) {
  const { title, body } = useMemo(
    () => extractLeadingH1(unwrapEnclosingMarkdownFence(text, true)),
    [text],
  );

  return (
    <div className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border-muted stg:bg-card">
      {title && (
        <header className="stg:border-b stg:border-border-muted stg:bg-muted-faint stg:px-4 stg:py-2.5">
          <span className="stg:block stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">
            {title}
          </span>
        </header>
      )}
      <div className="stgm-prose stg:px-4 stg:py-4">
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

function PlanEditorSkeleton() {
  return (
    <div className="stg:space-y-2 stg:py-2" aria-hidden="true">
      <div className="stg:h-8 stg:w-full stg:animate-pulse stg:rounded-md stg:bg-muted" />
      <div className="stg:h-4 stg:w-2/3 stg:animate-pulse stg:rounded stg:bg-muted" />
      <div className="stg:h-4 stg:w-full stg:animate-pulse stg:rounded stg:bg-muted" />
      <div className="stg:h-4 stg:w-5/6 stg:animate-pulse stg:rounded stg:bg-muted" />
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
        "stg:rounded stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:transition-colors",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        active
          ? "stg:bg-card stg:text-foreground stg:shadow-sm"
          : "stg:text-muted-foreground stg:hover:text-foreground",
        "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
