"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowGraphModel } from "./workflow-graph-model.js";
import { taskToYaml } from "./inspector/task-to-yaml.js";

/** Props for {@link ViewYamlDialog}. */
export interface ViewYamlDialogProps {
  /** ID of the node to show YAML for, or `null` to close. */
  readonly nodeId: string | null;
  /** The current graph model to look up the node. */
  readonly graph: WorkflowGraphModel | null;
  /** Called when the dialog is dismissed. */
  readonly onClose: () => void;
}

/**
 * Read-only dialog showing a single task's YAML representation.
 *
 * Triggered from the context menu "View YAML" or the inspector overflow
 * menu. Renders the output of {@link taskToYaml} in a monospace `<pre>`
 * block with a copy-to-clipboard button.
 *
 * Styled with `--stgm-*` tokens in `@layer stgm` for embed safety.
 *
 * @since T11 (Context Menus and Keyboard Shortcuts)
 */
export const ViewYamlDialog = memo(function ViewYamlDialog({
  nodeId,
  graph,
  onClose,
}: ViewYamlDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  const node = nodeId && graph
    ? graph.nodes.find((n) => n.id === nodeId) ?? null
    : null;

  const yaml = node ? taskToYaml(node) : "";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (nodeId && node) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [nodeId, node]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(yaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      const textarea = document.createElement("textarea");
      textarea.value = yaml;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [yaml]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDialogElement>) => {
      if (e.target === dialogRef.current) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        "stgm m-auto max-h-[80vh] w-full max-w-lg rounded-lg border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-background,#fff)] p-0 shadow-xl",
        "backdrop:bg-black/40",
      )}
      onClick={handleBackdropClick}
      aria-label={node ? `YAML for ${node.taskName}` : "View YAML"}
    >
      {node && (
        <div className="flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[var(--stgm-border,#e5e5e5)] px-4 py-3">
            <div className="flex items-center gap-2">
              <CodeBracketIcon />
              <span className="text-sm font-semibold text-[var(--stgm-foreground,#1a1a2e)]">
                {node.taskName}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleCopy}
                className="rounded px-2 py-1 text-xs font-medium text-[var(--stgm-foreground,#1a1a2e)] hover:bg-[var(--stgm-muted,#f5f5f5)]"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex h-6 w-6 items-center justify-center rounded text-[var(--stgm-muted-foreground,#737373)] hover:bg-[var(--stgm-muted,#f5f5f5)] hover:text-[var(--stgm-foreground,#1a1a2e)]"
                aria-label="Close"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </button>
            </div>
          </div>

          {/* YAML content */}
          <div className="overflow-auto p-4">
            <pre className="whitespace-pre text-xs leading-relaxed text-[var(--stgm-foreground,#1a1a2e)]">
              <code>{yaml}</code>
            </pre>
          </div>
        </div>
      )}
    </dialog>
  );
});

function CodeBracketIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-[var(--stgm-muted-foreground,#737373)]">
      <path d="M5 4L1.5 8 5 12M11 4l3.5 4-3.5 4M9 2l-2 12" />
    </svg>
  );
}
