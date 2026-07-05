"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@stigmer/theme";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";
import type {
  WorkspaceContentMatch,
  WorkspaceContentSearcher,
} from "./WorkspaceContentSearcher.js";
import type { OpenFileOptions } from "../internal/store/index.js";
import type { SelectedWorkspaceFile } from "../internal/store/workspace-file-selection-store.js";
import {
  useWorkspaceContentSearch,
  type WorkspaceContentSearchGroup,
} from "./useWorkspaceContentSearch.js";
import { findHighlightRanges } from "./matchContentPreview.js";

/** Cap on rendered line rows — keeps the DOM bounded on huge result sets. */
const MAX_RESULTS = 200;

/**
 * Minimum query length before searching. Kept in sync with the hook by being
 * passed in explicitly, and reused for the sub-min-length hint copy.
 */
const MIN_QUERY_LENGTH = 2;

/** Props for {@link WorkspaceContentSearch}. */
export interface WorkspaceContentSearchProps {
  /** All workspace entries to search across. */
  readonly entries: readonly WorkspaceEntry[];
  /** Platform-injected content searcher. `undefined` → content search is unavailable. */
  readonly searcher: WorkspaceContentSearcher | undefined;
  /**
   * Opens a result's file in the viewer, jumping to the matched line. The
   * `options.line` carries the hit's 1-based line so the viewer scrolls to and
   * highlights it (DR-1/DR-2).
   */
  readonly onOpenFile: (
    entryId: string,
    path: string,
    options?: OpenFileOptions,
  ) => void;
  /** The file currently open in the viewer, highlighted in the results. */
  readonly selectedFile?: SelectedWorkspaceFile | null;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/** A rendered line hit, carrying its owning entry and flat index for keyboard nav. */
interface FlatResult {
  readonly entryId: string;
  readonly match: WorkspaceContentMatch;
}

/**
 * Workspace-wide content (text) search surface.
 *
 * Greps file contents across every workspace entry (via
 * {@link useWorkspaceContentSearch}) and opens a hit's file in the viewer
 * through `onOpenFile` — the same seam a file-tree click and filename search
 * use. Results are a VS Code-style `file → line` layout: each matched file is a
 * header, each hit a line row with a line-number gutter and a highlighted
 * preview. Filename search lives in the sibling {@link WorkspaceFileSearch}; a
 * `Name | Text` toggle in the surface switches between them (DD-09).
 *
 * Keyboard/a11y mirrors the filename sibling (and `McpServerPicker`): the input
 * is a `role="combobox"` driving `aria-activedescendant`; results are a
 * `role="listbox"` of `role="option"` line rows; ArrowUp/Down move a virtual
 * focus over the flat line-hit index (across files and entries) with Enter to
 * open — focus stays in the input. All visual properties flow through `--stgm-*`
 * tokens (DD-005).
 */
export function WorkspaceContentSearch({
  entries,
  searcher,
  onOpenFile,
  selectedFile,
  className,
}: WorkspaceContentSearchProps) {
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const optionId = useCallback(
    (index: number) => `${listboxId}-opt-${index}`,
    [listboxId],
  );

  const { groups, totalMatches, isLoading, isRefetching, isUnsupported } =
    useWorkspaceContentSearch({
      entries,
      searcher,
      query,
      minLength: MIN_QUERY_LENGTH,
    });

  // Flat, capped view of every rendered line hit — the index space the keyboard
  // and `aria-activedescendant` share with the grouped render below.
  const flatResults = useMemo<readonly FlatResult[]>(() => {
    const flat: FlatResult[] = [];
    for (const group of groups) {
      for (const match of group.matches) {
        if (flat.length >= MAX_RESULTS) return flat;
        flat.push({ entryId: group.entry.id, match });
      }
    }
    return flat;
  }, [groups]);

  // A new query invalidates the previous virtual focus.
  useEffect(() => {
    setFocusIndex(-1);
  }, [query]);

  // Autofocus on mount — the user switched into Text search intending to type.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Keep the virtually-focused option in view (no-op where unsupported, e.g. tests).
  useEffect(() => {
    if (focusIndex < 0) return;
    const el =
      typeof document !== "undefined"
        ? document.getElementById(optionId(focusIndex))
        : null;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [focusIndex, optionId]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((prev) => (prev < flatResults.length - 1 ? prev + 1 : prev));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = flatResults[focusIndex];
        if (target)
          onOpenFile(target.entryId, target.match.path, {
            line: target.match.line,
          });
      }
    },
    [flatResults, focusIndex, onOpenFile],
  );

