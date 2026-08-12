"use client";

import { cn } from "@stigmer/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import type { VersionTimelineEntryProps } from "./types.js";

/**
 * A single row in a version timeline.
 *
 * Renders a version entry with: truncated hash badge, relative timestamp,
 * actor info, tag badge, "current" indicator, and git provenance link.
 * Supports keyboard activation and focus management.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 * Zero Console dependencies — safe for platform builder embedding.
 *
 * @example
 * ```tsx
 * <VersionTimelineEntry
 *   entry={version}
 *   isSelected={selectedId === version.id}
 *   onSelect={() => setSelectedId(version.id)}
 * />
 * ```
 */
export function VersionTimelineEntry({
  entry,
  isSelected,
  isCompareSource,
  isLast,
  onSelect,
  trailing,
}: VersionTimelineEntryProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.();
    }
  };

  return (
    <div
      role="listitem"
      aria-current={entry.isCurrent ? "true" : undefined}
      className="stg:relative stg:flex stg:gap-3"
    >
      {/* Timeline connector */}
      <div className="stg:flex stg:flex-col stg:items-center stg:pt-1">
        <div
          className={cn(
            "stg:size-2.5 stg:shrink-0 stg:rounded-full stg:border-2",
            entry.isCurrent
              ? "stg:border-primary stg:bg-primary"
              : isCompareSource
                ? "stg:border-primary stg:border-dashed stg:bg-background"
                : isSelected
                  ? "stg:border-primary stg:bg-background"
                  : "stg:border-border stg:bg-background",
          )}
          aria-hidden="true"
        />
        {!isLast && (
          <div className="stg:mt-1 stg:w-px stg:flex-1 stg:bg-border" aria-hidden="true" />
        )}
      </div>

      {/* Entry content */}
      <button
        type="button"
        onClick={onSelect}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        aria-selected={isSelected}
        className={cn(
          "stg:mb-4 stg:flex stg:min-w-0 stg:flex-1 stg:flex-col stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-2 stg:text-left stg:transition-colors",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          isCompareSource
            ? "stg:border stg:border-dashed stg:border-primary stg:bg-primary-subtle"
            : isSelected
              ? "stg:bg-accent-hover"
              : "stg:hover:bg-accent-hover",
        )}
      >
        {/* Top line: hash + tag + current badge */}
        <div className="stg:flex stg:items-center stg:gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <code className="stg:shrink-0 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-[11px] stg:font-medium stg:text-foreground" />
              }
            >
              {entry.label}
            </TooltipTrigger>
            <TooltipContent side="top" className="stg:break-all">
              {entry.id}
            </TooltipContent>
          </Tooltip>

          {isCompareSource && (
            <span className="stg:shrink-0 stg:rounded-full stg:bg-primary stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-primary-foreground">
              A
            </span>
          )}

          {entry.tag && (
            <span className="stg:shrink-0 stg:rounded-full stg:bg-primary-subtle stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-primary">
              {entry.tag}
            </span>
          )}

          {entry.isCurrent && (
            <span className="stg:shrink-0 stg:rounded-full stg:bg-status-ready-subtle stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-status-ready">
              current
            </span>
          )}

          {trailing && (
            <div className="stg:ml-auto stg:shrink-0">{trailing}</div>
          )}
        </div>

        {/* Second line: timestamp + actor */}
        <div className="stg:flex stg:items-center stg:gap-2 stg:text-xs stg:text-muted-foreground">
          <Tooltip>
            <TooltipTrigger render={<time dateTime={entry.timestamp.toISOString()} />}>
              {formatRelativeTime(entry.timestamp)}
            </TooltipTrigger>
            <TooltipContent side="top">
              {entry.timestamp.toLocaleString()}
            </TooltipContent>
          </Tooltip>

          {entry.actor && (
            <>
              <span aria-hidden="true">&middot;</span>
              <span className="stg:flex stg:items-center stg:gap-1">
                {entry.actor.avatar && (
                  <img
                    src={entry.actor.avatar}
                    alt=""
                    className="stg:size-3.5 stg:rounded-full"
                  />
                )}
                <span>{entry.actor.displayName || entry.actor.id}</span>
              </span>
            </>
          )}
        </div>

        {/* Optional sublabel (commit message) */}
        {entry.sublabel && (
          <p className="stg:text-xs stg:text-muted-foreground">
            {entry.sublabel}
          </p>
        )}

        {/* Git provenance */}
        {entry.gitProvenance && (
          <GitProvenanceRow provenance={entry.gitProvenance} />
        )}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Git provenance inline display
// ---------------------------------------------------------------------------

function GitProvenanceRow({
  provenance,
}: {
  readonly provenance: NonNullable<VersionTimelineEntryProps["entry"]["gitProvenance"]>;
}) {
  const repoUrl = normalizeGitUrl(provenance.remoteUrl);
  const truncatedCommit = provenance.commit.slice(0, 7);
  const commitUrl = repoUrl
    ? `${repoUrl}/commit/${provenance.commit}`
    : null;

  return (
    <div className="stg:flex stg:items-center stg:gap-1.5 stg:text-[11px] stg:text-muted-foreground">
      <GitIcon className="stg:size-3 stg:shrink-0" />
      {provenance.ref && (
        <span className="stg:font-medium">{provenance.ref}</span>
      )}
      {commitUrl ? (
        <a
          href={commitUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="stg:font-mono stg:text-primary stg:underline-offset-2 stg:hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {truncatedCommit}
        </a>
      ) : (
        <code className="stg:font-mono">{truncatedCommit}</code>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function normalizeGitUrl(url: string): string | null {
  if (!url) return null;
  const cleaned = url.replace(/\.git$/, "");
  if (cleaned.startsWith("https://") || cleaned.startsWith("http://")) {
    return cleaned;
  }
  const sshMatch = cleaned.match(/^(?:git@|ssh:\/\/)([^:/]+)[:/](.+)$/);
  if (sshMatch) {
    return `https://${sshMatch[1]}/${sshMatch[2]}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function GitIcon({ className }: { readonly className?: string }) {
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
      <circle cx="8" cy="4" r="2" />
      <circle cx="8" cy="12" r="2" />
      <path d="M8 6v4" />
    </svg>
  );
}
