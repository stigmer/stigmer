"use client";

import { memo, useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { useWorkflowEditor, type UseWorkflowEditorOptions } from "./useWorkflowEditor";
import { WorkflowYamlEditor } from "./WorkflowYamlEditor";
import { WorkflowTopologyGraph } from "./WorkflowTopologyGraph";

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
  /** Additional CSS class names for the root container. */
  readonly className?: string;
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
export const WorkflowEditorView = memo(function WorkflowEditorView({
  initialYaml,
  org,
  onSaveSuccess,
  onSaveError,
  className,
}: WorkflowEditorViewProps) {
  const editor = useWorkflowEditor(initialYaml, { org });
  const [isFullPage, setIsFullPage] = useState(false);

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

  const rootClassName = cn(
    "stgm-workflow-editor flex flex-col",
    isFullPage && "fixed inset-0 z-50 bg-background",
    !isFullPage && "h-full",
    className,
  );

  return (
    <div className={rootClassName}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-3">
          <ValidationSummary
            errorCount={editor.errorCount}
            warningCount={editor.warningCount}
          />
          {editor.isDirty && (
            <span className="text-xs text-muted-foreground">Unsaved changes</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={editor.reset}
            disabled={!editor.isDirty || editor.isSaving}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium transition-colors",
              "text-muted-foreground hover:bg-muted hover:text-foreground",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            Reset
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!editor.isDirty || editor.isSaving || editor.errorCount > 0}
            className={cn(
              "rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground transition-colors",
              "hover:bg-primary/90",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {editor.isSaving ? "Saving\u2026" : "Save"}
          </button>
          <button
            type="button"
            onClick={toggleFullPage}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={isFullPage ? "Exit full page" : "Full page"}
          >
            <ExpandIcon expanded={isFullPage} />
          </button>
        </div>
      </div>

      {/* Save error banner */}
      {editor.saveError && (
        <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {editor.saveError.message}
        </div>
      )}

      {/* Split pane: editor + graph */}
      <div className="flex min-h-0 flex-1">
        <div className="flex-1 overflow-hidden border-r border-border">
          <WorkflowYamlEditor
            value={editor.yaml}
            onChange={editor.setYaml}
            diagnostics={editor.diagnostics as import("@codemirror/lint").Diagnostic[]}
            className="h-full rounded-none border-0"
          />
        </div>
        <div className="w-[40%] min-w-[240px] overflow-hidden">
          <WorkflowTopologyGraph
            topology={editor.topology}
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
});

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
      <span className="text-xs text-success">
        <CheckCircleIcon />
        {" "}Valid
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {errorCount > 0 && (
        <span className="text-xs text-destructive">
          {errorCount} {errorCount === 1 ? "error" : "errors"}
        </span>
      )}
      {warningCount > 0 && (
        <span className="text-xs text-warning">
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
      className="inline-block"
    >
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5.5 8l2 2 3-3.5" />
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
