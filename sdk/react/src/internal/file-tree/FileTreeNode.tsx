"use client";

import { useCallback, useState, type DragEvent } from "react";
import { cn } from "@stigmer/theme";
import { FileTypeIcon, FolderTypeIcon } from "../file-icons/index.js";
import type { TreeNode } from "./tree-node.js";

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
  /**
   * Optional double-click handler for file nodes. When set, a double-click on a
   * file calls `onActivate(path)` (used by the workspace surface to pin a
   * previewed tab); the single click still fires `onSelect`. Folders ignore it.
   */
  readonly onActivate?: (path: string) => void;
  readonly depth: number;
  /**
   * When `true`, file nodes (not folders) become draggable and emit
   * the `application/x-stigmer-file-ref` MIME type on drag start.
   *
   * Defaults to `false` to avoid unintended drag behavior in contexts
   * where file referencing is not applicable (e.g., SkillFileBrowser).
   */
  readonly enableDrag?: boolean;
  /**
   * When `true`, render monochrome file-type / folder icons before each name
   * (VS Code explorer feel). Opt-in so drag/skill contexts stay icon-free.
   */
  readonly showIcons?: boolean;
  /**
   * When `true`, draw vertical indent guides down each nested group and indent
   * via nested margins rather than per-row left padding. Opt-in; the default
   * padding-based indentation is preserved for existing consumers.
   */
  readonly indentGuides?: boolean;
  /**
   * Maximum depth at which folders start collapsed instead of expanded.
   * Folders at depth >= maxInitialDepth render collapsed by default,
   * reducing DOM node count for large trees. Users can still expand
   * them manually.
   *
   * When `undefined`, all folders start expanded (original behavior).
   */
  readonly maxInitialDepth?: number;
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
  onActivate,
  depth,
  enableDrag = false,
  showIcons = false,
  indentGuides = false,
  maxInitialDepth,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(
    maxInitialDepth === undefined ? true : depth < maxInitialDepth,
  );
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

  const handleDoubleClick = useCallback(() => {
    if (!isFolder) onActivate?.(node.path);
  }, [isFolder, node.path, onActivate]);

  const handleDragStart = useCallback(
    (e: DragEvent) => {
      e.dataTransfer.setData(FILE_REF_MIME, JSON.stringify({ path: node.path }));
      e.dataTransfer.effectAllowed = "link";
    },
    [node.path],
  );

  return (
    <li
      role="treeitem"
      // Depth conveys tree nesting to assistive tech (indentation is visual
      // only). aria-level is 1-based; `depth` is 0-based. aria-expanded stays on
      // the treeitem (the <li>) — its child group is nested here, so this is the
      // element a tree-aware screen reader reads expandability from.
      aria-level={depth + 1}
      aria-expanded={isFolder ? expanded : undefined}
    >
      <button
        type="button"
        onClick={handleClick}
        onDoubleClick={onActivate ? handleDoubleClick : undefined}
        draggable={isDraggable}
        onDragStart={isDraggable ? handleDragStart : undefined}
        className={cn(
          "flex w-full items-center gap-1.5 py-1 text-left text-xs transition-colors",
          "hover:bg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          isSelected && !isFolder && "bg-muted text-foreground font-medium",
          !isSelected && "text-muted-foreground",
          isDraggable && "cursor-grab active:cursor-grabbing",
        )}
        // Indent-guide mode indents via the nested group's margin, so rows need
        // only a small constant inset; padding mode keeps the per-depth inset.
        style={{ paddingLeft: indentGuides ? "8px" : `${12 + depth * 12}px`, paddingRight: "8px" }}
        aria-current={isSelected ? "true" : undefined}
      >
        {isFolder && (
          <span
            aria-hidden="true"
            className="text-[10px] text-muted-foreground-subtle"
          >
            {expanded ? "▼" : "▶"}
          </span>
        )}
        {showIcons &&
          (isFolder ? (
            <FolderTypeIcon open={expanded} />
          ) : (
            <FileTypeIcon fileName={node.name} />
          ))}
        <span className={cn("truncate", isFolder && "font-medium text-foreground")}>
          {node.name}
        </span>
      </button>
      {isFolder && expanded && node.children && (
        <ul
          role="group"
          className={cn(indentGuides && "ml-3 border-l border-border")}
        >
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              selectedPath={selectedPath}
              onSelect={onSelect}
              onActivate={onActivate}
              depth={depth + 1}
              enableDrag={enableDrag}
              showIcons={showIcons}
              indentGuides={indentGuides}
              maxInitialDepth={maxInitialDepth}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
