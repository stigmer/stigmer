"use client";

import { useCallback, useId, useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { DiscoveredTool } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import type { ToolApprovalPolicy } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { useScrollShadows } from "../internal/useScrollShadows.js";
import { ScrollFade } from "../internal/ScrollFade.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";

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
      <div className={cn("stg:space-y-1", className)}>
        <div className="stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground">
          Tools
        </div>
        <div className="stg:rounded-md stg:border stg:border-border stg:px-3 stg:py-4 stg:text-center">
          <p className="stg:text-xs stg:text-muted-foreground">
            Tools have not been discovered yet.
          </p>
          <p className="stg:mt-1 stg:text-[0.65rem] stg:text-muted-foreground-subtle">
            All tools will be enabled by default.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("stg:space-y-1.5", className)}>
      {/* Header */}
      <div className="stg:flex stg:items-center stg:justify-between">
        <span className="stg:text-[0.65rem] stg:font-medium stg:text-muted-foreground">
          Tools ({tools.length})
        </span>
        <span className="stg:flex stg:items-center stg:gap-1">
          <button
            type="button"
            onClick={handleSelectAll}
            disabled={disabled}
            className={cn(
              "stg:rounded stg:px-1.5 stg:py-0.5 stg:text-[0.6rem] stg:font-medium",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={handleSelectNone}
            disabled={disabled}
            className={cn(
              "stg:rounded stg:px-1.5 stg:py-0.5 stg:text-[0.6rem] stg:font-medium",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            None
          </button>
        </span>
      </div>

      {/* Tool list */}
      <div className="stg:relative">
        {list.canScrollUp && <ScrollFade position="top" />}

        <div
          ref={list.scrollRef}
          role="group"
          aria-label="MCP server tools"
          className="stg:max-h-52 stg:space-y-0.5 stg:overflow-y-auto"
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
                  "stg:group stg:rounded-md stg:px-2 stg:py-1.5 stg:transition-colors",
                  isEnabled ? "stg:bg-accent-hover" : "stg:hover:bg-accent-hover",
                )}
              >
                <label
                  htmlFor={checkboxId}
                  className="stg:flex stg:cursor-pointer stg:items-start stg:gap-2"
                >
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => handleToggle(tool.name)}
                    disabled={disabled}
                    aria-describedby={descId}
                    className="stg:mt-0.5 stg:size-3 stg:shrink-0 stg:accent-primary stg:disabled:pointer-events-none stg:disabled:opacity-50"
                  />
                  <span className="stg:min-w-0 stg:flex-1">
                    <span className="stg:flex stg:items-center stg:gap-1.5">
                      <span className="stg:truncate stg:font-mono stg:text-xs stg:text-foreground">
                        {tool.name}
                      </span>
                      {approvalMessage !== undefined && (
                        <ApprovalBadge message={approvalMessage} />
                      )}
                    </span>
                    {tool.description && (
                      <span
                        id={descId}
                        className="stg:line-clamp-2 stg:group-hover:line-clamp-none stg:group-focus-within:line-clamp-none stg:text-[0.65rem] stg:leading-relaxed stg:text-muted-foreground"
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
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="stg:inline-flex stg:shrink-0 stg:items-center stg:gap-0.5 stg:rounded stg:px-1 stg:py-0.5 stg:text-[0.6rem] stg:font-medium stg:leading-none stg:bg-warning/15 stg:text-warning" />
        }
      >
        <ShieldIcon />
        Approval
      </TooltipTrigger>
      <TooltipContent side="top">{resolvedTitle}</TooltipContent>
    </Tooltip>
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
