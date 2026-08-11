"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { useWorkflowEditor } from "./useWorkflowEditor.js";
import { WorkflowYamlEditor } from "./WorkflowYamlEditor.js";
import { WorkflowCodePreviewGraph } from "./WorkflowCodePreviewGraph.js";
import { WorkflowCanvasEditor } from "./WorkflowCanvasEditor.js";
import type { LayoutEngine } from "./layout/index.js";
import { WorkflowRefinePanel } from "./WorkflowRefinePanel.js";
import { WorkflowExplainDialog } from "./WorkflowExplainDialog.js";
import { yamlToGraph } from "./workflow-graph-conversions.js";

/** Props for {@link WorkflowEditorView}. */
export interface WorkflowEditorViewProps {
  /** The initial YAML content to load into the editor. */
  readonly initialYaml: string;
  /** Organization slug for the save path. */
  readonly org: string;
  /** Called after a successful save. */
  readonly onSaveSuccess?: () => void;
  /** Called when a save fails. */
  readonly onSaveError?: (error: Error) => void;
  /** Initial editor mode. Defaults to `"code"`. */
  readonly defaultMode?: WorkflowEditorMode;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * Layout engine for the visual canvas "Auto Layout" action.
   * Pass the result of {@link useElkLayoutEngine} for ELK-powered layout.
   * When omitted, dagre is used as the default.
   */
  readonly layoutEngine?: LayoutEngine | null;
}

/**
 * Composed workflow YAML editor with live topology graph preview.
 *
 * Renders a side-by-side layout: schema-aware YAML editor on the left,
 * read-only DAG preview on the right. Includes a toolbar with
 * validation summary, save button, dirty indicator, and full-page toggle.
 *
 * Composes {@link useWorkflowEditor} internally — the caller only needs
 * to provide the initial YAML and org slug.
 *
 * Zero Console dependencies (DD-004). All visual properties flow through
 * `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <WorkflowEditorView
 *   initialYaml={yaml}
 *   org="acme"
 *   onSaveSuccess={() => toast.success("Workflow saved")}
 * />
 * ```
 *
 * @since T10 (YAML Editor with Graph Preview)
 */
/** Editing mode for the workflow editor. */
export type WorkflowEditorMode = "code" | "visual";

