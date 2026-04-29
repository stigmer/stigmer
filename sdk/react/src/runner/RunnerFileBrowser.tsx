"use client";

import { useCallback, useMemo, useState, useRef, type KeyboardEvent } from "react";
import { getUserMessage } from "@stigmer/sdk";
import { useRunnerFileBrowser } from "./useRunnerFileBrowser";
import { useRecentWorkspaces, type RecentWorkspace } from "../workspace/useRecentWorkspaces";

/** Props for {@link RunnerFileBrowser}. */
export interface RunnerFileBrowserProps {
  /** ID of the runner whose filesystem to browse. */
  readonly runnerId: string;
  /** Called when the user confirms the current directory as workspace. */
  readonly onSelect: (absolutePath: string) => void;
  /** Called when the user dismisses the browser. */
  readonly onCancel: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * Display name of the runner (e.g. "dev-macbook").
   * Shown in the context header so users know which machine they're browsing.
   */
  readonly runnerName?: string;
  /**
   * Hostname of the runner's machine (e.g. "Alice's MacBook Pro").
   * Shown alongside the runner name in the context header.
   */
  readonly runnerHostname?: string;
}

/**
 * Styled component for browsing a runner's filesystem and selecting
 * a project directory as a workspace entry.
 *
 * Uses the runner's `ListDirectory` command (via `sendCommand`) to
 * fetch directory listings over the bidi stream. The user navigates
 * with breadcrumbs, shortcut buttons (Home, CWD), and click-to-enter
 * for directories.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <RunnerFileBrowser
 *   runnerId="runner-abc123"
 *   onSelect={(path) => workspace.addLocalPath(path)}
 *   onCancel={() => setShowBrowser(false)}
 * />
 * ```
 */
