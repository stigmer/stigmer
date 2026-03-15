"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Bot, Search, X, Loader2 } from "lucide-react";
import { useAgentSearch } from "@/hooks/useAgentSearch";
import { cn } from "@stigmer/theme";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SelectedAgent {
  id: string;
  name: string;
  qualifiedSlug: string;
  org: string;
  description: string;
}

export interface AgentPickerProps {
  onSelect: (agent: SelectedAgent) => void;
  onClear: () => void;
  selected: SelectedAgent | null;
  disabled?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AgentPicker({
  onSelect,
  onClear,
  selected,
  disabled = false,
  className,
}: AgentPickerProps) {
  const instanceId = useId();
  const listboxId = `${instanceId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);

  const { query, setQuery, results, isLoading, error } = useAgentSearch();
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);

  const showResults = isOpen && !selected;

  const handleSelect = useCallback(
    (index: number) => {
      const result = results[index];
      if (!result) return;
      onSelect({
        id: result.id,
        name: result.name,
        qualifiedSlug: result.qualifiedSlug,
        org: result.org,
        description: result.description,
      });
      setIsOpen(false);
      setActiveIndex(-1);
    },
    [results, onSelect],
  );

  const handleClear = useCallback(() => {
    onClear();
    setQuery("");
    setActiveIndex(-1);
    setIsOpen(true);
    // Re-focus the input after clearing so the user can immediately search.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [onClear, setQuery]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!showResults) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setActiveIndex((prev) =>
            prev < results.length - 1 ? prev + 1 : 0,
          );
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setActiveIndex((prev) =>
            prev > 0 ? prev - 1 : results.length - 1,
          );
          break;
        }
        case "Enter": {
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < results.length) {
            handleSelect(activeIndex);
          }
          break;
        }
        case "Escape": {
          e.preventDefault();
          setIsOpen(false);
          setActiveIndex(-1);
          break;
        }
      }
    },
    [showResults, results.length, activeIndex, handleSelect],
  );

  // ── Selected state ──
  if (selected) {
    return (
      <div className={cn("space-y-1", className)}>
        <label className="text-sm font-medium text-muted-foreground">
          Agent
        </label>
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-3 py-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Bot className="size-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{selected.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {selected.qualifiedSlug}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleClear}
            disabled={disabled}
            aria-label="Change agent"
            className="size-7 shrink-0"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Search state ──
  const activeOptionId =
    activeIndex >= 0 ? `${instanceId}-option-${activeIndex}` : undefined;

  return (
    <div className={cn("space-y-1", className)}>
      <label
        htmlFor={`${instanceId}-input`}
        className="text-sm font-medium text-muted-foreground"
      >
        Agent
      </label>

      <div className="relative">
        {/* Search input */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={inputRef}
            id={`${instanceId}-input`}
            type="text"
            role="combobox"
            aria-expanded={showResults}
            aria-controls={listboxId}
            aria-activedescendant={activeOptionId}
            aria-autocomplete="list"
            aria-label="Search agents"
            value={query}
            disabled={disabled}
            placeholder="Search agents..."
            className={cn(
              "w-full rounded-lg border bg-background py-2.5 pl-9 pr-9 text-sm",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(-1);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => {
              // Delay closing to allow click events on results to fire.
              setTimeout(() => setIsOpen(false), 150);
            }}
            onKeyDown={handleKeyDown}
          />
          {isLoading && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>

        {/* Results dropdown */}
        {showResults && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Agent search results"
            className={cn(
              "absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover shadow-md",
              results.length === 0 && !isLoading && "p-3",
            )}
          >
            {results.length === 0 && !isLoading && (
              <li className="text-center text-sm text-muted-foreground" role="presentation">
                {error ? error : query ? "No agents found" : "No agents available"}
              </li>
            )}

            {results.map((result, index) => (
              <li
                key={result.id}
                id={`${instanceId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  "flex cursor-pointer items-start gap-3 px-3 py-2.5",
                  "transition-colors",
                  index === activeIndex
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50",
                )}
                onMouseDown={(e) => {
                  // Prevent input blur from firing before selection completes.
                  e.preventDefault();
                }}
                onClick={() => handleSelect(index)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 mt-0.5">
                  <Bot className="size-3.5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{result.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {result.qualifiedSlug}
                  </p>
                  {result.description && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/70">
                      {result.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
