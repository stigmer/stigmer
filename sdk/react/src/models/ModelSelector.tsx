"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/theme";
import { useModelRegistry } from "./useModelRegistry";
import { modelKey, parseModelKey, type ModelInfo, type CostTier } from "./registry";
import { HARNESS_LABELS, type HarnessOption } from "./harness";

const COST_TIER_LABEL: Record<CostTier, string> = {
  economy: "$",
  standard: "$$",
  premium: "$$$",
};

/** Props for {@link ModelSelector}. */
export interface ModelSelectorProps {
  /** Currently selected compound key (`"native/claude-sonnet-4.6"`) or plain `modelId`. */
  readonly value?: string;
  /** Called when the user picks a different model. Receives the `modelId`. */
  readonly onValueChange: (modelId: string) => void;
  /**
   * When provided, restricts the catalog to a single harness (backward compat).
   * When omitted, shows the unified picker with models from both engines.
   */
  readonly harness?: HarnessOption;
  /**
   * Fires when the selected model belongs to a different harness than
   * the previous selection. Only relevant in unified mode (no `harness` prop).
   */
  readonly onHarnessResolved?: (harness: HarnessOption) => void;
  /** Additional CSS class names for the trigger button. */
  readonly className?: string;
  /** When true, disables the selector. */
  readonly disabled?: boolean;
}

/**
 * Cursor-style model picker: a flat searchable list inside a popover.
 *
 * Shows a curated list of featured models by default. The user can
 * expand via "Show All Models" or type to search the full catalog.
 *
 * Each model row shows the display name, an engine tag
 * ("Stigmer" / "Cursor"), and a cost-tier indicator.
 *
 * In unified mode (no `harness` prop), selecting a model implicitly
 * resolves the harness via {@link ModelSelectorProps.onHarnessResolved}.
 *
 * @example
 * ```tsx
 * <ModelSelector
 *   value={selectedModelId}
 *   onValueChange={setSelectedModelId}
 *   onHarnessResolved={setHarness}
 * />
 * ```
 */