export const WorkflowEditorView = memo(function WorkflowEditorView({
  initialYaml,
  org,
  onSaveSuccess,
  onSaveError,
  defaultMode = "code",
  className,
  layoutEngine,
}: WorkflowEditorViewProps) {
  const editor = useWorkflowEditor(initialYaml, { org });
  const [isFullPage, setIsFullPage] = useState(false);
  const [mode, setMode] = useState<WorkflowEditorMode>(defaultMode);
  const [showModeWarning, setShowModeWarning] = useState(false);
  const [canvasIsSaving, setCanvasIsSaving] = useState(false);
  const [showRefinePanel, setShowRefinePanel] = useState(false);
  const [pendingFixInstruction, setPendingFixInstruction] = useState<string | undefined>(undefined);
  const [showExplainDialog, setShowExplainDialog] = useState(false);

  // Track canvas dirty state separately for mode switch prompts
  const [canvasDirty, setCanvasDirty] = useState(false);
  const [showDirtyPrompt, setShowDirtyPrompt] = useState(false);

  const handleSave = useCallback(async () => {
    const success = await editor.save();
    if (success) {
      onSaveSuccess?.();
    } else if (editor.saveError) {
      onSaveError?.(editor.saveError);
    }
  }, [editor, onSaveSuccess, onSaveError]);

  const toggleFullPage = useCallback(() => {
    setIsFullPage((prev) => !prev);
  }, []);

  // -------------------------------------------------------------------------
  // Mode switching (AD-T15-B3-003)
  // -------------------------------------------------------------------------

  const handleSwitchToVisual = useCallback(() => {
    try {
      yamlToGraph(editor.yaml);
      setShowModeWarning(true);
    } catch {
      onSaveError?.(new Error("Cannot switch to visual mode: the current YAML has structural errors that prevent parsing."));
    }
  }, [editor.yaml, onSaveError]);

  const confirmSwitchToVisual = useCallback(() => {
    setShowModeWarning(false);
    setMode("visual");
  }, []);

  const cancelSwitchToVisual = useCallback(() => {
    setShowModeWarning(false);
  }, []);

  const handleSwitchToCode = useCallback(() => {
    if (canvasDirty) {
      setShowDirtyPrompt(true);
      return;
    }
    setMode("code");
  }, [canvasDirty]);

  const confirmDiscardAndSwitchToCode = useCallback(() => {
    setShowDirtyPrompt(false);
    setMode("code");
    setCanvasDirty(false);
  }, []);

  const cancelSwitchToCode = useCallback(() => {
    setShowDirtyPrompt(false);
  }, []);

  // Canvas save handler (AD-T15-B3-002: save via YAML)
  const handleCanvasSave = useCallback(
    async (yamlStr: string) => {
      setCanvasIsSaving(true);
      editor.setYaml(yamlStr);
      // Allow React to propagate the YAML before saving
      setTimeout(async () => {
        const success = await editor.save();
        setCanvasIsSaving(false);
        setCanvasDirty(false);
        if (success) {
          onSaveSuccess?.();
        } else if (editor.saveError) {
          onSaveError?.(editor.saveError);
        }
      }, 0);
    },
    [editor, onSaveSuccess, onSaveError],
  );

  const toggleRefinePanel = useCallback(() => {
    setShowRefinePanel((prev) => !prev);
    setPendingFixInstruction(undefined);
  }, []);

  const handleFixWithAI = useCallback(() => {
    const errorDiags = editor.diagnostics.filter((d) => d.severity === "error");
    if (errorDiags.length === 0) return;

    const lines = errorDiags.map((d, i) => `${i + 1}. ${d.message}`);
    const instruction = [
      "Fix the following validation errors in this workflow:",
      "",
      ...lines,
      "",
      "Please fix these issues and return the corrected workflow.",
    ].join("\n");

    setPendingFixInstruction(instruction);
    setShowRefinePanel(true);
  }, [editor.diagnostics]);

  const handleRefineAccept = useCallback(
    (updatedYaml: string) => {
      editor.setYaml(updatedYaml);
      if (mode === "visual") {
        try {
          yamlToGraph(updatedYaml);
        } catch {
          // Canvas will re-parse on next render
        }
      }
    },
    [editor, mode],
  );

  // Validation error mapping for canvas mode
  const nodeErrors = useMemo<ReadonlyMap<string, readonly string[]>>(() => {
    if (mode !== "visual") return new Map();
    const errorMap = new Map<string, string[]>();
    for (const diag of editor.diagnostics) {
      if (diag.severity !== "error") continue;
      const match = diag.message.match(/task\s+"([^"]+)"/i) ??
        diag.message.match(/task\s+(\S+)/i);
      if (match) {
        const taskName = match[1];
        const existing = errorMap.get(taskName);
        if (existing) {
          existing.push(diag.message);
        } else {
          errorMap.set(taskName, [diag.message]);
        }
      }
    }
    return errorMap;
  }, [mode, editor.diagnostics]);

  const rootClassName = cn(
    "stgm-workflow-editor stg:flex stg:flex-col",
    isFullPage && "stg:fixed stg:inset-0 stg:z-50 stg:bg-background",
    !isFullPage && "stg:h-full",
    className,
  );

  return (
    <div className={rootClassName}>
      {/* Toolbar */}
      <div className="stg:flex stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-3 stg:py-2">
        <div className="stg:flex stg:items-center stg:gap-3">
          {/* Mode Toggle */}
          <ModeToggle mode={mode} onSwitchToCode={handleSwitchToCode} onSwitchToVisual={handleSwitchToVisual} />
          <div className="stg:mx-1 stg:h-4 stg:w-px stg:bg-[var(--stgm-border,#d4d4d8)]" aria-hidden="true" />
          <button
            type="button"
            onClick={toggleRefinePanel}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1 stg:rounded stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
              showRefinePanel
                ? "stg:bg-primary/10 stg:text-primary"
                : "stg:text-muted-foreground stg:hover:bg-muted stg:hover:text-foreground",
            )}
            aria-pressed={showRefinePanel}
            aria-label="Refine with AI"
          >
            <RefineSparklesIcon />
            Refine
          </button>
          <div className="stg:mx-1 stg:h-4 stg:w-px stg:bg-[var(--stgm-border,#d4d4d8)]" aria-hidden="true" />
          <ValidationSummary
            errorCount={editor.errorCount}
            warningCount={editor.warningCount}
          />
          {editor.errorCount > 0 && (
            <button
              type="button"
              onClick={handleFixWithAI}
              className={cn(
                "stg:inline-flex stg:items-center stg:gap-1 stg:rounded stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
                "stg:text-muted-foreground stg:hover:bg-muted stg:hover:text-foreground",
              )}
              aria-label="Fix validation errors with AI"
            >
              <FixSparklesIcon />
              Fix with AI
            </button>
          )}
          {(editor.isDirty || canvasDirty) && (
            <span className="stg:text-xs stg:text-muted-foreground">Unsaved changes</span>
          )}
        </div>

        <div className="stg:flex stg:items-center stg:gap-2">
          {mode === "code" && (editor.isDirty || editor.versionMessage) && (
            <input
              type="text"
              value={editor.versionMessage}
              onChange={(e) => editor.setVersionMessage(e.target.value)}
              placeholder="Version message (optional)"
              disabled={editor.isSaving}
              className={cn(
                "stg:h-7 stg:w-48 stg:rounded stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)] stg:px-2 stg:text-xs",
                "stg:text-[var(--stgm-foreground,#1a1a2e)] stg:placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)]",
                "stg:focus:border-[var(--stgm-primary,#6366f1)] stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-[var(--stgm-primary,#6366f1)]",
                "stg:disabled:opacity-40",
              )}
            />
          )}
          {mode === "code" && (
            <button
              type="button"
              onClick={editor.reset}
              disabled={!editor.isDirty || editor.isSaving}
              className={cn(
                "stg:rounded stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
                "stg:text-muted-foreground stg:hover:bg-muted stg:hover:text-foreground",
                "stg:disabled:pointer-events-none stg:disabled:opacity-40",
              )}
            >
              Reset
            </button>
          )}
          {mode === "code" && (
            <button
              type="button"
              onClick={handleSave}
              disabled={!editor.isDirty || editor.isSaving || editor.errorCount > 0}
              className={cn(
                "stg:rounded stg:bg-primary stg:px-3 stg:py-1 stg:text-xs stg:font-medium stg:text-primary-foreground stg:transition-colors",
                "stg:hover:bg-primary/90",
                "stg:disabled:pointer-events-none stg:disabled:opacity-40",
              )}
            >
              {editor.isSaving ? "Saving\u2026" : "Save"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowExplainDialog(true)}
            className={cn(
              "stg:inline-flex stg:items-center stg:gap-1 stg:rounded stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
              "stg:text-muted-foreground stg:hover:bg-muted stg:hover:text-foreground",
            )}
            aria-label="Explain this workflow"
          >
            <ExplainIcon />
            Explain
          </button>
          <button
            type="button"
            onClick={toggleFullPage}
            className="stg:rounded stg:p-1 stg:text-muted-foreground stg:hover:bg-muted stg:hover:text-foreground"
            aria-label={isFullPage ? "Exit full page" : "Full page"}
          >
            <ExpandIcon expanded={isFullPage} />
          </button>
        </div>
      </div>

      {/* Save error banner */}
      {editor.saveError && (
        <div className="stg:border-b stg:border-destructive/20 stg:bg-destructive/5 stg:px-3 stg:py-2 stg:text-xs stg:text-destructive">
          {editor.saveError.message}
        </div>
      )}

      {/* Mode warning dialog */}
      {showModeWarning && (
        <ModeWarningDialog onConfirm={confirmSwitchToVisual} onCancel={cancelSwitchToVisual} />
      )}

      {/* Dirty prompt dialog */}
      {showDirtyPrompt && (
        <DirtyPromptDialog onDiscard={confirmDiscardAndSwitchToCode} onCancel={cancelSwitchToCode} />
      )}

      {/* Explain dialog */}
      <WorkflowExplainDialog
        open={showExplainDialog}
        onOpenChange={setShowExplainDialog}
        org={org}
        currentYaml={editor.yaml}
      />

      {/* Main content area */}
      <div className="stg:flex stg:min-h-0 stg:flex-1">
        {mode === "code" ? (
          <>
            <div className="stg:flex-1 stg:overflow-hidden stg:border-r stg:border-border">
              <WorkflowYamlEditor
                value={editor.yaml}
                onChange={editor.setYaml}
                diagnostics={editor.diagnostics as import("@codemirror/lint").Diagnostic[]}
                className="stg:h-full stg:rounded-none stg:border-0"
              />
            </div>
            <div className="stg:w-[40%] stg:min-w-[240px] stg:overflow-hidden">
              {showRefinePanel ? (
                <WorkflowRefinePanel
                  org={org}
                  currentYaml={editor.yaml}
                  onAccept={handleRefineAccept}
                  onClose={toggleRefinePanel}
                  initialInstruction={pendingFixInstruction}
                  className="stg:h-full"
                />
              ) : (
                <WorkflowCodePreviewGraph
                  yaml={editor.yaml}
                  className="stg:h-full"
                />
              )}
            </div>
          </>
        ) : (
          <>
            <WorkflowCanvasEditor
              yaml={editor.yaml}
              onSave={handleCanvasSave}
              isSaving={canvasIsSaving}
              onDirtyChange={setCanvasDirty}
              nodeErrors={nodeErrors}
              layoutEngine={layoutEngine}
              className={showRefinePanel ? "stg:w-[60%]" : "stg:flex-1"}
            />
            {showRefinePanel && (
              <div className="stg:w-[40%] stg:min-w-[240px] stg:overflow-hidden">
                <WorkflowRefinePanel
                  org={org}
                  currentYaml={editor.yaml}
                  onAccept={handleRefineAccept}
                  onClose={toggleRefinePanel}
                  initialInstruction={pendingFixInstruction}
                  className="stg:h-full"
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Mode Toggle
// ---------------------------------------------------------------------------

function ModeToggle({
  mode,
  onSwitchToCode,
  onSwitchToVisual,
}: {
  mode: WorkflowEditorMode;
  onSwitchToCode: () => void;
  onSwitchToVisual: () => void;
}) {
  const segmentClass = (active: boolean) =>
    cn(
      "stg:rounded stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
      active
        ? "stg:bg-[var(--stgm-primary,#6366f1)] stg:text-[var(--stgm-primary-foreground,#fff)]"
        : "stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:bg-[var(--stgm-muted,#f5f5f5)] stg:hover:text-[var(--stgm-foreground,#1a1a2e)]",
    );

  return (
    <div className="stg:flex stg:items-center stg:gap-0.5 stg:rounded-md stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:p-0.5" role="tablist" aria-label="Editor mode">
      <button type="button" role="tab" aria-selected={mode === "code"} onClick={onSwitchToCode} className={segmentClass(mode === "code")}>
        Code
      </button>
      <button type="button" role="tab" aria-selected={mode === "visual"} onClick={onSwitchToVisual} className={segmentClass(mode === "visual")}>
        Visual
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode Warning Dialog
// ---------------------------------------------------------------------------

function ModeWarningDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="stg:border-b stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-accent,#fffbeb)] stg:px-3 stg:py-2">
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
        <p className="stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)]">
          Switching to visual mode will normalize YAML formatting. Comments and custom ordering will not be preserved.
        </p>
        <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="stg:rounded stg:px-2 stg:py-1 stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:bg-[var(--stgm-muted,#f5f5f5)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="stg:rounded stg:bg-[var(--stgm-primary,#6366f1)] stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:text-[var(--stgm-primary-foreground,#fff)] stg:hover:opacity-90"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dirty Prompt Dialog
// ---------------------------------------------------------------------------

function DirtyPromptDialog({
  onDiscard,
  onCancel,
}: {
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="stg:border-b stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-accent,#fffbeb)] stg:px-3 stg:py-2">
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
        <p className="stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)]">
          You have unsaved changes in the visual editor. Switching to code mode will discard them.
        </p>
        <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="stg:rounded stg:px-2 stg:py-1 stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:bg-[var(--stgm-muted,#f5f5f5)]"
          >
            Stay in Visual
          </button>
          <button
            type="button"
            onClick={onDiscard}
            className="stg:rounded stg:bg-[var(--stgm-destructive,#ef4444)] stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:text-[var(--stgm-destructive-foreground,#fff)] stg:hover:opacity-90"
          >
            Discard &amp; Switch
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ValidationSummary({
  errorCount,
  warningCount,
}: {
  readonly errorCount: number;
  readonly warningCount: number;
}) {
  if (errorCount === 0 && warningCount === 0) {
    return (
      <span className="stg:text-xs stg:text-success">
        <CheckCircleIcon />
        {" "}Valid
      </span>
    );
  }

  return (
    <div className="stg:flex stg:items-center stg:gap-2">
      {errorCount > 0 && (
        <span className="stg:text-xs stg:text-destructive">
          {errorCount} {errorCount === 1 ? "error" : "errors"}
        </span>
      )}
      {warningCount > 0 && (
        <span className="stg:text-xs stg:text-warning">
          {warningCount} {warningCount === 1 ? "warning" : "warnings"}
        </span>
      )}
    </div>
  );
}

function CheckCircleIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="stg:inline-block"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5.5 8l2 2 3-3.5" />
    </svg>
  );
}

function RefineSparklesIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z" />
    </svg>
  );
}

function ExplainIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M6.5 6a1.5 1.5 0 1 1 1.5 1.5V9" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

function FixSparklesIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5z" />
    </svg>
  );
}

function ExpandIcon({ expanded }: { readonly expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {expanded ? (
        <>
          <path d="M6 2H2v4M10 14h4v-4" />
          <path d="M2 2l5 5M14 14l-5-5" />
        </>
      ) : (
        <>
          <path d="M14 2h-4M2 14h4" />
          <path d="M14 2l-5 5M2 14l5-5" />
        </>
      )}
    </svg>
  );
}