  const trimmed = query.trim();
  const belowMinLength = trimmed.length > 0 && trimmed.length < MIN_QUERY_LENGTH;
  const showEntryHeaders = groups.length > 1;

  // Screen-reader-only summary in a persistent polite live region: status swaps
  // (searching → results/none) happen across separate unmounting branches, so a
  // stable region is what actually gets announced. Terse by design.
  const statusMessage = isUnsupported
    ? ""
    : trimmed.length === 0
      ? ""
      : belowMinLength
        ? `Type at least ${MIN_QUERY_LENGTH} characters to search.`
        : isLoading
          ? "Searching file contents…"
          : groups.length === 0
            ? `No files containing ${trimmed}.`
            : totalMatches > flatResults.length
              ? `Showing the first ${flatResults.length} of ${totalMatches} matches.`
              : `${totalMatches} ${totalMatches === 1 ? "match" : "matches"}.`;

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div role="status" aria-live="polite" className="sr-only">
        {statusMessage}
      </div>
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listboxId}
          aria-activedescendant={focusIndex >= 0 ? optionId(focusIndex) : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search text in files…"
          disabled={isUnsupported}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-xs text-foreground",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none disabled:cursor-not-allowed",
          )}
          aria-label="Search text in workspace files"
        />
        {isRefetching && <Spinner />}
        {trimmed.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Clear search"
          >
            <ClearIcon />
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isUnsupported ? (
          <MessageState>Text search isn&rsquo;t available here.</MessageState>
        ) : trimmed.length === 0 ? (
          <MessageState>Search file contents across the whole workspace.</MessageState>
        ) : belowMinLength ? (
          <MessageState>
            Type at least {MIN_QUERY_LENGTH} characters to search.
          </MessageState>
        ) : isLoading ? (
          <MessageState>Searching…</MessageState>
        ) : groups.length === 0 ? (
          <MessageState>No files containing &ldquo;{trimmed}&rdquo;.</MessageState>
        ) : (
          <>
            <ul id={listboxId} role="listbox" aria-label="Search results" className="py-0.5">
              {renderRows({
                groups,
                query: trimmed,
                showEntryHeaders,
                selectedFile: selectedFile ?? null,
                focusIndex,
                optionId,
                onOpenFile,
              })}
            </ul>
            {totalMatches > flatResults.length && (
              <p className="border-t border-border px-3 py-1.5 text-[0.65rem] text-muted-foreground">
                Showing the first {flatResults.length} of {totalMatches} matches — refine
                your search to narrow the list.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result rows — a single pass that keeps the flat line-hit index aligned with
// `flatResults` (and thus keyboard focus / aria-activedescendant), rendering a
// VS Code-style entry → file → line hierarchy. Backend order (path, then line)
// makes each file's hits contiguous, so file headers fall out of a path change.
// ---------------------------------------------------------------------------

function renderRows({
  groups,
  query,
  showEntryHeaders,
  selectedFile,
  focusIndex,
  optionId,
  onOpenFile,
}: {
  readonly groups: readonly WorkspaceContentSearchGroup[];
  readonly query: string;
  readonly showEntryHeaders: boolean;
  readonly selectedFile: SelectedWorkspaceFile | null;
  readonly focusIndex: number;
  readonly optionId: (index: number) => string;
  readonly onOpenFile: (
    entryId: string,
    path: string,
    options?: OpenFileOptions,
  ) => void;
}) {
  const rows: ReactNode[] = [];
  let matchIndex = 0;

  for (const group of groups) {
    if (showEntryHeaders) {
      rows.push(<EntryHeader key={`entry:${group.entry.id}`} name={group.entry.name} />);
    }

    let currentPath: string | null = null;
    for (const match of group.matches) {
      if (matchIndex >= MAX_RESULTS) break;

      if (match.path !== currentPath) {
        currentPath = match.path;
        rows.push(<FileHeader key={`file:${group.entry.id}:${match.path}`} path={match.path} />);
      }

      const index = matchIndex++;
      const isOpen =
        selectedFile?.entryId === group.entry.id && selectedFile.path === match.path;
      rows.push(
        <LineRow
          key={`line:${group.entry.id}:${match.path}:${match.line}`}
          id={optionId(index)}
          match={match}
          query={query}
          isFocused={index === focusIndex}
          isOpen={isOpen}
          onOpen={() => onOpenFile(group.entry.id, match.path, { line: match.line })}
        />,
      );
    }

    if (group.truncated) {
      rows.push(
        <GroupNotice key={`t:${group.entry.id}`}>
          Partial results — more matches exist than shown for this workspace.
        </GroupNotice>,
      );
    }
    if (group.error) {
      rows.push(
        <GroupNotice key={`e:${group.entry.id}`} isError>
          Couldn&rsquo;t search: {group.error.message}
        </GroupNotice>,
      );
    }

    if (matchIndex >= MAX_RESULTS) break;
  }

  return rows;
}

function LineRow({
  id,
  match,
  query,
  isFocused,
  isOpen,
  onOpen,
}: {
  readonly id: string;
  readonly match: WorkspaceContentMatch;
  readonly query: string;
  readonly isFocused: boolean;
  readonly isOpen: boolean;
  readonly onOpen: () => void;
}) {
  // The `role="option"` IS the interactive leaf of the listbox (keyboard
  // activation flows through the combobox input's Enter handler +
  // aria-activedescendant). It must not nest another interactive control — a
  // button inside would violate WCAG 4.1.2 (axe `nested-interactive`). So the
  // click handler and row styling live on the option itself.
  return (
    <li
      id={id}
      role="option"
      aria-selected={isFocused}
      aria-current={isOpen ? "true" : undefined}
      onClick={onOpen}
      className={cn(
        "flex cursor-pointer items-baseline gap-2 py-0.5 pl-6 pr-3 text-xs transition-colors",
        isFocused && "bg-muted",
        isOpen && "bg-muted",
        !isFocused && !isOpen && "hover:bg-muted",
      )}
    >
      <span className="w-8 shrink-0 text-right font-mono text-[0.65rem] tabular-nums text-muted-foreground-subtle">
        {match.line}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
        <HighlightedPreview text={match.preview} query={query} />
      </span>
    </li>
  );
}

/**
 * Renders a preview line, emphasizing every case-insensitive occurrence of the
 * query. Offsets are re-derived from the text (the backend carries no column),
 * so highlighting is consistent with what the user sees.
 */
function HighlightedPreview({
  text,
  query,
}: {
  readonly text: string;
  readonly query: string;
}) {
  const ranges = findHighlightRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, i) => {
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(
      <span key={i} className="font-semibold text-foreground">
        {text.slice(range.start, range.end)}
      </span>,
    );
    cursor = range.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));

  return <>{parts}</>;
}

function EntryHeader({ name }: { readonly name: string }) {
  return (
    <li
      role="presentation"
      className="truncate px-3 pb-0.5 pt-2 text-[0.6rem] font-medium uppercase tracking-wide text-muted-foreground"
    >
      {name}
    </li>
  );
}

function FileHeader({ path }: { readonly path: string }) {
  const lastSlash = path.lastIndexOf("/");
  const basename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  const dir = lastSlash >= 0 ? path.slice(0, lastSlash) : "";

  return (
    <li
      role="presentation"
      className="flex items-baseline gap-1.5 px-3 pb-0.5 pt-1.5 text-xs"
    >
      <span className="shrink-0 font-medium text-foreground">{basename}</span>
      {dir && <span className="truncate text-[0.65rem] text-muted-foreground">{dir}</span>}
    </li>
  );
}

function GroupNotice({
  children,
  isError,
}: {
  readonly children: ReactNode;
  readonly isError?: boolean;
}) {
  return (
    <li
      role="presentation"
      className={cn(
        "px-3 py-1 text-[0.65rem]",
        isError ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {children}
    </li>
  );
}

function MessageState({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground" aria-hidden="true">
      <circle cx="5.25" cy="5.25" r="3.5" />
      <path d="M7.75 7.75L10.5 10.5" />
    </svg>
  );
}

function ClearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3L9 9M9 3L3 9" />
    </svg>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-3 w-3 shrink-0 animate-spin rounded-full border border-muted-foreground border-t-transparent"
    />
  );
}
