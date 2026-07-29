"use client";

import { useCallback, useState, type KeyboardEvent } from "react";
import { cn } from "@stigmer/theme";
import { DatastoreIcon } from "../datastore/DatastoreDetailView.js";
import type { DependencyNode, NodeKind } from "./types.js";

interface DependencyTreeNodeProps {
  readonly node: DependencyNode;
  readonly depth: number;
  readonly onNodeClick?: (node: DependencyNode) => void;
  readonly defaultExpanded: boolean;
}

const KIND_LABELS: Record<NodeKind, string> = {
  agent: "Agent",
  "mcp-server": "MCP",
  skill: "Skill",
  datastore: "Datastore",
  "sub-agent": "Sub-Agent",
};

/**
 * Renders a single node in the dependency tree: icon, kind badge,
 * label, metadata, and (for expandable nodes) an expand/collapse
 * chevron with nested children.
 *
 * Leaf nodes (MCP servers, skills) with a `ref` are clickable —
 * firing `onNodeClick` for consumer-wired navigation.
 *
 * Sub-agent nodes are collapsible containers, and the root agent
 * node always renders its children expanded. Both recurse using
 * the same component, keeping the ARIA tree structure correct
 * (`<li role="treeitem">` wrapping a nested `<ul role="group">`).
 */
export function DependencyTreeNode({
  node,
  depth,
  onNodeClick,
  defaultExpanded,
}: DependencyTreeNodeProps) {
  const hasChildren = node.children.length > 0;
  const isRoot = node.kind === "agent";
  const isCollapsible = node.kind === "sub-agent" && hasChildren;
  const isAlwaysExpanded = isRoot && hasChildren;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isNavigable = node.ref != null && onNodeClick != null;

  const showChildren = isAlwaysExpanded || (isCollapsible && expanded);

  const handleClick = useCallback(() => {
    if (isCollapsible) {
      setExpanded((v) => !v);
    } else if (isNavigable) {
      onNodeClick(node);
    }
  }, [isCollapsible, isNavigable, onNodeClick, node]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      if (!isCollapsible) return;

      if (e.key === "ArrowRight" && !expanded) {
        e.preventDefault();
        setExpanded(true);
      } else if (e.key === "ArrowLeft" && expanded) {
        e.preventDefault();
        setExpanded(false);
      }
    },
    [isCollapsible, expanded],
  );

  const content = (
    <div className="flex min-w-0 items-center gap-2">
      {isCollapsible && (
        <ChevronIcon
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
      )}
      <NodeIcon kind={node.kind} className="size-4 shrink-0 text-muted-foreground" />
      {!isRoot && (
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-px text-[10px] font-medium leading-tight",
            kindBadgeClasses(node.kind),
          )}
        >
          {KIND_LABELS[node.kind]}
        </span>
      )}
      <span className="min-w-0 truncate text-sm font-medium text-foreground">
        {node.qualifiedLabel ?? node.label}
      </span>
      {node.metadata &&
        Object.entries(node.metadata).map(([key, value]) => (
          <span
            key={key}
            className="shrink-0 text-xs text-muted-foreground"
          >
            {value}
          </span>
        ))}
    </div>
  );

  const isInteractive = isCollapsible || isNavigable;

  const isChild = depth > 0;

  return (
    <li
      role="treeitem"
      aria-expanded={isCollapsible ? expanded : isAlwaysExpanded ? true : undefined}
      className={cn(
        "list-none",
        isChild && "relative before:absolute before:left-[-12px] before:top-[14px] before:h-px before:w-3 before:bg-border before:content-['']",
      )}
    >
      {isInteractive ? (
        <button
          type="button"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
          className={cn(
            "flex w-full items-center rounded-md px-2 py-1.5 text-left transition-colors",
            "hover:bg-accent-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          )}
        >
          {content}
        </button>
      ) : (
        <div className="flex items-center px-2 py-1.5">
          {content}
        </div>
      )}

      {node.description && !isRoot && (
        <p
          className={cn(
            "px-2 pb-1 text-xs text-muted-foreground",
            isCollapsible ? "ml-[calc(0.5rem+14px+0.5rem)]" : "ml-2",
          )}
        >
          {node.description}
        </p>
      )}

      {showChildren && (
        <ul
          role="group"
          className="relative ml-[11px] border-l border-border pl-3"
        >
          {node.children.map((child) => (
            <DependencyTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onNodeClick={onNodeClick}
              defaultExpanded={defaultExpanded}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Kind badge styling — uses --stgm-* tokens, no hardcoded colors
// ---------------------------------------------------------------------------

function kindBadgeClasses(kind: NodeKind): string {
  switch (kind) {
    case "mcp-server":
      return "bg-[var(--stgm-status-running-subtle)] text-[var(--stgm-status-running)]";
    case "skill":
      return "bg-[var(--stgm-status-pending-subtle)] text-[var(--stgm-status-pending)]";
    // Badges borrow status hues as category colors (skill=pending,
    // sub-agent=ready); datastore takes the remaining distinct hue.
    case "datastore":
      return "bg-[var(--stgm-status-degraded-subtle)] text-[var(--stgm-status-degraded)]";
    case "sub-agent":
      return "bg-[var(--stgm-status-ready-subtle)] text-[var(--stgm-status-ready)]";
    case "agent":
      return "bg-muted text-muted-foreground";
  }
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs, consistent with AgentDetailView pattern
// ---------------------------------------------------------------------------

function NodeIcon({
  kind,
  className,
}: {
  readonly kind: NodeKind;
  readonly className?: string;
}) {
  switch (kind) {
    case "agent":
    case "sub-agent":
      return <AgentIcon className={className} />;
    case "mcp-server":
      return <McpServerIcon className={className} />;
    case "skill":
      return <SkillIcon className={className} />;
    case "datastore":
      return <DatastoreIcon className={className} />;
  }
}

function AgentIcon({ className }: { readonly className?: string }) {
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
      <rect x="3" y="5" width="10" height="8" rx="1.5" />
      <path d="M6 9h.01M10 9h.01" strokeWidth="2" />
      <path d="M8 2v3" />
    </svg>
  );
}

function McpServerIcon({ className }: { readonly className?: string }) {
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
      <rect x="2" y="2" width="12" height="5" rx="1" />
      <rect x="2" y="9" width="12" height="5" rx="1" />
      <circle cx="5" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SkillIcon({ className }: { readonly className?: string }) {
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
      <path d="M9 1.5 4 9h4l-1 5.5L12 7H8l1-5.5Z" />
    </svg>
  );
}

function ChevronIcon({ className }: { readonly className?: string }) {
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
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}
