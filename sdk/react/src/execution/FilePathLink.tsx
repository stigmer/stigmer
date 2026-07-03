"use client";

import { useCallback, useContext, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { FilePathContext } from "./FilePathContext.js";
import { resolvePathAction, splitDisplayPath } from "./file-path-resolver.js";

/** How much of the directory prefix {@link FilePathLink} shows. */
export type FilePathDirDisplay =
  /** File name only — the default, for cramped surfaces (tool-call headers). */
  | "hide"
  /** Dimmed directory prefix + file name — for diff headers / file lists. */
  | "dim";

/** Props for {@link FilePathLink}. */
export interface FilePathLinkProps {
  /** The workspace-relative file path from the tool call. */
  readonly path: string;
  /**
   * How much of the directory prefix to show. Defaults to `"hide"` (file name
   * only); the full path is always available on hover via `title`. Use `"dim"`
   * where the surrounding directory aids comprehension (diff headers, the
   * multi-file changes list).
   */
  readonly dirDisplay?: FilePathDirDisplay;
  /** Additional CSS class names for the root element. */
  readonly className?: string;
}

const COPIED_FEEDBACK_MS = 2000;

/**
 * Interactive file path display that replaces inert `<span>` path
 * text in tool call rendering.
 *
 * **Filename-first.** It shows the base name prominently and never clips it;
 * the directory is optional (`dirDisplay`) and dimmed, and the *full* path is
 * always available on hover via `title` (and to screen readers via
 * `aria-label`). This fixes the prior behaviour, where a single `truncate` on
 * the whole path clipped the file name — the one part that identifies the
 * change — and surfaced only the action verb on hover.
 *
 * Resolves the path against workspace entries from {@link FilePathContext}:
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
 * <FilePathLink path="src/main.go" />              // shows "main.go"
 * <FilePathLink path="src/main.go" dirDisplay="dim" /> // shows "src/main.go"
 * ```
 */
export function FilePathLink({
  path,
  dirDisplay = "hide",
  className,
}: FilePathLinkProps) {
  const { workspaceEntries, onFilePathClick } = useContext(FilePathContext);
  const [copied, setCopied] = useState(false);

  const resolved = useMemo(
    () => resolvePathAction(path, workspaceEntries),
    [path, workspaceEntries],
  );

  const { dir, base } = useMemo(() => splitDisplayPath(path), [path]);

  // The full path shown on hover and announced to screen readers: the resolved
  // absolute path for a local source (the most useful form), else the logical
  // path. The action verb moves into the aria-label so hover surfaces the path,
  // not "Copy path".
  const fullPath = resolved.action === "copy" ? resolved.value : path;
  const title = fullPath;
  const ariaLabel = `${resolved.tooltip}: ${fullPath}`;

  const handleCopy = useCallback(() => {
    const value = resolved.action === "copy" ? resolved.value : path;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    });
  }, [resolved, path]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // The link often sits inside a row whose own click toggles disclosure
      // (ToolCallItem's role=button header); copying/opening a path must not
      // also expand the row.
      e.stopPropagation();

      // Offer the click to the injected handler first. It returns `false` to
      // DECLINE (e.g. an in-app viewer that can't open this particular path),
      // in which case we fall through to the default action below. A `true`/
      // `void` return means it fully handled the click.
      if (onFilePathClick) {
        const handled = onFilePathClick(path, resolved);
        if (handled !== false) {
          // For a link, also stop the browser from navigating (the file opened
          // in-app instead). A modifier/middle-click bypasses this onClick, so
          // the real <a href> still opens the target in a new tab.
          if (resolved.action === "link") e.preventDefault();
          return;
        }
      }

      if (resolved.action === "copy") {
        handleCopy();
      }
      // For a declined/un-handled "link", the <a>'s native navigation runs.
    },
    [onFilePathClick, path, resolved, handleCopy],
  );

  const sharedClasses = cn(
    "inline-flex min-w-0 items-center gap-1 font-mono text-foreground",
    "transition-colors hover:text-primary hover:underline",
    "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:rounded-sm",
    className,
  );

  // The directory truncates (it is context); the base never shrinks (it is
  // identity). Together they keep the file name legible at any width.
  const label = copied ? (
    <span className="min-w-0 truncate">Copied</span>
  ) : (
    <>
      {dirDisplay === "dim" && dir && (
        <span className="min-w-0 truncate text-muted-foreground-faint">{dir}</span>
      )}
      <span className="shrink-0">{base}</span>
    </>
  );

  // A link-action path always renders a real anchor — even when an
  // `onFilePathClick` handler is present — so native link affordances
  // (middle-click, open-in-new-tab, copy-link-address) survive. `handleClick`
  // intercepts a plain left-click to route it through the handler (e.g. into an
  // in-app viewer) and only calls `preventDefault` when the handler took it.
  if (resolved.action === "link") {
    return (
      <a
        href={resolved.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        aria-label={ariaLabel}
        title={title}
        className={cn(sharedClasses, "group/fpl")}
      >
        {label}
        <ExternalLinkIcon />
      </a>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel}
      title={title}
      className={cn(sharedClasses, "group/fpl cursor-pointer")}
    >
      {label}
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
