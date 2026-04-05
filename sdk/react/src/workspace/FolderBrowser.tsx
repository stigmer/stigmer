"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type KeyboardEvent,
} from "react";
import { useFolderListing } from "./useFolderListing";

/** Props for {@link FolderBrowser}. */
export interface FolderBrowserProps {
  /** Called when the user confirms the selected directory. */
  readonly onSelect: (path: string) => void;
  /** Called when the user dismisses the browser. */
  readonly onCancel: () => void;
  /** Starting directory path. Defaults to CWD from the API. */
  readonly initialPath?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Styled component that renders a navigable filesystem browser for
 * selecting a local directory as a workspace entry.
 *
 * Features:
 * - Breadcrumb path bar (clickable segments, editable as text input)
 * - Directory listing with folder-first sorting
 * - Quick navigation: Home and CWD buttons
 * - Hidden files toggle
 * - Keyboard navigation (Arrow keys, Enter, Escape)
 * - Graceful degradation when the /api/fs/list endpoint is unavailable
 *
 * All visual properties flow through `--stgm-*` tokens.
 * No Console-specific dependencies.
 *
 * @example
 * ```tsx
 * <FolderBrowser
 *   onSelect={(path) => workspace.addLocalPath(path)}
 *   onCancel={() => setShowBrowser(false)}
 *   initialPath="/Users/dev/projects"
 * />
 * ```
 */
export function FolderBrowser({
  onSelect,
  onCancel,
  initialPath,
  className,
}: FolderBrowserProps) {
  const { listing, isLoading, error, isAvailable, browse, clearError } =
    useFolderListing(initialPath);

  const [showHidden, setShowHidden] = useState(false);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [editPath, setEditPath] = useState("");
  const [focusIndex, setFocusIndex] = useState(-1);

  const listRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const fallbackInputRef = useRef<HTMLInputElement>(null);
  const [fallbackPath, setFallbackPath] = useState("");

  const currentPath = listing?.path ?? initialPath ?? "";

  const visibleEntries = listing
    ? listing.entries.filter((e) => showHidden || !e.hidden)
    : [];
  const directories = visibleEntries.filter((e) => e.isDir);

  const navigateTo = useCallback(
    (path: string) => {
      setFocusIndex(-1);
      browse(path);
    },
    [browse],
  );

  const handleBreadcrumbClick = useCallback(
    (segmentIndex: number) => {
      const segments = currentPath.split("/").filter(Boolean);
      const targetPath = "/" + segments.slice(0, segmentIndex + 1).join("/");
      navigateTo(targetPath);
    },
    [currentPath, navigateTo],
  );

  const startPathEdit = useCallback(() => {
    setEditPath(currentPath);
    setIsEditingPath(true);
  }, [currentPath]);

  const commitPathEdit = useCallback(() => {
    setIsEditingPath(false);
    const trimmed = editPath.trim();
    if (trimmed && trimmed !== currentPath) {
      navigateTo(trimmed);
    }
  }, [editPath, currentPath, navigateTo]);

  const handlePathKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitPathEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setIsEditingPath(false);
      }
    },
    [commitPathEdit],
  );

  const handleListKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((prev) =>
          prev < directories.length - 1 ? prev + 1 : prev,
        );
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : prev));
        return;
      }

      if (e.key === "Enter" && focusIndex >= 0 && focusIndex < directories.length) {
        e.preventDefault();
        const entry = directories[focusIndex];
        navigateTo(joinPath(currentPath, entry.name));
        return;
      }

      if (e.key === "Backspace" && currentPath !== "/") {
        e.preventDefault();
        navigateTo(parentPath(currentPath));
      }
    },
    [onCancel, directories, focusIndex, currentPath, navigateTo],
  );

  useEffect(() => {
    if (focusIndex >= 0) {
      const el = listRef.current?.querySelector(
        `[data-index="${focusIndex}"]`,
      );
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [focusIndex]);

  useEffect(() => {
    if (isEditingPath) {
      pathInputRef.current?.focus();
      pathInputRef.current?.select();
    }
  }, [isEditingPath]);

  // Graceful fallback: if the endpoint is not available, show a text input.
  if (isAvailable === false) {
    return (
      <div className={["space-y-2", className].filter(Boolean).join(" ")}>
        <input
          ref={fallbackInputRef}
          type="text"
          placeholder="/path/to/project"
          value={fallbackPath}
          onChange={(e) => setFallbackPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && fallbackPath.trim()) {
              e.preventDefault();
              onSelect(fallbackPath.trim());
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => fallbackPath.trim() && onSelect(fallbackPath.trim())}
            disabled={!fallbackPath.trim()}
            className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    );
  }

  const pathSegments = currentPath.split("/").filter(Boolean);

  return (
    <div
      className={["space-y-2", className].filter(Boolean).join(" ")}
      onKeyDown={!isEditingPath ? handleListKeyDown : undefined}
    >
      {/* Breadcrumb / path editor */}
      <div className="flex items-center gap-1">
        {/* Quick nav: Home + CWD */}
        {listing && (
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={() => navigateTo(listing.home)}
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              aria-label="Go to home directory"
              title="Home"
            >
              <HomeIcon />
            </button>
            <button
              type="button"
              onClick={() => navigateTo(listing.cwd)}
              className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
              aria-label="Go to working directory"
              title="Working directory"
            >
              <TerminalIcon />
            </button>
          </div>
        )}

        {/* Breadcrumb path or text input */}
        <div className="min-w-0 flex-1">
          {isEditingPath ? (
            <input
              ref={pathInputRef}
              type="text"
              value={editPath}
              onChange={(e) => setEditPath(e.target.value)}
              onKeyDown={handlePathKeyDown}
              onBlur={commitPathEdit}
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          ) : (
            <button
              type="button"
              onClick={startPathEdit}
              className="flex w-full min-w-0 items-center gap-0.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent/50 transition-colors"
              aria-label="Edit path"
              title="Click to type a path"
            >
              <span
                className="cursor-pointer hover:text-foreground"
                onClick={(e) => {
                  e.stopPropagation();
                  navigateTo("/");
                }}
              >
                /
              </span>
              {pathSegments.map((seg, i) => (
                <span key={i} className="flex items-center gap-0.5 min-w-0">
                  <ChevronRightIcon />
                  <span
                    className={[
                      "truncate cursor-pointer hover:text-foreground",
                      i === pathSegments.length - 1
                        ? "text-foreground font-medium"
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleBreadcrumbClick(i);
                    }}
                  >
                    {seg}
                  </span>
                </span>
              ))}
            </button>
          )}
        </div>

        {/* Hidden files toggle */}
        <button
          type="button"
          onClick={() => setShowHidden((prev) => !prev)}
          className={[
            "shrink-0 rounded p-1 transition-colors",
            showHidden
              ? "text-foreground bg-accent"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
          ].join(" ")}
          aria-label={showHidden ? "Hide hidden files" : "Show hidden files"}
          title={showHidden ? "Hide hidden files" : "Show hidden files"}
        >
          <EyeIcon />
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-xs text-destructive">
          <span>{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 rounded-md px-2 py-0.5 text-[0.65rem] hover:bg-destructive/10 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Directory list */}
      <div
        ref={listRef}
        className="max-h-52 overflow-y-auto"
        role="listbox"
        aria-label="Directory contents"
        tabIndex={0}
      >
        {/* Parent directory link */}
        {currentPath !== "/" && !isLoading && (
          <button
            type="button"
            onClick={() => navigateTo(parentPath(currentPath))}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
            role="option"
            aria-selected={false}
          >
            <ParentDirIcon />
            <span>..</span>
          </button>
        )}

        {isLoading ? (
          <div className="space-y-1 py-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded-md px-2 py-1.5"
              >
                <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
                <div
                  className="h-3 rounded bg-muted animate-pulse"
                  style={{ width: `${40 + Math.random() * 40}%` }}
                />
              </div>
            ))}
          </div>
        ) : (
          <>
            {directories.map((entry, i) => (
              <button
                key={entry.name}
                type="button"
                data-index={i}
                onClick={() => navigateTo(joinPath(currentPath, entry.name))}
                onDoubleClick={() =>
                  onSelect(joinPath(currentPath, entry.name))
                }
                className={[
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors",
                  i === focusIndex
                    ? "bg-accent text-foreground"
                    : "text-foreground hover:bg-accent/50",
                ].join(" ")}
                role="option"
                aria-selected={i === focusIndex}
              >
                <FolderIcon />
                <span className="min-w-0 flex-1 truncate text-left">
                  {entry.name}
                </span>
              </button>
            ))}

            {/* Non-directory entries (dimmed) */}
            {visibleEntries
              .filter((e) => !e.isDir)
              .map((entry) => (
                <div
                  key={entry.name}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground/50"
                >
                  <FileIcon />
                  <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                </div>
              ))}

            {!isLoading &&
              directories.length === 0 &&
              visibleEntries.length === 0 && (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  Empty directory
                </div>
              )}
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-border/50 pt-2">
        <span className="truncate text-[0.6rem] text-muted-foreground">
          {currentPath}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSelect(currentPath)}
            disabled={!currentPath || isLoading}
            className="rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40"
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}

