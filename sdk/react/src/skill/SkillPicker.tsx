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
import { useSkillSearch } from "./useSkillSearch.js";
import { useScrollShadows } from "../internal/useScrollShadows.js";
import { ScrollFade } from "../internal/ScrollFade.js";
import { ScopeToggle } from "../library/ScopeToggle.js";
import type { ResourceListScope } from "../search/index.js";

/** Props for {@link SkillPicker}. */
export interface SkillPickerProps {
  /** Organization slug used as the default search scope. */
  readonly org: string;
  /**
   * Controls search scope.
   *
   * - `"org"` — search only within the provided organization.
   * - `"all"` — search all organizations the caller can access,
   *   including public/platform skills from other orgs.
   *
   * @default "org"
   */
  readonly scope?: "org" | "all";
  /** Currently selected skill references. */
  readonly value: ResourceRef[];
  /** Called when the selection changes. */
  readonly onChange: (refs: ResourceRef[]) => void;
  /** Called with the display name when an item is added (for chip rendering). */
  readonly onDisplayNameResolved?: (key: string, name: string) => void;
  /** Disables all interaction. */
  readonly disabled?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

function refKey(ref: ResourceRef): string {
  return `${ref.org}/${ref.slug}`;
}

const LIST_ID = "stgm-skill-list";

/**
 * Searchable picker for selecting skills from the platform.
 *
 * Renders a search input and scrollable list of available skills.
 * Designed to be placed inside a popover container — this component
 * renders the picker content, not the popover shell.
 *
 * Selected skills produce `ResourceRef[]` with `kind: skill`.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * function SkillSelector({ org }: { org: string }) {
 *   const [skills, setSkills] = useState<ResourceRef[]>([]);
 *
 *   return (
 *     <SkillPicker
 *       org={org}
 *       value={skills}
 *       onChange={setSkills}
 *     />
 *   );
 * }
 * ```
 */
export function SkillPicker({
  org,
  scope,
  value,
  onChange,
  onDisplayNameResolved,
  disabled,
  className,
}: SkillPickerProps) {
  const [activeScope, setActiveScope] = useState<ResourceListScope>(scope ?? "org");
  const { results, isLoading, error, query, setQuery } = useSkillSearch(org, { scope: activeScope });

  const [focusIndex, setFocusIndex] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const results_ = useScrollShadows();
  const selected_ = useScrollShadows();

  const selectedKeys = useMemo(
    () => new Set(value.map(refKey)),
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
      results_.scrollRef.current
        ?.querySelector(`[data-idx="${focusIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [focusIndex, results_.scrollRef]);

  const handleSelect = useCallback(
    (result: SearchResult) => {
      const ref: ResourceRef = {
        org: result.org,
        slug: result.slug,
        kind: ApiResourceKind.skill,
      };
      onChange([...value, ref]);
      onDisplayNameResolved?.(`${result.org}/${result.slug}`, result.name);
    },
    [value, onChange, onDisplayNameResolved],
  );

  const handleRemove = useCallback(
    (key: string) => {
      onChange(value.filter((r) => refKey(r) !== key));
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
          <div className="relative">
            {selected_.canScrollUp && <ScrollFade position="top" />}

            <div ref={selected_.scrollRef} className="max-h-28 space-y-1 overflow-y-auto">
              {value.map((ref) => {
                const key = refKey(ref);
                return (
                  <div
                    key={key}
                    className="flex items-center gap-2 rounded-md bg-muted-faint px-2 py-1 text-xs"
                  >
                    <SkillIcon />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {ref.slug}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemove(key)}
                      disabled={disabled}
                      className="shrink-0 text-muted-foreground hover:text-destructive disabled:pointer-events-none"
                      aria-label={`Remove ${ref.slug}`}
                    >
                      <XIcon />
                    </button>
                  </div>
                );
              })}
            </div>

            {selected_.canScrollDown && <ScrollFade position="bottom" />}
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
          focusIndex >= 0 ? `stgm-skill-${focusIndex}` : undefined
        }
        placeholder="Search skills..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleSearchKeyDown}
        disabled={disabled}
        className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        autoFocus
      />

      <ScopeToggle value={activeScope} onChange={setActiveScope} disabled={disabled} />

      {error && <p className="text-xs text-destructive">{error.message}</p>}

      {/* Scrollable results list */}
      <div className="relative">
        {results_.canScrollUp && <ScrollFade position="top" />}

        <div
          ref={results_.scrollRef}
          id={LIST_ID}
          role="listbox"
          aria-label="Skills"
          className="max-h-52 overflow-y-auto"
        >
          {isLoading ? (
            <LoadingSkeleton />
          ) : availableResults.length === 0 ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              {query
                ? "No skills match your search"
                : value.length > 0
                  ? "All available skills selected"
                  : "No skills found"}
            </div>
          ) : (
            availableResults.map((result, idx) => (
              <button
                key={result.id}
                id={`stgm-skill-${idx}`}
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
                  <SkillIcon />
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

        {results_.canScrollDown && <ScrollFade position="bottom" />}
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
      {[55, 70, 45, 62].map((w, i) => (
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

function SkillIcon() {
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
      <path d="M2 3h12M2 7h8M2 11h10M2 15h6" />
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
