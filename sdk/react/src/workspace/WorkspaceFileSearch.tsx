"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { cn } from "@stigmer/theme";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";
import type { WorkspaceFileLister } from "./WorkspaceFileLister.js";
import type { SelectedWorkspaceFile } from "../internal/store/workspace-file-selection-store.js";
import {
  useWorkspaceFileSearch,
  type WorkspaceFileSearchGroup,
} from "./useWorkspaceFileSearch.js";
import type { WorkspaceFileMatch } from "./matchWorkspaceFiles.js";

/** Cap on rendered rows — keeps the DOM bounded on huge repositories. */
const MAX_RESULTS = 200;

/** Props for {@link WorkspaceFileSearch}. */
export interface WorkspaceFileSearchProps {
  /** All workspace entries to search across. */
  readonly entries: readonly WorkspaceEntry[];
  /** Platform-injected file lister. `undefined` → search is unavailable. */
  readonly lister: WorkspaceFileLister | undefined;
  /** Opens a result in the viewer. */
  readonly onOpenFile: (entryId: string, path: string) => void;
  /** The file currently open in the viewer, highlighted in the results. */
  readonly selectedFile?: SelectedWorkspaceFile | null;
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/** A rendered result, carrying its owning entry and flat index for keyboard nav. */
interface FlatResult {
  readonly entryId: string;
  readonly entry: WorkspaceEntry;
  readonly match: WorkspaceFileMatch;
}

/**
 * Workspace-wide filename/path search surface.
 *
 * Searches the already-loaded listings across every workspace entry (via
 * {@link useWorkspaceFileSearch}) and opens a hit in the viewer through
 * `onOpenFile` — the same seam a file-tree click uses. Filename-first by design;
 * content search is a separate substrate-specific capability (DD-09).
 *
 * Keyboard/a11y follows the platform's combobox+listbox pattern (see
 * `mcp-server/McpServerPicker`): the input is a `role="combobox"` driving
 * `aria-activedescendant`, results are a `role="listbox"` of `role="option"`
 * rows, and ArrowUp/Down move a virtual focus with Enter to open — focus stays
 * in the input. All visual properties flow through `--stgm-*` tokens (DD-005).
 */
export function WorkspaceFileSearch({
  entries,
  lister,
  onOpenFile,
  selectedFile,
  className,
}: WorkspaceFileSearchProps) {
  const [query, setQuery] = useState("");
  const [focusIndex, setFocusIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const optionId = useCallback(
    (index: number) => `${listboxId}-opt-${index}`,
    [listboxId],
  );

  const { groups, totalMatches, isLoading, isUnsupported } =
    useWorkspaceFileSearch({ entries, lister, query });

  // Flat, capped view of every rendered match — the index space the keyboard
  // and `aria-activedescendant` share with the grouped render below.
  const flatResults = useMemo<readonly FlatResult[]>(() => {
    const flat: FlatResult[] = [];
    for (const group of groups) {
      for (const match of group.matches) {
        if (flat.length >= MAX_RESULTS) return flat;
        flat.push({ entryId: group.entry.id, entry: group.entry, match });
      }
    }
    return flat;
  }, [groups]);

  // A new query invalidates the previous virtual focus.
  useEffect(() => {
    setFocusIndex(-1);
  }, [query]);

  // Autofocus on mount — the user switched into Search intending to type.
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
        setFocusIndex((prev) =>
          prev < flatResults.length - 1 ? prev + 1 : prev,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = flatResults[focusIndex];
        if (target) onOpenFile(target.entryId, target.match.path);
      }
    },
    [flatResults, focusIndex, onOpenFile],
  );

  const trimmed = query.trim();
  const showGroupHeaders = groups.length > 1;

