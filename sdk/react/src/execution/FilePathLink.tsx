"use client";

import { useCallback, useContext, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { FilePathContext } from "./FilePathContext";
import { resolvePathAction } from "./file-path-resolver";

export interface FilePathLinkProps {
  /** The workspace-relative file path from the tool call. */
  readonly path: string;
  readonly className?: string;
}

const COPIED_FEEDBACK_MS = 2000;

/**
 * Interactive file path display that replaces inert `<span>` path
 * text in tool call rendering.
 *
 * Resolves the path against workspace entries from
 * {@link FilePathContext}:
 *
 * - **Git source** → `<a>` that opens the file on GitHub in a new tab.
 * - **Local / platform / unresolvable** → `<button>` that copies the
 *   path to clipboard with inline "Copied" feedback.
 *
 * Platform builders can override the default behavior via the
 * `onFilePathClick` callback in {@link FilePathContext}.
 *
 * @example
 * ```tsx
 * <FilePathLink path="src/main.go" />
 * ```
 */
export function FilePathLink({ path, className }: FilePathLinkProps) {
  const { workspaceEntries, onFilePathClick } = useContext(FilePathContext);
  const [copied, setCopied] = useState(false);

  const resolved = useMemo(
    () => resolvePathAction(path, workspaceEntries),
    [path, workspaceEntries],
  );

  const handleCopy = useCallback(() => {
    const value = resolved.action === "copy" ? resolved.value : path;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    });
  }, [resolved, path]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (onFilePathClick) {
        e.preventDefault();
        onFilePathClick(path, resolved);
        return;
      }
      if (resolved.action === "copy") {
        handleCopy();
      }
      // For "link" action the <a> default navigation handles it.
    },
    [onFilePathClick, path, resolved, handleCopy],
  );

  const sharedClasses = cn(
    "inline-flex items-center gap-1 font-mono text-foreground",
    "transition-colors hover:text-primary hover:underline",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:rounded-sm",
    className,
  );

  if (resolved.action === "link" && !onFilePathClick) {
    return (
      <a
        href={resolved.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={resolved.tooltip}
        title={resolved.tooltip}
        className={cn(sharedClasses, "group/fpl")}
      >
        <span className="min-w-0 truncate">{path}</span>
        <ExternalLinkIcon />
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={resolved.tooltip}
      title={resolved.tooltip}
      className={cn(sharedClasses, "group/fpl cursor-pointer")}
    >
      <span className="min-w-0 truncate">{copied ? "Copied" : path}</span>
      {!copied && <CopyIcon />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons — SDK pattern (no external icon dependency)
// ---------------------------------------------------------------------------

function ExternalLinkIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-0 transition-opacity group-hover/fpl:opacity-70"
      aria-hidden="true"
    >
      <path d="M9 3L5 7" />
      <path d="M7 3H9V5" />
      <path d="M5 3H3.5C2.95 3 2.5 3.45 2.5 4V8.5C2.5 9.05 2.95 9.5 3.5 9.5H8C8.55 9.5 9 9.05 9 8.5V7" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 opacity-0 transition-opacity group-hover/fpl:opacity-70"
      aria-hidden="true"
    >
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <path d="M8 4V2.5C8 1.95 7.55 1.5 7 1.5H2.5C1.95 1.5 1.5 1.95 1.5 2.5V7C1.5 7.55 1.95 8 2.5 8H4" />
    </svg>
  );
}