export function ModelSelector({
  value,
  onValueChange,
  harness,
  onHarnessResolved,
  className,
  disabled,
}: ModelSelectorProps) {
  const isUnified = harness === undefined;
  const { models, featured, defaultModel, getModel, getByKey } = useModelRegistry(
    isUnified ? undefined : { harness },
  );

  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const resolveSelected = useCallback((): ModelInfo | undefined => {
    if (!value) return undefined;
    if (isUnified) {
      const byKey = getByKey(value);
      if (byKey) return byKey;
    }
    return getModel(value);
  }, [value, isUnified, getByKey, getModel]);

  const selectedModel = resolveSelected() ?? defaultModel;

  const isSearching = searchQuery.length > 0;
  const lowerQuery = searchQuery.toLowerCase();

  const visibleModels: readonly ModelInfo[] = useMemo(() => {
    if (isSearching) {
      return models.filter((m) =>
        m.displayName.toLowerCase().includes(lowerQuery)
        || m.modelId.toLowerCase().includes(lowerQuery)
        || HARNESS_LABELS[m.harness].toLowerCase().includes(lowerQuery),
      );
    }
    if (showAll) return models;
    return featured.length > 0 ? featured : models;
  }, [models, featured, isSearching, showAll, lowerQuery]);

  useEffect(() => {
    setHighlightIdx(-1);
  }, [visibleModels]);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setShowAll(false);
      setHighlightIdx(-1);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const selectModel = useCallback(
    (model: ModelInfo) => {
      const key = isUnified ? modelKey(model.harness, model.modelId) : model.modelId;
      onValueChange(key);
      if (isUnified && onHarnessResolved && model.harness !== selectedModel?.harness) {
        onHarnessResolved(model.harness);
      }
      setOpen(false);
    },
    [isUnified, onValueChange, onHarnessResolved, selectedModel],
  );

  const scrollHighlightIntoView = useCallback((idx: number) => {
    const container = listRef.current;
    if (!container) return;
    const items = container.querySelectorAll<HTMLElement>("[data-model-option]");
    items[idx]?.scrollIntoView({ block: "nearest" });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const len = visibleModels.length;
      if (len === 0) return;

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = highlightIdx < len - 1 ? highlightIdx + 1 : 0;
          setHighlightIdx(next);
          scrollHighlightIntoView(next);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = highlightIdx > 0 ? highlightIdx - 1 : len - 1;
          setHighlightIdx(prev);
          scrollHighlightIntoView(prev);
          break;
        }
        case "Enter": {
          e.preventDefault();
          const target = highlightIdx >= 0 ? visibleModels[highlightIdx] : visibleModels[0];
          if (target) selectModel(target);
          break;
        }
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [visibleModels, highlightIdx, selectModel, scrollHighlightIntoView],
  );

  const showShowAllButton = !isSearching && !showAll && featured.length > 0 && featured.length < models.length;

  const triggerLabel = selectedModel.displayName;
  const triggerHarness = isUnified ? HARNESS_LABELS[selectedModel.harness] : undefined;
  const triggerCost = COST_TIER_LABEL[selectedModel.costTier];

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border",
          "bg-background px-2.5 py-1.5 text-xs text-foreground",
          "hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          "transition-colors max-w-[18rem] max-sm:max-w-[10rem]",
          className,
        )}
      >
        <span className="truncate">{triggerLabel}</span>
        {triggerHarness && (
          <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[0.6rem] font-medium text-muted-foreground">
            {triggerHarness}
          </span>
        )}
        <span className="shrink-0 text-[0.6rem] text-muted-foreground">{triggerCost}</span>
        <ChevronIcon />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={4}>
          <Popover.Popup
            role="dialog"
            aria-label="Model selector"
            className={cn(
              "z-popover w-72 rounded-lg border border-border bg-popover shadow-md",
              "text-popover-foreground",
            )}
          >
            {/* Search input */}
            <div className="border-b border-border px-2 py-1.5">
              <input
                ref={searchRef}
                role="searchbox"
                aria-label="Search models"
                placeholder="Search models…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className={cn(
                  "w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground",
                  "outline-none",
                )}
              />
            </div>

            {/* Model list */}
            <div
              ref={listRef}
              role="listbox"
              aria-label="Available models"
              className="max-h-64 overflow-y-auto p-1"
            >
              {visibleModels.length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No models found
                </div>
              )}
              {visibleModels.map((model, idx) => {
                const key = modelKey(model.harness, model.modelId);
                const isSelected = selectedModel
                  ? model.harness === selectedModel.harness && model.modelId === selectedModel.modelId
                  : false;
                const isHighlighted = idx === highlightIdx;

                return (
                  <button
                    key={key}
                    data-model-option=""
                    role="option"
                    aria-selected={isSelected}
                    type="button"
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs outline-none",
                      "transition-colors",
                      isHighlighted && "bg-accent text-accent-foreground",
                      !isHighlighted && "hover:bg-accent-hover",
                      isSelected && "font-medium",
                    )}
                    onClick={() => selectModel(model)}
                    onMouseEnter={() => setHighlightIdx(idx)}
                  >
                    {/* Model name */}
                    <span className="flex-1 truncate text-left">{model.displayName}</span>

                    {/* Engine tag (unified mode only) */}
                    {isUnified && (
                      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[0.55rem] font-medium text-muted-foreground">
                        {HARNESS_LABELS[model.harness]}
                      </span>
                    )}

                    {/* Cost tier */}
                    <span className="shrink-0 text-[0.6rem] text-muted-foreground">
                      {COST_TIER_LABEL[model.costTier]}
                    </span>

                    {/* Selected checkmark */}
                    {isSelected && (
                      <CheckIcon className="shrink-0 text-primary" />
                    )}
                  </button>
                );
              })}

              {/* Show All Models */}
              {showShowAllButton && (
                <button
                  type="button"
                  className={cn(
                    "mt-1 flex w-full items-center justify-center rounded-md border border-dashed border-border",
                    "px-2 py-1.5 text-xs text-muted-foreground",
                    "hover:bg-accent-hover hover:text-foreground transition-colors cursor-pointer",
                  )}
                  onClick={() => setShowAll(true)}
                >
                  Show All Models
                </button>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="shrink-0 text-muted-foreground"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 3.75L5 6.25L7.5 3.75" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 6L5 9L10 3" />
    </svg>
  );
}
