"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Bot, Search, X, Loader2 } from "lucide-react";
import { cn } from "@stigmer/theme";
import { useAgentSearch, type AgentSearchResult } from "../hooks/useAgentSearch";

export interface SelectedAgent {
  id: string;
  name: string;
  qualifiedSlug: string;
  org: string;
  description: string;
}

export interface AgentPickerProps {
  org: string;
  onSelect: (agent: SelectedAgent) => void;
  onClear: () => void;
  selected: SelectedAgent | null;
  disabled?: boolean;
  className?: string;
}

export function AgentPicker({
  org,
  onSelect,
  onClear,
  selected,
  disabled = false,
  className,
}: AgentPickerProps) {
  const instanceId = useId();
  const listboxId = `${instanceId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);

  const { query, setQuery, results, isLoading, error } = useAgentSearch({ org });
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
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [onClear, setQuery]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!showResults) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
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

  if (selected) {
    return (
      <div className={cn("stgm-agent-picker space-y-1", className)}>
        <label className="text-muted-foreground text-sm font-medium">
          Agent
        </label>
        <div className="bg-muted/50 flex items-center gap-3 rounded-lg border px-3 py-2.5">
          <div className="bg-primary/10 flex size-8 shrink-0 items-center justify-center rounded-md">
            <Bot className="text-primary size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{selected.name}</p>
            <p className="text-muted-foreground truncate font-mono text-xs">
              {selected.qualifiedSlug}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            aria-label="Change agent"
            className={cn(
              "inline-flex size-7 shrink-0 items-center justify-center rounded-md",
              "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              "transition-colors focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  const activeOptionId =
    activeIndex >= 0 ? `${instanceId}-option-${activeIndex}` : undefined;

  return (
    <div className={cn("stgm-agent-picker space-y-1", className)}>
      <label
        htmlFor={`${instanceId}-input`}
        className="text-muted-foreground text-sm font-medium"
      >
        Agent
      </label>

      <div className="relative">
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
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
              "bg-background w-full rounded-lg border py-2.5 pr-9 pl-9 text-sm",
              "placeholder:text-muted-foreground",
              "focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(-1);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => {
              setTimeout(() => setIsOpen(false), 150);
            }}
            onKeyDown={handleKeyDown}
          />
          {isLoading && (
            <Loader2 className="text-muted-foreground absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
          )}
        </div>

        {showResults && (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Agent search results"
            className={cn(
              "bg-popover absolute z-popover mt-1 max-h-64 w-full overflow-y-auto rounded-lg border shadow-md",
              results.length === 0 && !isLoading && "p-3",
            )}
          >
            {results.length === 0 && !isLoading && (
              <li
                className="text-muted-foreground text-center text-sm"
                role="presentation"
              >
                {error
                  ? error
                  : query
                    ? "No agents found"
                    : "No agents available"}
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
                  e.preventDefault();
                }}
                onClick={() => handleSelect(index)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <div className="bg-primary/10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md">
                  <Bot className="text-primary size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{result.name}</p>
                  <p className="text-muted-foreground truncate font-mono text-xs">
                    {result.qualifiedSlug}
                  </p>
                  {result.description && (
                    <p className="text-muted-foreground/70 mt-0.5 line-clamp-1 text-xs">
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
