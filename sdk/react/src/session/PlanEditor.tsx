"use client";

import { useMemo, useState } from "react";
import Markdown from "react-markdown";
import { cn } from "@stigmer/design-tokens";
import {
  PLAN_DOCUMENT_MARKDOWN_COMPONENTS,
  REMARK_PLUGINS,
  extractLeadingH1,
  unwrapEnclosingMarkdownFence,
} from "../internal/markdown-components.js";
import { Button } from "../button/Button.js";
import { StatusBadge } from "../status/StatusBadge.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Notice } from "../internal/surface/Notice.js";
import { useFileContent } from "../file/useFileContent.js";
import { useBuildFromPlanHotkey } from "../run/use-build-from-plan-hotkey.js";
import type { SessionPlan } from "../library/detect-plan-file.js";
import type { PlanDraftController } from "./usePlanDraft.js";
import { PlanCardHeader, planSubline } from "../run/PlanCard.js";

/** Props for {@link PlanEditor}. */
export interface PlanEditorProps {
  /** The plan to display (latest, or a superseded plan opened from its card). */
  readonly plan: SessionPlan;
  /**
   * Draft controller owned by the viewer (survives panel collapse/unmounts).
   * Consulted only when editable — a read-only (superseded) plan renders its
   * own text, never the current plan's draft.
   */
  readonly draft?: PlanDraftController;
  /** Builds from the plan — the same action as the thread card's primary. */
  readonly onBuildFromPlan?: () => void;
  /** Disables the Build action (run in flight, or build submitting). */
  readonly buildDisabled?: boolean;
  /**
   * Renders the plan as a historical, read-only document: no Edit view, no
   * Build action, and a header that says "Replaced by a newer plan". Used
   * when the user opens a plan that a newer plan has since replaced.
   */
  readonly readOnly?: boolean;
}

type PlanEditorView = "rendered" | "source" | "edit";

/**
 * The plan document for the workspace surface's editor area — the wide-pane
 * successor of the retired Plan sidebar facet, mounted as a virtual document
 * (`SurfaceVirtualDocument`) under the {@link PLAN_DOCUMENT_ENTRY_ID} tab.
 *
 * The header is the thread's plan card header: the list glyph, the plan's
 * title (lifted from the leading H1, else "Plan") over "Plan · 4.1 KB", or
 * "Replaced by a newer plan" for a read-only plan, with Edited, Revert and
 * Build at the right.
 *
 * Three views over one text:
 * - **Rendered** — the plan as a document (same typography as the thread's
 *   plan rendering, its title in the header).
 * - **Source** — the raw markdown.
 * - **Edit** — a plain-textarea editor over a LOCAL draft
 *   ({@link PlanDraftController}); the plan File is never mutated.
 *   Building from an edited plan delivers the draft to the implement
 *   run (edit-as-input).
 *
 * All views show the *effective* plan — the draft when one exists, the
 * plan File otherwise — so what the user reviews is exactly what
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
    useFileContent(plan.file.metadata?.id ?? null);

  const activeDraft = readOnly ? undefined : draft;
  const effectiveText = activeDraft?.draftText ?? content;
  // A read-only plan (or one without a draft controller) never offers Edit;
  // a truncated plan only keeps it while an existing draft needs rescuing.
  const canEdit = activeDraft !== undefined && (!isTruncated || activeDraft.isEdited);
  const activeView: PlanEditorView = view === "edit" && !canEdit ? "rendered" : view;
  const parsed = useMemo(
    () => (effectiveText === null ? null : extractLeadingH1(unwrapEnclosingMarkdownFence(effectiveText, true))),
    [effectiveText],
  );

  if (isLoading) {
    return (
      <PlanEditorFrame>
        <PlanEditorSkeleton />
      </PlanEditorFrame>
    );
  }

  if (error || effectiveText === null || parsed === null) {
    return (
      <PlanEditorFrame>
        <div className="stg:px-4 stg:py-4">
          {error ? (
            <ErrorMessage error={error} title="Couldn't load the plan." retry={refetch} />
          ) : (
            <Notice tone="failed" headline="Couldn't load the plan." act={{ label: "Try again", onClick: refetch }} />
          )}
        </div>
      </PlanEditorFrame>
    );
  }

  return (
    <PlanEditorFrame onKeyDown={handleKeyDown}>
      <PlanCardHeader
        as="header"
        title={parsed.title ?? "Plan"}
        subline={planSubline(readOnly ? "replaced" : "ready", plan.file.status?.sizeBytes)}
        acts={
          activeDraft?.isEdited || canBuild ? (
            <span className="stg:flex stg:min-w-0 stg:flex-wrap stg:items-center stg:gap-3">
              {activeDraft?.isEdited && (
                <span className="stg:inline-flex stg:items-center stg:gap-2">
                  <StatusBadge phase="draft" label="Edited" />
                  <Button variant="ghost" size="xs" onClick={() => activeDraft.setDraft(null)}>
                    Revert
                  </Button>
                </span>
              )}
              {canBuild && (
                <Button
                  size="sm"
                  disabled={buildDisabled}
                  onClick={onBuildFromPlan}
                  icon={<ImplementIcon />}
                  className="stg:min-w-0 stg:shrink"
                >
                  <span className="stg:truncate">
                    {buildDisabled ? "Starting build…" : "Build"}
                  </span>
                </Button>
              )}
            </span>
          ) : undefined
        }
      />

      {/* Toolbar: the view tabs. Narrow panes are first-class: rows wrap
          (flex-wrap) and every item can shrink (min-w-0 + truncating
          labels), so the toolbar reflows instead of forcing the document
          pane to scroll sideways. */}
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
            />
          )}
        </div>
        {/* The reason the Edit tab is disabled must be visible text: a
            disabled tab leaves the tab order and drops pointer events, so
            no hover- or focus-dependent hint can ever reach the user who
            needs it. */}
        {activeDraft !== undefined && !canEdit && (
          <span className="stg:min-w-0 stg:text-2xs stg:text-muted-foreground">
            This plan is too large to edit in place — download it instead.
          </span>
        )}
      </div>

      {activeView === "rendered" && <RenderedPlan body={parsed.body} />}
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
        <p role="status" className="stg:text-2xs stg:text-muted-foreground">
          Preview truncated — download the plan for the full text.
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
 * The plan document: its body (the title is the editor's header) in the
 * shared plan-document typography — identical treatment to the thread's plan
 * rendering, so the plan reads the same on every surface.
 */
function RenderedPlan({ body }: { readonly body: string }) {
  return (
    <div className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border-muted stg:bg-card">
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
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
  readonly disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "stg:rounded stg:px-2 stg:py-0.5 stg:text-2xs stg:font-medium stg:transition-colors",
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