function joinPath(base: string, name: string): string {
  if (base === "/") return "/" + name;
  return base + "/" + name;
}

function parentPath(p: string): string {
  const segments = p.split("/").filter(Boolean);
  if (segments.length <= 1) return "/";
  return "/" + segments.slice(0, -1).join("/");
}

function HomeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 7L7 2.5L12 7" />
      <path d="M3.5 8V11.5H5.5V9H8.5V11.5H10.5V8" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 5L6 7L3.5 9" />
      <path d="M7.5 9.5H10.5" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 7C2.5 4.5 4.5 3 7 3C9.5 3 11.5 4.5 12.5 7C11.5 9.5 9.5 11 7 11C4.5 11 2.5 9.5 1.5 7Z" />
      <circle cx="7" cy="7" r="1.5" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 2L6.5 5L3.5 8" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1.5 3.5V11a1 1 0 001 1h9a1 1 0 001-1V5.5a1 1 0 00-1-1H7L5.5 3H2.5a1 1 0 00-1 .5z" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 1.5H8.5L11 4V12a.5.5 0 01-.5.5H3.5a.5.5 0 01-.5-.5V2a.5.5 0 01.5-.5z" />
      <path d="M8.5 1.5V4H11" />
    </svg>
  );
}

function ParentDirIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 10V4" />
      <path d="M4 6.5L7 3.5L10 6.5" />
    </svg>
  );
}
