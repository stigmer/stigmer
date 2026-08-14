"use client";

import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { WorkspaceSource } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { TruncatedText } from "../internal/truncated-text.js";

/** Props for {@link WorkspaceSummary}. */
export interface WorkspaceSummaryProps {
  /** Session-level workspace entries. Renders nothing when empty. */
  readonly entries: readonly WorkspaceEntry[];
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Compact, read-only display of workspace entries showing each
 * entry's name and source (git repository URL or local path).
 *
 * This is the display-only counterpart to {@link WorkspaceEditor},
 * designed for contexts where workspace data is shown but not edited
 * (e.g., execution detail views, session summaries).
 *
 * Renders its content without card chrome (no border, background, or
 * elevation). The consumer controls the container styling.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const { session } = useSession(sessionId);
 *
 * <WorkspaceSummary
 *   entries={session?.spec?.workspaceEntries ?? []}
 * />
 * ```
 */
export function WorkspaceSummary({
  entries,
  className,
}: WorkspaceSummaryProps) {
  if (entries.length === 0) return null;

  return (
    <ul className={cn(UNSTYLED_LIST, "stg:space-y-1.5", className)} aria-label="Workspace entries">
      {entries.map((entry) => (
        <li key={entry.name} className="stg:text-xs">
          <div className="stg:flex stg:items-center stg:gap-1.5 stg:font-medium">
            <FolderIcon />
            <span className="stg:truncate">{entry.name}</span>
          </div>
          <SourceLabel source={entry.source} />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Internal sub-components
// ---------------------------------------------------------------------------

function SourceLabel({ source }: { source?: WorkspaceSource }) {
  if (!source || source.source.case === undefined) return null;

  if (source.source.case === "gitRepo") {
    const url = source.source.value.url;
    const short = url
      .replace(/^https?:\/\//, "")
      .replace(/\.git$/, "");
    // The cell shows the shortened form but the tooltip restores the full
    // URL (protocol and .git suffix), so this is a hover-always hint, not an
    // overflow-gated TruncatedText.
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="stg:ml-5 stg:block stg:truncate stg:text-muted-foreground" />
          }
        >
          {short}
        </TooltipTrigger>
        <TooltipContent side="top" className="stg:break-all">
          {url}
        </TooltipContent>
      </Tooltip>
    );
  }

  if (source.source.case === "localPath") {
    const path = source.source.value.path;
    return (
      <TruncatedText
        text={path}
        className="stg:ml-5 stg:block stg:font-mono stg:text-muted-foreground"
      />
    );
  }

  return null;
}

function FolderIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 3V9.5a1 1 0 001 1h7a1 1 0 001-1V4.5a1 1 0 00-1-1H6L4.5 2H2.5a1 1 0 00-1 1z" />
    </svg>
  );
}
