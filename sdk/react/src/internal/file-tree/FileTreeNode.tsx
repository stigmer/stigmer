"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import type { TreeNode } from "./tree-node";

export interface FileTreeNodeProps {
  readonly node: TreeNode;
  readonly selectedPath: string;
  readonly onSelect: (path: string) => void;
  readonly depth: number;
}

/**
 * Recursive tree-node renderer for a {@link TreeNode} hierarchy.
 *
 * Renders folders as expandable disclosure rows and files as selectable
 * leaf rows. Uses `role="treeitem"` / `role="group"` for a11y and
 * `--stgm-*` theme tokens for all visual properties.
 */
export function FileTreeNode({
  node,
  selectedPath,
  onSelect,
  depth,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = !!node.children;
  const isSelected = node.path === selectedPath;

  const handleClick = useCallback(() => {
    if (isFolder) {
      setExpanded((prev) => !prev);
    } else {
      onSelect(node.path);
    }
  }, [isFolder, node.path, onSelect]);

  return (
    <li role="treeitem" aria-expanded={isFolder ? expanded : undefined}>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "flex w-full items-center gap-1.5 px-3 py-1 text-left text-xs transition-colors",
          "hover:bg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          isSelected && !isFolder && "bg-muted text-foreground font-medium",
          !isSelected && "text-muted-foreground",
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
            />
          ))}
        </ul>
      )}
    </li>
  );
}
