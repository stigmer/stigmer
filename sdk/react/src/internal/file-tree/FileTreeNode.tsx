"use client";

import { useCallback, useState, type DragEvent } from "react";
import { cn } from "@stigmer/theme";
import type { TreeNode } from "./tree-node";

/**
 * MIME type used to transfer workspace file-reference data during
 * drag-and-drop. The payload is `JSON.stringify({ path })` where
 * `path` is the workspace-relative file path.
 */
export const FILE_REF_MIME = "application/x-stigmer-file-ref";

export interface FileTreeNodeProps {
  readonly node: TreeNode;
  readonly selectedPath: string;
  readonly onSelect: (path: string) => void;
  readonly depth: number;
  /**
   * When `true`, file nodes (not folders) become draggable and emit
   * the `application/x-stigmer-file-ref` MIME type on drag start.
   *
   * Defaults to `false` to avoid unintended drag behavior in contexts
   * where file referencing is not applicable (e.g., SkillFileBrowser).
   */
  readonly enableDrag?: boolean;
}

/**
 * Recursive tree-node renderer for a {@link TreeNode} hierarchy.
 *
 * Renders folders as expandable disclosure rows and files as selectable
 * leaf rows. When `enableDrag` is `true`, file rows are draggable and
 * emit a custom MIME type for the SessionComposer drop target.
 *
 * Uses `role="treeitem"` / `role="group"` for a11y and `--stgm-*`
 * theme tokens for all visual properties.
 */
export function FileTreeNode({
  node,
  selectedPath,
  onSelect,
  depth,
  enableDrag = false,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = !!node.children;
  const isSelected = node.path === selectedPath;
  const isDraggable = enableDrag && !isFolder;

  const handleClick = useCallback(() => {
    if (isFolder) {
      setExpanded((prev) => !prev);
    } else {
      onSelect(node.path);
    }
  }, [isFolder, node.path, onSelect]);

  const handleDragStart = useCallback(
    (e: DragEvent) => {
      e.dataTransfer.setData(FILE_REF_MIME, JSON.stringify({ path: node.path }));
      e.dataTransfer.effectAllowed = "link";
    },
    [node.path],
  );

  return (
    <li role="treeitem" aria-expanded={isFolder ? expanded : undefined}>
      <button
        type="button"
        onClick={handleClick}
        draggable={isDraggable}
        onDragStart={isDraggable ? handleDragStart : undefined}
        className={cn(
          "flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs transition-colors",
          "hover:bg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          isSelected && !isFolder && "bg-muted text-foreground font-medium",
          !isSelected && "text-muted-foreground",
          isDraggable && "cursor-grab active:cursor-grabbing",
        )}
        style={{ paddingLeft: `${12 + depth * 12}px` }}
        aria-current={isSelected ? "true" : undefined}
      >
        {isFolder && (
          <span className="text-[10px] text-muted-foreground-subtle">
            {expanded ? "▼" : "▶"}
          </span>
        )}
        <span className={cn("truncate", isFolder && "font-medium text-foreground")}>
          {node.name}
        </span>
      </button>
      {isFolder && expanded && node.children && (
        <ul role="group">
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              depth={depth + 1}
              enableDrag={enableDrag}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
