"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type KeyboardEvent,
} from "react";
import type { McpServerUsageInput, ResourceRef } from "@stigmer/sdk";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useMcpServerSearch } from "./useMcpServerSearch";

export interface McpServerPickerProps {
  /** Organization slug to scope the search. */
  readonly org: string;
  /** Currently selected MCP server usages. */
  readonly value: McpServerUsageInput[];
  /** Called when the selection changes. */
  readonly onChange: (usages: McpServerUsageInput[]) => void;
  /** Called with the display name when an item is added (for chip rendering). */
  readonly onDisplayNameResolved?: (key: string, name: string) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

function refKey(ref: ResourceRef): string {
  return `${ref.org}/${ref.slug}`;
}

function usageKey(usage: McpServerUsageInput): string {
  return refKey(usage.mcpServerRef);
}

const LIST_ID = "stgm-mcp-list";

/**
 * Searchable picker for selecting MCP servers from the platform.
 *
 * Renders a search input and scrollable list of available MCP servers.
 * Designed to be placed inside a popover container — this component
 * renders the picker content, not the popover shell.
 *
 * Selected servers produce `McpServerUsageInput[]` with all tools
 * enabled (v1: no per-tool selection).
 *
 * All visual properties flow through `--stgm-*` tokens.
 */
export function McpServerPicker({
  org,
  value,
  onChange,
  onDisplayNameResolved,
  disabled,
  className,
}: McpServerPickerProps) {
  const { results, isLoading, error, query, setQuery } =
    useMcpServerSearch(org);

  const [focusIndex, setFocusIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const selectedKeys = useMemo(
    () => new Set(value.map(usageKey)),
    [value],
  );

  const availableResults = useMemo(
    () => results.filter((r) => !selectedKeys.has(`${r.org}/${r.slug}`)),
    [results, selectedKeys],
  );

  useEffect(() => {
    setFocusIndex(-1);
  }, [query]);

  useEffect(() => {
    if (focusIndex >= 0) {
      listRef.current
        ?.querySelector(`[data-idx="${focusIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [focusIndex]);

  const updateScrollShadows = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 0);
    setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.addEventListener("scroll", updateScrollShadows, { passive: true });
    updateScrollShadows();
    return () => el.removeEventListener("scroll", updateScrollShadows);
  }, [updateScrollShadows]);

  useEffect(() => {
    updateScrollShadows();
  }, [results, updateScrollShadows]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      const usage: McpServerUsageInput = {
        mcpServerRef: {
          org: result.org,
          slug: result.slug,
          kind: ApiResourceKind.mcp_server,
        },
      };
      onChange([...value, usage]);
      onDisplayNameResolved?.(`${result.org}/${result.slug}`, result.name);
    },
    [value, onChange, onDisplayNameResolved],
  );

  const handleRemove = useCallback(
    (key: string) => {
      onChange(value.filter((u) => usageKey(u) !== key));
    },
    [value, onChange],
  );

  const handleSearchKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIndex((prev) =>
          prev < availableResults.length - 1 ? prev + 1 : prev,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIndex((prev) => (prev > 0 ? prev - 1 : -1));
      } else if (
        e.key === "Enter" &&
        focusIndex >= 0 &&
        focusIndex < availableResults.length
      ) {
        e.preventDefault();
        handleSelect(availableResults[focusIndex]);
      } else if (e.key === "Enter") {
        e.preventDefault();
      }
    },
    [availableResults, focusIndex, handleSelect],
  );

  return (
    <div className={["space-y-2 w-72", className].filter(Boolean).join(" ")}>
      {/* Selected items */}
      {value.length > 0 && (
        <div className="space-y-1">
          <div className="text-[0.65rem] font-medium text-muted-foreground">
            Selected
          </div>
          {value.map((usage) => {
            const key = usageKey(usage);
            return (
              <div
                key={key}
                className="flex items-center gap-2 rounded-md bg-muted/30 px-2 py-1 text-xs"
              >
                <McpServerIcon />
                <span className="min-w-0 flex-1 truncate text-foreground">
                  {usage.mcpServerRef.slug}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemove(key)}
                  disabled={disabled}
                  className="shrink-0 text-muted-foreground hover:text-destructive disabled:pointer-events-none"
                  aria-label={`Remove ${usage.mcpServerRef.slug}`}
                >
                  <XIcon />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Search input */}
      <input
        ref={searchRef}
        type="text"
        role="combobox"
        aria-expanded={true}
        aria-controls={LIST_ID}
        aria-activedescendant={
          focusIndex >= 0 ? `stgm-mcp-${focusIndex}` : undefined
        }
        placeholder="Search MCP servers..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        disabled={disabled}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        autoFocus
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Scrollable results list */}
      <div className="relative">
        {canScrollUp && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-3"
            style={{
              background:
                "linear-gradient(to bottom, var(--color-popover, hsl(0 0% 9%)), transparent)",
            }}
          />
        )}

        <div
          ref={listRef}
          id={LIST_ID}
          role="listbox"
          aria-label="MCP Servers"
          className="max-h-52 overflow-y-auto"
        >
          {isLoading ? (
            <LoadingSkeleton />
          ) : availableResults.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {query
                ? "No MCP servers match your search"
                : value.length > 0
                  ? "All available servers selected"
                  : "No MCP servers found"}
            </div>
          ) : (
            availableResults.map((result, idx) => (
              <button
                key={result.id}
                id={`stgm-mcp-${idx}`}
                type="button"
                data-idx={idx}
                onClick={() => handleSelect(result)}
                disabled={disabled}
                className={[
                  "flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  "disabled:pointer-events-none disabled:opacity-50",
                  idx === focusIndex
                    ? "bg-accent text-foreground"
                    : "text-foreground hover:bg-accent/50",
                ].join(" ")}
                role="option"
                aria-selected={idx === focusIndex}
              >
                <span className="flex items-center gap-1.5">
                  <McpServerIcon />
                  <span className="truncate font-medium">
                    <HighlightMatch text={result.name} query={query} />
                  </span>
                  <span className="ml-auto shrink-0 text-[0.6rem] text-muted-foreground">
                    {result.org}
                  </span>
                </span>
                {result.description && (
                  <span className="line-clamp-1 pl-5 text-[0.65rem] text-muted-foreground">
                    {result.description}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {canScrollDown && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-3"
            style={{
              background:
                "linear-gradient(to top, var(--color-popover, hsl(0 0% 9%)), transparent)",
            }}
          />
        )}
      </div>
    </div>
  );
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-1 py-1">
      {[60, 75, 50, 68].map((w, i) => (
        <div key={i} className="flex flex-col gap-1 px-2 py-1.5">
          <div
            className="h-3 rounded bg-muted animate-pulse"
            style={{ width: `${w}%` }}
          />
          <div
            className="h-2 rounded bg-muted/60 animate-pulse"
            style={{ width: `${Math.min(w + 15, 90)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function McpServerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-muted-foreground"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="12" height="4" rx="1" />
      <rect x="2" y="10" width="12" height="4" rx="1" />
      <circle cx="5" cy="4" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 4L10 10M10 4L4 10" />
    </svg>
  );
}
