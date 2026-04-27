"use client";

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  type KeyboardEvent,
} from "react";
import type { ResourceRef } from "@stigmer/sdk";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { cn } from "@stigmer/theme";
import { useAgentSearch } from "./useAgentSearch";
import { useScrollShadows } from "../internal/useScrollShadows";
import { ScrollFade } from "../internal/ScrollFade";

/** Props for {@link AgentPicker}. */
export interface AgentPickerProps {
  /** Organization slug used as the default search scope. */
  readonly org: string;
  /** Currently selected agent reference, or null if none selected. */
  readonly value: ResourceRef | null;
  /** Called when the selection changes. Pass null to deselect. */
  readonly onChange: (ref: ResourceRef | null) => void;
  /** Called with the display name when an agent is selected (for chip rendering). */
  readonly onDisplayNameResolved?: (key: string, name: string) => void;
  /**
   * Controls search scope.
   *
   * - `"org"` — search only within the provided organization.
   * - `"all"` — search all organizations the caller can access,
   *   including public/platform agents from other orgs.
   *
   * @default "org"
   */
  readonly scope?: "org" | "all";
  /** Prevents interaction with the picker when `true`. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

function refKey(ref: ResourceRef): string {
  return `${ref.org}/${ref.slug}`;
}

const LIST_ID = "stgm-agent-list";

/**
 * Single-select searchable picker for choosing an agent from the platform.
 *
 * Renders a search input and scrollable list of available agents.
 * Designed to be placed inside a popover container — this component
 * renders the picker content, not the popover shell.
 *
 * Unlike the multi-select {@link SkillPicker} and McpServerPicker,
 * this picker enforces single selection: clicking a result replaces
 * the current selection. A session runs against exactly one agent.
 *
 * This is a Layer 1 building-block component used by both platform
 * builders (Profile A) and direct Stigmer users (Profile B). Platform
 * builders can use it standalone with their own popover or inline layout.
 * The Stigmer Console places it inside a `ContextPopover` within the
 * {@link SessionComposer}.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * // Platform builder: standalone agent picker
 * const [agent, setAgent] = useState<ResourceRef | null>(null);
 * <AgentPicker org="acme" value={agent} onChange={setAgent} />
 *
 * // Access the selected agent
 * if (agent) console.log(`Selected: ${agent.org}/${agent.slug}`);
 * ```
 */
export function AgentPicker({
  org,
  value,
  onChange,
  onDisplayNameResolved,
  scope,
  disabled,
  className,
}: AgentPickerProps) {
  const { results, isLoading, error, query, setQuery } = useAgentSearch(org, { scope });

  const [focusIndex, setFocusIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const { scrollRef: listRef, canScrollUp, canScrollDown } = useScrollShadows();

  const selectedKey = useMemo(
    () => (value ? refKey(value) : null),
    [value],
  );

  const availableResults = useMemo(
    () =>
      selectedKey
        ? results.filter((r) => `${r.org}/${r.slug}` !== selectedKey)
        : results,
    [results, selectedKey],
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
  }, [focusIndex, listRef]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      const ref: ResourceRef = {
        org: result.org,
        slug: result.slug,
        kind: ApiResourceKind.agent,
      };
      onChange(ref);
      onDisplayNameResolved?.(`${result.org}/${result.slug}`, result.name);
    },
    [onChange, onDisplayNameResolved],
  );

  const handleDeselect = useCallback(() => {
    onChange(null);
  }, [onChange]);

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
      {/* Selected agent */}
      {value && (
        <div className="space-y-1">
          <div className="text-[0.65rem] font-medium text-muted-foreground">
            Selected
          </div>
          <div className="flex items-center gap-2 rounded-md bg-muted-faint px-2 py-1 text-xs">
            <AgentIcon />
            <span className="min-w-0 flex-1 truncate text-foreground">
              {value.slug}
            </span>
            <button
              type="button"
              onClick={handleDeselect}
              disabled={disabled}
              className="shrink-0 text-muted-foreground hover:text-destructive disabled:pointer-events-none"
              aria-label={`Remove ${value.slug}`}
            >
              <XIcon />
            </button>
          </div>
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
          focusIndex >= 0 ? `stgm-agent-${focusIndex}` : undefined
        }
        placeholder="Search agents..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        disabled={disabled}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        autoFocus
      />

      {error && <p className="text-xs text-destructive">{error.message}</p>}

      {/* Scrollable results list */}
      <div className="relative">
        {canScrollUp && <ScrollFade position="top" />}

        <div
          ref={listRef}
          id={LIST_ID}
          role="listbox"
          aria-label="Agents"
          className="max-h-52 overflow-y-auto"
        >
          {isLoading ? (
            <LoadingSkeleton />
          ) : availableResults.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {query
                ? "No agents match your search"
                : value
                  ? "No other agents available"
                  : "No agents found"}
            </div>
          ) : (
            availableResults.map((result, idx) => (
              <button
                key={result.id}
                id={`stgm-agent-${idx}`}
                type="button"
                data-idx={idx}
                onClick={() => handleSelect(result)}
                disabled={disabled}
                className={cn(
                  "group flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  "disabled:pointer-events-none disabled:opacity-50",
                  idx === focusIndex
                    ? "bg-accent text-foreground"
                    : "text-foreground hover:bg-accent-hover",
                )}
                role="option"
                aria-selected={idx === focusIndex}
              >
                <span className="flex items-center gap-1.5">
                  <AgentIcon />
                  <span className="truncate font-medium">
                    <HighlightMatch text={result.name} query={query} />
                  </span>
                  <span className="ml-auto shrink-0 text-[0.6rem] text-muted-foreground">
                    {result.org}
                  </span>
                </span>
                {result.description && (
                  <span
                    className={cn(
                      "pl-5 text-[0.65rem] text-muted-foreground",
                      idx !== focusIndex &&
                        "line-clamp-2 group-hover:line-clamp-none",
                    )}
                  >
                    {result.description}
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        {canScrollDown && <ScrollFade position="bottom" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-semibold">
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-1 py-1">
      {[50, 65, 40, 58].map((w, i) => (
        <div key={i} className="flex flex-col gap-1 px-2 py-1.5">
          <div
            className="h-3 rounded bg-muted animate-pulse"
            style={{ width: `${w}%` }}
          />
          <div
            className="h-2 rounded bg-muted-subtle animate-pulse"
            style={{ width: `${Math.min(w + 15, 90)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function AgentIcon() {
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
      <rect x="3" y="5" width="10" height="8" rx="2" />
      <circle cx="6" cy="9" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="9" r="1" fill="currentColor" stroke="none" />
      <path d="M8 1v4" />
      <circle cx="8" cy="1" r="1" />
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
