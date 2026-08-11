"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { parse as parseYaml } from "yaml";
import {
  ReactFlowProvider,
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useReactFlow,
  type Node,
  type Edge,
} from "@xyflow/react";
import type { WorkflowTemplate, WorkflowTemplateMeta } from "./types.js";
import { PATTERN_LABELS } from "./types.js";
import { deriveTemplateMeta } from "./derive-template-metadata.js";
import { TEMPLATE_CATEGORY_LABELS } from "../../resource-creation/templates/types.js";

export interface WorkflowTemplatePreviewProps {
  readonly template: WorkflowTemplate | null;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSelect: (template: WorkflowTemplate) => void;
}

/**
 * Preview dialog for a workflow template.
 *
 * Shows the template's metadata, pattern badges, and a read-only
 * graph preview rendered via the YAML → graph pipeline. Uses a
 * native `<dialog>` element for modal semantics.
 *
 * The graph preview is lazy — it only parses and lays out the YAML
 * when the dialog opens, not while browsing cards.
 */
export function WorkflowTemplatePreview({
  template,
  open,
  onClose,
  onSelect,
}: WorkflowTemplatePreviewProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  const handleSelect = useCallback(() => {
    if (template) onSelect(template);
  }, [template, onSelect]);

  const meta = useMemo(
    () => (template ? deriveTemplateMeta(template.data.yaml ?? "") : null),
    [template],
  );

  if (!template || !meta) {
    return <dialog ref={dialogRef} className="stg:hidden" />;
  }

  const categoryLabel =
    TEMPLATE_CATEGORY_LABELS[template.category] ?? template.category;

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        "stgm stg:m-auto stg:max-h-[85vh] stg:w-full stg:max-w-3xl stg:rounded-lg stg:border stg:border-border stg:bg-background stg:p-0 stg:shadow-lg",
        "stg:backdrop:bg-black/50",
      )}
    >
      <div className="stg:flex stg:flex-col">
        {/* Header */}
        <div className="stg:flex stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-5 stg:py-4">
          <div>
            <h2 className="stg:text-base stg:font-semibold stg:text-foreground">
              {template.name}
            </h2>
            <span className="stg:text-xs stg:text-muted-foreground">
              {categoryLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className={cn(
              "stg:rounded-md stg:p-1.5 stg:text-muted-foreground stg:transition-colors",
              "stg:hover:bg-accent stg:hover:text-accent-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="stg:flex stg:flex-col stg:gap-4 stg:px-5 stg:py-4">
          {/* Description */}
          <p className="stg:text-sm stg:leading-relaxed stg:text-muted-foreground">
            {template.description}
          </p>

          {/* Metadata row */}
          <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-3">
            <MetaChip label={`${meta.taskCount} tasks`} />
            <MetaChip label={`${meta.taskKinds.length} task types`} />
            {meta.envVarCount > 0 && (
              <MetaChip label={`${meta.envVarCount} env vars`} />
            )}
            {meta.hasBudget && <MetaChip label="Budget configured" />}
          </div>

          {/* Pattern badges */}
          {meta.patterns.length > 0 && (
            <div className="stg:flex stg:flex-wrap stg:gap-1.5">
              {meta.patterns.map((pattern) => (
                <span
                  key={pattern}
                  className="stg:rounded-full stg:bg-muted stg:px-2.5 stg:py-0.5 stg:text-xs stg:font-medium stg:text-muted-foreground"
                >
                  {PATTERN_LABELS[pattern]}
                </span>
              ))}
            </div>
          )}

          {/* Task kinds */}
          <div>
            <h3 className="stg:mb-1.5 stg:text-xs stg:font-medium stg:text-foreground">
              Task types used
            </h3>
            <div className="stg:flex stg:flex-wrap stg:gap-1.5">
              {meta.taskKinds.map((kind) => (
                <code
                  key={kind}
                  className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:text-[11px] stg:text-muted-foreground"
                >
                  {kind}
                </code>
              ))}
            </div>
          </div>

          {/* Graph preview */}
          <div className="stg:h-64 stg:overflow-hidden stg:rounded-md stg:border stg:border-border stg:bg-muted/30">
            <ReactFlowProvider>
              <TemplateGraphPreview yaml={template.data.yaml ?? ""} />
            </ReactFlowProvider>
          </div>
        </div>

        {/* Footer */}
        <div className="stg:flex stg:items-center stg:justify-end stg:gap-2 stg:border-t stg:border-border stg:px-5 stg:py-3">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-sm stg:font-medium stg:text-muted-foreground stg:transition-colors",
              "stg:hover:bg-accent stg:hover:text-accent-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSelect}
            className={cn(
              "stg:rounded-md stg:bg-primary stg:px-4 stg:py-1.5 stg:text-sm stg:font-medium stg:text-primary-foreground stg:transition-colors",
              "stg:hover:bg-primary/90",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
            )}
          >
            Use this template
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Lightweight graph preview that parses template YAML and renders
 * a simplified node layout using React Flow.
 *
 * Uses a basic top-to-bottom layout without importing the full
 * dagre/ELK pipeline to keep the preview lightweight.
 */
function TemplateGraphPreview({ yaml }: { readonly yaml: string }) {
  const { fitView } = useReactFlow();
  const [elements, setElements] = useState<{
    nodes: Node[];
    edges: Edge[];
  }>({ nodes: [], edges: [] });

  useEffect(() => {
    try {
      const doc = parseYaml(yaml);
      const tasks: Array<{ name?: string; kind?: string; flow?: { then?: string } }> =
        doc?.spec?.tasks ?? [];

      const nodes: Node[] = [];
      const edges: Edge[] = [];

      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i]!;
        const taskName = task.name ?? `task_${i}`;
        nodes.push({
          id: taskName,
          type: "default",
          position: { x: 150, y: i * 80 },
          data: { label: `${taskName} (${task.kind ?? "unknown"})` },
          style: {
            fontSize: 11,
            padding: "4px 8px",
            borderRadius: 6,
            minWidth: 160,
            textAlign: "center" as const,
          },
        });

        const nextTarget = task.flow?.then;
        if (nextTarget && nextTarget !== "end") {
          edges.push({
            id: `${taskName}->${nextTarget}`,
            source: taskName,
            target: nextTarget,
          });
        } else if (!nextTarget && i < tasks.length - 1) {
          const next = tasks[i + 1]!;
          edges.push({
            id: `${taskName}->${next.name ?? `task_${i + 1}`}`,
            source: taskName,
            target: next.name ?? `task_${i + 1}`,
          });
        }
      }

      setElements({ nodes, edges });
    } catch {
      setElements({ nodes: [], edges: [] });
    }
  }, [yaml]);

  useEffect(() => {
    if (elements.nodes.length > 0) {
      const timer = setTimeout(() => fitView({ padding: 0.2 }), 50);
      return () => clearTimeout(timer);
    }
  }, [elements.nodes.length, fitView]);

  if (elements.nodes.length === 0) {
    return (
      <div className="stg:flex stg:h-full stg:items-center stg:justify-center stg:text-xs stg:text-muted-foreground">
        No preview available
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={elements.nodes}
      edges={elements.edges}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      panOnDrag
      zoomOnScroll
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
    </ReactFlow>
  );
}

function MetaChip({ label }: { readonly label: string }) {
  return (
    <span className="stg:rounded-md stg:bg-muted stg:px-2 stg:py-0.5 stg:text-[11px] stg:font-medium stg:text-muted-foreground">
      {label}
    </span>
  );
}

function CloseIcon() {
  return (
    <svg
      className="stg:size-4"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
