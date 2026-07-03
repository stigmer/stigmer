"use client";

import { cn } from "@stigmer/theme";
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
      className="relative flex gap-3"
    >
      {/* Timeline connector */}
      <div className="flex flex-col items-center pt-1">
        <div
          className={cn(
            "size-2.5 shrink-0 rounded-full border-2",
            entry.isCurrent
              ? "border-primary bg-primary"
              : isCompareSource
                ? "border-primary border-dashed bg-background"
                : isSelected
                  ? "border-primary bg-background"
                  : "border-border bg-background",
          )}
          aria-hidden="true"
        />
        {!isLast && (
          <div className="mt-1 w-px flex-1 bg-border" aria-hidden="true" />
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
          "mb-4 flex min-w-0 flex-1 flex-col gap-1 rounded-md px-2.5 py-2 text-left transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isCompareSource
            ? "border border-dashed border-primary bg-primary-subtle"
            : isSelected
              ? "bg-accent-hover"
              : "hover:bg-accent-hover",
        )}
      >
        {/* Top line: hash + tag + current badge */}
        <div className="flex items-center gap-2">
          <code
            className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground"
            title={entry.id}
          >
            {entry.label}
          </code>

          {isCompareSource && (
            <span className="shrink-0 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium text-primary-foreground">
              A
            </span>
          )}

          {entry.tag && (
            <span className="shrink-0 rounded-full bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {entry.tag}
            </span>
          )}

          {entry.isCurrent && (
            <span className="shrink-0 rounded-full bg-status-ready-subtle px-1.5 py-0.5 text-[10px] font-medium text-status-ready">
              current
            </span>
          )}

          {trailing && (
            <div className="ml-auto shrink-0">{trailing}</div>
          )}
        </div>

        {/* Second line: timestamp + actor */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <time
            dateTime={entry.timestamp.toISOString()}
            title={entry.timestamp.toLocaleString()}
          >
            {formatRelativeTime(entry.timestamp)}
          </time>

          {entry.actor && (
            <>
              <span aria-hidden="true">&middot;</span>
              <span className="flex items-center gap-1">
                {entry.actor.avatar && (
                  <img
                    src={entry.actor.avatar}
                    alt=""
                    className="size-3.5 rounded-full"
                  />
                )}
                <span>{entry.actor.displayName || entry.actor.id}</span>
              </span>
            </>
          )}
        </div>

        {/* Optional sublabel (commit message) */}
        {entry.sublabel && (
          <p className="text-xs text-muted-foreground">
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
    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <GitIcon className="size-3 shrink-0" />
      {provenance.ref && (
        <span className="font-medium">{provenance.ref}</span>
      )}
      {commitUrl ? (
        <a
          href={commitUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-primary underline-offset-2 hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {truncatedCommit}
        </a>
      ) : (
        <code className="font-mono">{truncatedCommit}</code>
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