export function RunnerFileBrowser({
  runnerId,
  onSelect,
  onCancel,
  className,
  runnerName,
  runnerHostname,
}: RunnerFileBrowserProps) {
  const browser = useRunnerFileBrowser(runnerId);
  const recents = useRecentWorkspaces(runnerId);

  const handleSelect = useCallback(
    (path: string) => {
      recents.recordSelection(path);
      onSelect(path);
    },
    [recents, onSelect],
  );

  const [isEditingPath, setIsEditingPath] = useState(false);
  const [editPathValue, setEditPathValue] = useState("");
  const pathInputRef = useRef<HTMLInputElement>(null);

  const startEditingPath = useCallback(() => {
    setEditPathValue(browser.currentPath);
    setIsEditingPath(true);
    requestAnimationFrame(() => pathInputRef.current?.select());
  }, [browser.currentPath]);

  const commitPath = useCallback(() => {
    const trimmed = editPathValue.trim();
    if (trimmed && trimmed !== browser.currentPath) {
      browser.navigateToPath(trimmed);
    }
    setIsEditingPath(false);
  }, [editPathValue, browser]);

  const cancelEditing = useCallback(() => {
    setIsEditingPath(false);
  }, []);

  const handlePathKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitPath();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelEditing();
      }
    },
    [commitPath, cancelEditing],
  );

  const visibleEntries = useMemo(
    () =>
      browser.showHidden
        ? browser.entries
        : browser.entries.filter((e) => !e.isHidden),
    [browser.entries, browser.showHidden],
  );

  const directories = useMemo(
    () => visibleEntries.filter((e) => e.isDirectory),
    [visibleEntries],
  );

  const files = useMemo(
    () => visibleEntries.filter((e) => !e.isDirectory),
    [visibleEntries],
  );

  // --- Error state ---
  if (browser.error && !browser.currentPath) {
    return (
      <div className={["space-y-3", className].filter(Boolean).join(" ")}>
        <ErrorDisplay
          error={browser.error}
          onRetry={browser.retry}
          onCancel={onCancel}
        />
      </div>
    );
  }

  return (
    <div className={["space-y-2", className].filter(Boolean).join(" ")}>
      {/* Runner context header */}
      {(runnerName || runnerHostname) && (
        <div className="flex items-center gap-1.5 text-[0.65rem] text-muted-foreground">
          <ServerIcon />
          <span className="truncate">
            {runnerName ?? runnerHostname}
            {runnerName && runnerHostname && (
              <span className="text-border"> &middot; {runnerHostname}</span>
            )}
          </span>
        </div>
      )}

      {/* Recent / favorite paths */}
      {recents.entries.length > 0 && (
        <RecentPathsList
          entries={recents.entries}
          onSelect={(path) => {
            recents.recordSelection(path);
            onSelect(path);
          }}
          onTogglePin={recents.togglePin}
          onRemove={recents.remove}
          onNavigate={browser.navigateToPath}
        />
      )}

      {/* Navigation bar: shortcuts + breadcrumb */}
      <div className="space-y-1.5">
        {/* Shortcut buttons */}
        <div className="flex items-center gap-1">
          <ShortcutButton
            label="Home"
            icon={<HomeIcon />}
            onClick={browser.navigateHome}
            disabled={browser.isLoading}
          />
          {browser.currentDirectory && (
            <ShortcutButton
              label="CWD"
              icon={<TerminalIcon />}
              onClick={browser.navigateCwd}
              disabled={browser.isLoading}
            />
          )}
          {!browser.isAtRoot && (
            <ShortcutButton
              label="Up"
              icon={<ChevronUpIcon />}
              onClick={browser.navigateUp}
              disabled={browser.isLoading}
            />
          )}

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={browser.toggleHidden}
              className={[
                "rounded px-1.5 py-0.5 text-[0.6rem] transition-colors",
                browser.showHidden
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              ].join(" ")}
              title={browser.showHidden ? "Hide hidden files" : "Show hidden files"}
            >
              {browser.showHidden ? "Hide dotfiles" : "Show dotfiles"}
            </button>
          </div>
        </div>

        {/* Path bar — editable input or clickable breadcrumb */}
        {isEditingPath ? (
          <input
            ref={pathInputRef}
            type="text"
            value={editPathValue}
            onChange={(e) => setEditPathValue(e.target.value)}
            onKeyDown={handlePathKeyDown}
            onBlur={commitPath}
            className="w-full rounded-md border border-input bg-background px-2 py-1 text-[0.65rem] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="/path/to/directory or ~/relative"
            autoFocus
          />
        ) : browser.segments.length > 0 ? (
          <div className="flex items-center gap-0.5 overflow-x-auto text-[0.65rem] scrollbar-none">
            {browser.segments.map((seg, i) => {
              const isLast = i === browser.segments.length - 1;
              return (
                <span key={seg.path} className="flex shrink-0 items-center gap-0.5">
                  {i > 0 && <ChevronRightIcon />}
                  {isLast ? (
                    <span className="rounded px-1 py-0.5 font-medium text-foreground">
                      {seg.name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => browser.navigateToPath(seg.path)}
                      disabled={browser.isLoading}
                      className="rounded px-1 py-0.5 text-muted-foreground hover:text-foreground hover:bg-accent-hover transition-colors disabled:pointer-events-none"
                    >
                      {seg.name}
                    </button>
                  )}
                </span>
              );
            })}
            <button
              type="button"
              onClick={startEditingPath}
              className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent-hover transition-colors"
              title="Type a path directly"
              aria-label="Edit path"
            >
              <EditIcon />
            </button>
          </div>
        ) : null}
      </div>

      {/* Inline error banner (when we already have a current path) */}
      {browser.error && browser.currentPath && (
        <div className="flex items-center gap-2 rounded-md bg-destructive-subtle px-2.5 py-1.5 text-xs text-destructive">
          <span className="min-w-0 flex-1 truncate">
            {getUserMessage(browser.error)}
          </span>
          <button
            type="button"
            onClick={browser.retry}
            className="shrink-0 text-[0.6rem] font-medium hover:underline"
          >
            Retry
          </button>
        </div>
      )}

      {/* Directory listing */}
      <div
        className="max-h-56 overflow-y-auto rounded-md border border-border"
        role="listbox"
        aria-label="Directory contents"
      >
        {browser.isLoading ? (
          <LoadingSkeleton />
        ) : visibleEntries.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            This directory is empty
          </div>
        ) : (
          <>
            {directories.map((entry) => (
              <button
                key={entry.name}
                type="button"
                onClick={() => browser.navigateTo(entry.name)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent-hover"
                role="option"
                aria-selected={false}
              >
                <FolderIcon />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              </button>
            ))}
            {files.map((entry) => (
              <div
                key={entry.name}
                className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground"
              >
                <FileIcon />
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Actions: Select + Cancel */}
      <div className="flex items-center justify-between">
        <span
          className="min-w-0 flex-1 truncate text-[0.6rem] text-muted-foreground [direction:rtl] text-left"
          title={browser.currentPath}
        >
          <bdi>{browser.currentPath}</bdi>
        </span>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => handleSelect(browser.currentPath)}
            disabled={!browser.currentPath || browser.isLoading}
            className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary-hover transition-colors disabled:opacity-40"
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error display (initial load failure)
// ---------------------------------------------------------------------------

function ErrorDisplay({
  error,
  onRetry,
  onCancel,
}: {
  error: Error;
  onRetry: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-3 py-2 text-center">
      <div className="space-y-1">
        <p className="text-xs font-medium text-destructive">
          Could not browse runner filesystem
        </p>
        <p className="text-[0.65rem] text-muted-foreground">
          {getUserMessage(error)}
        </p>
      </div>
      <div className="flex justify-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary-hover transition-colors"
        >
          Retry
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent paths list
// ---------------------------------------------------------------------------

function RecentPathsList({
  entries,
  onSelect,
  onTogglePin,
  onRemove,
  onNavigate,
}: {
  entries: readonly RecentWorkspace[];
  onSelect: (path: string) => void;
  onTogglePin: (path: string) => void;
  onRemove: (path: string) => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="space-y-1">
      <span className="text-[0.6rem] font-medium text-muted-foreground">
        Recent
      </span>
      <div className="max-h-24 overflow-y-auto rounded-md border border-border">
        {entries.map((entry) => {
          const dirName = entry.path.split("/").filter(Boolean).pop() ?? entry.path;
          return (
            <div
              key={entry.path}
              className="group flex items-center gap-1.5 px-2 py-1 text-xs transition-colors hover:bg-accent-hover"
            >
              <button
                type="button"
                onClick={() => onTogglePin(entry.path)}
                className={[
                  "shrink-0 transition-colors",
                  entry.pinned
                    ? "text-foreground"
                    : "text-transparent group-hover:text-muted-foreground",
                ].join(" ")}
                title={entry.pinned ? "Unpin" : "Pin"}
                aria-label={entry.pinned ? `Unpin ${dirName}` : `Pin ${dirName}`}
              >
                <PinIcon />
              </button>
              <button
                type="button"
                onClick={() => onSelect(entry.path)}
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-foreground"
                title={`Select ${entry.path}`}
              >
                <FolderIcon />
                <span className="truncate [direction:rtl] text-left">
                  <bdi>{entry.path}</bdi>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate(entry.path)}
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                title="Browse this directory"
                aria-label={`Browse ${dirName}`}
              >
                <ChevronRightIcon />
              </button>
              <button
                type="button"
                onClick={() => onRemove(entry.path)}
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                title="Remove from recent"
                aria-label={`Remove ${dirName} from recent`}
              >
                <XSmallIcon />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shortcut button
// ---------------------------------------------------------------------------

function ShortcutButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[0.65rem] text-muted-foreground hover:text-foreground hover:bg-accent-hover transition-colors disabled:pointer-events-none disabled:opacity-50"
      title={label}
    >
      {icon}
      <span className="max-sm:hidden">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="space-y-0.5 p-1">
      {[60, 45, 72, 38, 55, 50].map((w, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <div className="h-3.5 w-3.5 shrink-0 rounded bg-muted animate-pulse" />
          <div
            className="h-3 rounded bg-muted animate-pulse"
            style={{ width: `${w}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, consistent with existing SDK icon patterns)
// ---------------------------------------------------------------------------

function EditIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.5 1.5L10.5 3.5L4 10H2V8L8.5 1.5Z" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" stroke="none">
      <path d="M7.5 1.5L10.5 4.5L8 7L9 10L6 7L2 11L5 3L4.5 1.5L7.5 1.5Z" />
    </svg>
  );
}

function XSmallIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" />
    </svg>
  );
}

function ServerIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <rect x="1.5" y="1.5" width="9" height="3.5" rx="0.5" />
      <rect x="1.5" y="7" width="9" height="3.5" rx="0.5" />
      <circle cx="3.5" cy="3.25" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="3.5" cy="8.75" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5.5L6 2L10 5.5V10a.5.5 0 01-.5.5h-2V8a.5.5 0 00-.5-.5H5a.5.5 0 00-.5.5v2.5h-2A.5.5 0 012 10V5.5z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 3.5L5 6L2.5 8.5M6.5 8.5H9.5" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7.5L6 4.5L9 7.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-border">
      <path d="M3 1.5L5.5 4L3 6.5" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M1.5 3.5V11a1 1 0 001 1h9a1 1 0 001-1V5.5a1 1 0 00-1-1H7L5.5 3H2.5a1 1 0 00-1 .5z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M8 1.5H4a1 1 0 00-1 1v9a1 1 0 001 1h6a1 1 0 001-1V4.5L8 1.5z" />
      <path d="M8 1.5V4.5H11" />
    </svg>
  );
}
