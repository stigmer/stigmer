"use client";

import { useCallback, useState, type KeyboardEvent } from "react";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
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
    <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
      {isCollapsible && (
        <ChevronIcon
          className={cn(
            "stg:size-3.5 stg:shrink-0 stg:text-muted-foreground stg:transition-transform",
            expanded && "stg:rotate-90",
          )}
        />
      )}
      <NodeIcon kind={node.kind} className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
      {!isRoot && (
        <span
          className={cn(
            "stg:shrink-0 stg:rounded stg:px-1.5 stg:py-px stg:text-[10px] stg:font-medium stg:leading-tight",
            kindBadgeClasses(node.kind),
          )}
        >
          {KIND_LABELS[node.kind]}
        </span>
      )}
      <span className="stg:min-w-0 stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
        {node.qualifiedLabel ?? node.label}
      </span>
      {node.metadata &&
        Object.entries(node.metadata).map(([key, value]) => (
          <span
            key={key}
            className="stg:shrink-0 stg:text-xs stg:text-muted-foreground"
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
        "stg:list-none",
        isChild && "stg:relative stg:before:absolute stg:before:left-[-12px] stg:before:top-[14px] stg:before:h-px stg:before:w-3 stg:before:bg-border stg:before:content-['']",
      )}
    >
      {isInteractive ? (
        <button
          type="button"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
          className={cn(
            "stg:flex stg:w-full stg:items-center stg:rounded-md stg:px-2 stg:py-1.5 stg:text-left stg:transition-colors",
            "stg:hover:bg-accent-hover",
            "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
          )}
        >
          {content}
        </button>
      ) : (
        <div className="stg:flex stg:items-center stg:px-2 stg:py-1.5">
          {content}
        </div>
      )}

      {node.description && !isRoot && (
        <p
          className={cn(
            "stg:px-2 stg:pb-1 stg:text-xs stg:text-muted-foreground",
            isCollapsible ? "stg:ml-[calc(0.5rem+14px+0.5rem)]" : "stg:ml-2",
          )}
        >
          {node.description}
        </p>
      )}

      {showChildren && (
        <ul
          role="group"
          className={cn(UNSTYLED_LIST, "stg:relative stg:ml-[11px] stg:border-l stg:border-border stg:pl-3")}
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
      return "stg:bg-[var(--stgm-status-running-subtle)] stg:text-[var(--stgm-status-running)]";
    case "skill":
      return "stg:bg-[var(--stgm-status-pending-subtle)] stg:text-[var(--stgm-status-pending)]";
    // Badges borrow status hues as category colors (skill=pending,
    // sub-agent=ready).
    case "sub-agent":
      return "stg:bg-[var(--stgm-status-ready-subtle)] stg:text-[var(--stgm-status-ready)]";
    case "agent":
      return "stg:bg-muted stg:text-muted-foreground";
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
