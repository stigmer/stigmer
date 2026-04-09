"use client";

import { useCallback, useId, useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { DiscoveredTool } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import type { ToolApprovalPolicy } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { useScrollShadows } from "../internal/useScrollShadows";
import { ScrollFade } from "../internal/ScrollFade";

/** Props for {@link McpToolSelector}. */
export interface McpToolSelectorProps {
  /** Discovered tools from `status.discovered_capabilities.tools`. */
  readonly tools: DiscoveredTool[];
  /** Approval policies from `status.tool_approvals` and `spec.pinned_tool_approvals`. */
  readonly toolApprovals: ToolApprovalPolicy[];
  /** Currently enabled tool names (controlled). */
  readonly enabledTools: string[];
  /** Called when the set of enabled tools changes. */
  readonly onChange: (enabledTools: string[]) => void;
  /** Disables all interaction. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Checklist of discovered MCP server tools with approval policy badges.
 *
 * Renders one checkbox row per tool with the tool name, a one-line
 * description, and an "Approval" badge for tools that have an entry
 * in `toolApprovals`. The header shows the tool count and compact
 * "All" / "None" bulk-selection shortcuts.
 *
 * This is a **pure presentational component** — it has no knowledge
 * of the setup hook, personal environments, or session creation.
 * State is fully controlled via `enabledTools` and `onChange`.
 *
 * When `tools` is empty (capabilities not yet discovered), the
 * component renders an informational empty state. The caller is
 * responsible for deciding whether to render the selector at all.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <McpToolSelector
 *   tools={entry.discoveredTools}
 *   toolApprovals={entry.toolApprovals}
 *   enabledTools={entry.enabledTools}
 *   onChange={(tools) => setEnabledTools(serverRef, tools)}
 * />
 * ```
 */
export function McpToolSelector({
  tools,
  toolApprovals,
  enabledTools,
  onChange,
  disabled,
  className,
}: McpToolSelectorProps) {
  const instanceId = useId();
  const list = useScrollShadows();

  const approvalsByTool = useMemo(
    () => new Map(toolApprovals.map((p) => [p.toolName, p.message])),
    [toolApprovals],
  );

  const enabledSet = useMemo(() => new Set(enabledTools), [enabledTools]);

  const handleToggle = useCallback(
    (toolName: string) => {
      const next = enabledSet.has(toolName)
        ? enabledTools.filter((n) => n !== toolName)
        : [...enabledTools, toolName];
      onChange(next);
    },
    [enabledSet, enabledTools, onChange],
  );

  const handleSelectAll = useCallback(() => {
    onChange(tools.map((t) => t.name));
  }, [tools, onChange]);

  const handleSelectNone = useCallback(() => {
    onChange([]);
  }, [onChange]);

  if (tools.length === 0) {
    return (
      <div className={cn("space-y-1", className)}>
        <div className="text-[0.65rem] font-medium text-muted-foreground">
          Tools
        </div>
        <div className="rounded-md border border-border px-3 py-4 text-center">
          <p className="text-xs text-muted-foreground">
            Tools have not been discovered yet.
          </p>
          <p className="mt-1 text-[0.65rem] text-muted-foreground/70">
            All tools will be enabled by default.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[0.65rem] font-medium text-muted-foreground">
          Tools ({tools.length})
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={disabled}
            className={cn(
              "rounded px-1.5 py-0.5 text-[0.6rem] font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={handleSelectNone}
            disabled={disabled}
            className={cn(
              "rounded px-1.5 py-0.5 text-[0.6rem] font-medium",
              "text-muted-foreground hover:text-foreground hover:bg-accent/50",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            None
          </button>
        </span>
      </div>

      {/* Tool list */}
      <div className="relative">
        {list.canScrollUp && <ScrollFade position="top" />}

        <div
          ref={list.scrollRef}
          role="group"
          aria-label="MCP server tools"
          className="max-h-52 space-y-0.5 overflow-y-auto"
        >
          {tools.map((tool) => {
            const checkboxId = `${instanceId}-tool-${tool.name}`;
            const descId = tool.description
              ? `${checkboxId}-desc`
              : undefined;
            const approvalMessage = approvalsByTool.get(tool.name);
            const isEnabled = enabledSet.has(tool.name);

            return (
              <div
                key={tool.name}
                className={cn(
                  "group rounded-md px-2 py-1.5 transition-colors",
                  isEnabled ? "bg-accent/30" : "hover:bg-accent/20",
                )}
              >
                <label
                  htmlFor={checkboxId}
                  className="flex cursor-pointer items-start gap-2"
                >
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => handleToggle(tool.name)}
                    disabled={disabled}
                    aria-describedby={descId}
                    className="mt-0.5 size-3 shrink-0 accent-primary disabled:pointer-events-none disabled:opacity-50"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-mono text-xs text-foreground">
                        {tool.name}
                      </span>
                      {approvalMessage !== undefined && (
                        <ApprovalBadge message={approvalMessage} />
                      )}
                    </span>
                    {tool.description && (
                      <span
                        id={descId}
                        className="line-clamp-2 group-hover:line-clamp-none group-focus-within:line-clamp-none text-[0.65rem] leading-relaxed text-muted-foreground"
                      >
                        {tool.description}
                      </span>
                    )}
                  </span>
                </label>
              </div>
            );
          })}
        </div>

        {list.canScrollDown && <ScrollFade position="bottom" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal components
// ---------------------------------------------------------------------------

function ApprovalBadge({ message }: { readonly message: string }) {
  const resolvedTitle = message || "This tool requires approval before execution";

  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[0.6rem] font-medium leading-none bg-warning/15 text-warning"
      title={resolvedTitle}
    >
      <ShieldIcon />
      Approval
    </span>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 1.5L2.5 4v4c0 3.5 2.5 5.5 5.5 7 3-1.5 5.5-3.5 5.5-7V4L8 1.5z" />
    </svg>
  );
}