  // A concise, screen-reader-only summary of the current result state. It lives
  // in a persistent polite live region (below) so status changes are announced
  // even as the visible states — which live in separate, unmounting branches —
  // swap. Deliberately terse: never the result list itself, only its shape.
  const statusMessage = isUnsupported
    ? ""
    : trimmed.length === 0
      ? ""
      : isLoading && totalMatches === 0 && groups.length === 0
        ? "Searching files…"
        : groups.length === 0
          ? `No files matching ${trimmed}.`
          : totalMatches > flatResults.length
            ? `Showing the first ${flatResults.length} of ${totalMatches} matching files.`
            : `${flatResults.length} matching ${flatResults.length === 1 ? "file" : "files"}.`;

  return (
    <div className={cn("stg:flex stg:h-full stg:flex-col", className)}>
      <div role="status" aria-live="polite" className="stg:sr-only">
        {statusMessage}
      </div>
      <div className="stg:flex stg:items-center stg:gap-1.5 stg:border-b stg:border-border stg:px-2 stg:py-1.5">
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listboxId}
          aria-activedescendant={
            focusIndex >= 0 ? optionId(focusIndex) : undefined
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search files by name…"
          disabled={isUnsupported}
          className={cn(
            "stg:min-w-0 stg:flex-1 stg:bg-transparent stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:disabled:cursor-not-allowed",
          )}
          aria-label="Search workspace files by name"
        />
        {trimmed.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="stg:shrink-0 stg:text-muted-foreground stg:transition-colors stg:hover:text-foreground"
            aria-label="Clear search"
          >
            <ClearIcon />
          </button>
        )}
      </div>

