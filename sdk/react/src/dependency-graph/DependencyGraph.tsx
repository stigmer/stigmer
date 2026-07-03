"use client";

import { useCallback, useRef, type KeyboardEvent } from "react";
import { cn } from "@stigmer/theme";
import type { DependencyGraphProps } from "./types.js";
import { DependencyTreeNode } from "./DependencyTreeNode.js";

/**
 * Accessible CSS-based tree visualization of an agent's dependencies.
 *
 * Renders `MCP Servers`, `Skills`, and `Sub-Agents` (with recursive
 * sub-agent children) as a nested tree with visual connector lines.
 * The root node represents the agent itself.
 *
 * Implements the WAI-ARIA TreeView pattern:
 * - `role="tree"` on the root list
 * - `role="treeitem"` on each node (via {@link DependencyTreeNode})
 * - Arrow-key navigation between visible nodes (roving tabindex)
 * - `Home`/`End` to jump to first/last visible node
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * const { tree } = useDependencyGraph({
 *   agentName: "pr-review-agent",
 *   agentOrg: "acme",
 *   spec: agent.spec,
 * });
 *
 * {tree && (
 *   <DependencyGraph
 *     tree={tree}
 *     onNodeClick={(node) => {
 *       if (node.kind === "mcp-server") navigateTo(`/mcp-servers/${node.ref!.slug}`);
 *     }}
 *   />
 * )}
 * ```
 */
export function DependencyGraph({
  tree,
  onNodeClick,
  defaultExpanded = true,
  className,
}: DependencyGraphProps) {
  const treeRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLUListElement>) => {
      const container = treeRef.current;
      if (!container) return;

      const items = Array.from(
        container.querySelectorAll<HTMLElement>(
          "[role='treeitem'] > button, [role='treeitem'] > div",
        ),
      ).filter((el) => {
        let parent = el.closest("[role='treeitem']")?.parentElement?.closest("[role='treeitem']");
        while (parent) {
          if (parent.getAttribute("aria-expanded") === "false") return false;
          parent = parent.parentElement?.closest("[role='treeitem']");
        }
        return true;
      });

      if (items.length === 0) return;

      const activeEl = document.activeElement as HTMLElement | null;
      const currentIndex = activeEl ? items.indexOf(activeEl) : -1;

      let nextIndex: number | null = null;

      switch (e.key) {
        case "ArrowDown":
          nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
          break;
        case "ArrowUp":
          nextIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
          break;
        case "Home":
          nextIndex = 0;
          break;
        case "End":
          nextIndex = items.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      items[nextIndex].focus();
    },
    [],
  );

  const { root } = tree;

  return (
    <div className={cn("py-2", className)}>
      <div className="mb-3 flex items-center gap-2 px-2">
        <TreeIcon className="size-4 text-muted-foreground" />
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Dependency Tree
        </h3>
        <span className="text-xs text-muted-foreground">
          {tree.nodeCount} {tree.nodeCount === 1 ? "node" : "nodes"}
        </span>
      </div>

      <ul
        ref={treeRef}
        role="tree"
        aria-label={`Dependencies of ${root.label}`}
        onKeyDown={handleKeyDown}
        className="rounded-lg border border-border p-2"
      >
        <DependencyTreeNode
          node={root}
          depth={0}
          onNodeClick={onNodeClick}
          defaultExpanded={defaultExpanded}
        />
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header icon
// ---------------------------------------------------------------------------

function TreeIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2v4M8 6 4 10M8 6l4 4" />
      <circle cx="8" cy="2" r="1" fill="currentColor" stroke="none" />
      <circle cx="4" cy="11" r="1.5" />
      <circle cx="8" cy="11" r="1.5" />
      <circle cx="12" cy="11" r="1.5" />
    </svg>
  );
}