      <div className="stg:min-h-0 stg:flex-1 stg:overflow-y-auto">
        {isUnsupported ? (
          <MessageState>File search isn&rsquo;t available here.</MessageState>
        ) : trimmed.length === 0 ? (
          <MessageState>
            Search files by name across the whole workspace.
          </MessageState>
        ) : isLoading && totalMatches === 0 && groups.length === 0 ? (
          <MessageState>Searching…</MessageState>
        ) : groups.length === 0 ? (
          <MessageState>
            No files matching &ldquo;{trimmed}&rdquo;.
          </MessageState>
        ) : (
          <>
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Search results"
              className="stg:py-0.5"
            >
              {renderRows({
                groups,
                showGroupHeaders,
                selectedFile: selectedFile ?? null,
                focusIndex,
                optionId,
                onOpenFile,
              })}
            </ul>
            {totalMatches > flatResults.length && (
              <p className="stg:border-t stg:border-border stg:px-3 stg:py-1.5 stg:text-[0.65rem] stg:text-muted-foreground">
                Showing the first {flatResults.length} of {totalMatches} matches
                — refine your search to narrow the list.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result rows — a single pass over groups that keeps the flat match index
// aligned with `flatResults` (and thus keyboard focus / aria-activedescendant).
// ---------------------------------------------------------------------------

function renderRows({
  groups,
  showGroupHeaders,
  selectedFile,
  focusIndex,
  optionId,
  onOpenFile,
}: {
  readonly groups: readonly WorkspaceFileSearchGroup[];
  readonly showGroupHeaders: boolean;
  readonly selectedFile: SelectedWorkspaceFile | null;
  readonly focusIndex: number;
  readonly optionId: (index: number) => string;
  readonly onOpenFile: (entryId: string, path: string) => void;
}) {
  const rows: React.ReactNode[] = [];
  let matchIndex = 0;

  for (const group of groups) {
    if (showGroupHeaders) {
      rows.push(<GroupHeader key={`h:${group.entry.id}`} name={group.entry.name} />);
    }

    for (const match of group.matches) {
      if (matchIndex >= MAX_RESULTS) break;
      const index = matchIndex++;
      const isOpen =
        selectedFile?.entryId === group.entry.id &&
        selectedFile.path === match.path;
      rows.push(
        <ResultRow
          key={`${group.entry.id}:${match.path}`}
          id={optionId(index)}
          match={match}
          isFocused={index === focusIndex}
          isOpen={isOpen}
          onOpen={() => onOpenFile(group.entry.id, match.path)}
        />,
      );
    }

    if (group.truncated) {
      rows.push(
        <GroupNotice key={`t:${group.entry.id}`}>
          Partial listing — too many files to search in full.
        </GroupNotice>,
      );
    }
    if (group.error) {
      rows.push(
        <GroupNotice key={`e:${group.entry.id}`} isError>
          Couldn&rsquo;t list files: {group.error.message}
        </GroupNotice>,
      );
    }

    if (matchIndex >= MAX_RESULTS) break;
  }

  return rows;
}

function ResultRow({
  id,
  match,
  isFocused,
  isOpen,
  onOpen,
}: {
  readonly id: string;
  readonly match: WorkspaceFileMatch;
  readonly isFocused: boolean;
  readonly isOpen: boolean;
  readonly onOpen: () => void;
}) {
  const lastSlash = match.path.lastIndexOf("/");
  const basename = match.path.slice(lastSlash + 1);
  const dir = lastSlash >= 0 ? match.path.slice(0, lastSlash) : "";

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
        "stg:flex stg:cursor-pointer stg:items-baseline stg:gap-1.5 stg:px-3 stg:py-1 stg:text-xs stg:transition-colors",
        isFocused && "stg:bg-muted",
        isOpen && "stg:bg-muted stg:font-medium stg:text-foreground",
        !isFocused && !isOpen && "stg:hover:bg-muted",
      )}
    >
      <span className="stg:truncate stg:text-foreground">
        <HighlightedPath
          text={basename}
          offset={lastSlash + 1}
          matchStart={match.matchStart}
          matchEnd={match.matchEnd}
        />
      </span>
      {dir && (
        <span className="stg:truncate stg:text-[0.65rem] stg:text-muted-foreground">
          <HighlightedPath
            text={dir}
            offset={0}
            matchStart={match.matchStart}
            matchEnd={match.matchEnd}
          />
        </span>
      )}
    </li>
  );
}

/**
 * Renders a slice of the path (`text`, starting at `offset` within the full
 * path), emphasizing the intersection with the match range `[matchStart,
 * matchEnd)`. Non-overlapping slices render plain.
 */
function HighlightedPath({
  text,
  offset,
  matchStart,
  matchEnd,
}: {
  readonly text: string;
  readonly offset: number;
  readonly matchStart: number;
  readonly matchEnd: number;
}) {
  const localStart = Math.max(0, matchStart - offset);
  const localEnd = Math.min(text.length, matchEnd - offset);

  if (localStart >= localEnd) return <>{text}</>;

  return (
    <>
      {text.slice(0, localStart)}
      <span className="stg:font-semibold stg:text-foreground">
        {text.slice(localStart, localEnd)}
      </span>
      {text.slice(localEnd)}
    </>
  );
}

function GroupHeader({ name }: { readonly name: string }) {
  return (
    <li
      role="presentation"
      className="stg:truncate stg:px-3 stg:pb-0.5 stg:pt-2 stg:text-[0.6rem] stg:font-medium stg:uppercase stg:tracking-wide stg:text-muted-foreground"
    >
      {name}
    </li>
  );
}

function GroupNotice({
  children,
  isError,
}: {
  readonly children: React.ReactNode;
  readonly isError?: boolean;
}) {
  return (
    <li
      role="presentation"
      className={cn(
        "stg:px-3 stg:py-1 stg:text-[0.65rem]",
        isError ? "stg:text-destructive" : "stg:text-muted-foreground",
      )}
    >
      {children}
    </li>
  );
}

function MessageState({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="stg:flex stg:h-full stg:items-center stg:justify-center stg:p-8 stg:text-center stg:text-xs stg:text-muted-foreground">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline SVG icons (SDK independence — no lucide dependency)
// ---------------------------------------------------------------------------

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="stg:shrink-0 stg:text-muted-foreground" aria-hidden="true">
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
