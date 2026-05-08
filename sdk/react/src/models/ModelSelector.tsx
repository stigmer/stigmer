"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/theme";
import { useStigmerPortalContainer } from "../portal-container";
import { useModelRegistry } from "./useModelRegistry";
import type { ModelInfo, CostTier, SpeedTier } from "./registry";
import { HARNESS_META, HARNESS_OPTIONS, type HarnessOption } from "./harness";

const COST_TIER_LABEL: Record<CostTier, string> = {
  economy: "$",
  standard: "$$",
  premium: "$$$",
};

const SPEED_TIER_LABEL: Record<SpeedTier, string> = {
  fastest: "Fastest",
  fast: "Fast",
  balanced: "Balanced",
  slow: "Powerful",
};

/** Props for {@link ModelSelector}. */
export interface ModelSelectorProps {
  /** Currently selected model ID. */
  readonly value?: string;
  /** Called when the user picks a different model. Receives the `modelId`. */
  readonly onValueChange: (modelId: string) => void;
  /**
   * Current harness. When provided as a single value, locks the selector
   * to that harness (dropdown hidden). When omitted, shows the harness dropdown.
   */
  readonly harness?: HarnessOption;
  /**
   * Initial harness value for the internal state when `harness` prop is
   * undefined (unlocked mode). Prevents desync when the parent knows the
   * active harness but delegates the dropdown to this component.
   *
   * When `harness` is provided (locked mode), this prop is ignored.
   */
  readonly initialHarness?: HarnessOption;
  /** Called when user changes harness in the dropdown. */
  readonly onHarnessChange?: (harness: HarnessOption) => void;
  /**
   * Restrict which harnesses appear in the dropdown.
   * When omitted, shows all registered harnesses that have models in the registry.
   */
  readonly availableHarnesses?: readonly HarnessOption[];
  /** Override the curated (featured) list for the current harness. */
  readonly curatedModels?: readonly string[];
  /** Grouping in the "Show All" expanded view. Default: "provider". */
  readonly groupBy?: "provider" | "tier" | "none";
  /** Show speed tier badge. Default: true. */
  readonly showSpeedBadge?: boolean;
  /** Show short descriptions in curated view. Default: true. */
  readonly showDescriptions?: boolean;
  /** Compact mode: smaller trigger, no descriptions. Default: false. */
  readonly compact?: boolean;
  /** Additional CSS class names for the trigger button. */
  readonly className?: string;
  /** When true, disables the selector. */
  readonly disabled?: boolean;

  /**
   * @deprecated Use {@link onHarnessChange} instead.
   */
  readonly onHarnessResolved?: (harness: HarnessOption) => void;
}

/**
 * Combined harness + model picker with a compact trigger button.
 *
 * Shows a harness dropdown at the top of the popover (when not locked
 * to a single harness), followed by a curated model list scoped to
 * the selected harness. Supports search and progressive disclosure
 * via "Show All Models."
 *
 * The trigger button displays the current selection in compact format:
 * `Harness · Model Name ▾` (or just `Model Name ▾` when harness is locked).
 *
 * @example
 * ```tsx
 * <ModelSelector
 *   value={modelId}
 *   onValueChange={setModelId}
 *   harness={harness}
 *   onHarnessChange={setHarness}
 * />
 * ```
 */
export function ModelSelector({
  value,
  onValueChange,
  harness,
  initialHarness,
  onHarnessChange,
  onHarnessResolved,
  availableHarnesses,
  curatedModels,
  groupBy = "provider",
  showSpeedBadge = true,
  showDescriptions = true,
  compact = false,
  className,
  disabled,
}: ModelSelectorProps) {
  const portalContainer = useStigmerPortalContainer();

  const isHarnessLocked = harness !== undefined;
  const [internalHarness, setInternalHarness] = useState<HarnessOption>(
    harness ?? initialHarness ?? "native",
  );
  const activeHarness = harness ?? internalHarness;

  useEffect(() => {
    if (!isHarnessLocked && initialHarness !== undefined) {
      setInternalHarness(initialHarness);
    }
  }, [initialHarness, isHarnessLocked]);

  const { models, featured, defaultModel, getModel, byProvider } = useModelRegistry(
    { harness: activeHarness },
  );

  const [open, setOpen] = useState(false);
  const [harnessOpen, setHarnessOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const resolvedHarnesses = useMemo(() => {
    if (availableHarnesses) return availableHarnesses;
    // For now, show native and cursor (the two harnesses with models in the registry).
    // Future harnesses will be added to the registry and appear here automatically.
    return HARNESS_OPTIONS.filter((h) => h === "native" || h === "cursor");
  }, [availableHarnesses]);

  const selectedModel = (value ? getModel(value) : undefined) ?? defaultModel ?? undefined;

  const isSearching = searchQuery.length > 0;
  const lowerQuery = searchQuery.toLowerCase();

  const curatedSet = useMemo(() => {
    if (curatedModels) return new Set(curatedModels);
    return null;
  }, [curatedModels]);

  const featuredModels = useMemo(() => {
    if (curatedSet) {
      return models.filter((m) => curatedSet.has(m.modelId));
    }
    return featured;
  }, [models, featured, curatedSet]);

  const visibleModels: readonly ModelInfo[] = useMemo(() => {
    if (isSearching) {
      return models.filter((m) =>
        m.displayName.toLowerCase().includes(lowerQuery)
        || m.modelId.toLowerCase().includes(lowerQuery)
        || m.shortDescription.toLowerCase().includes(lowerQuery),
      );
    }
    if (showAll) return models;
    return featuredModels.length > 0 ? featuredModels : models;
  }, [models, featuredModels, isSearching, showAll, lowerQuery]);

  const groupedModels = useMemo(() => {
    if (!showAll || groupBy === "none" || isSearching) return null;
    const groups = new Map<string, ModelInfo[]>();
    for (const model of models) {
      const key = groupBy === "provider" ? model.provider : model.costTier;
      const group = groups.get(key);
      if (group) {
        group.push(model);
      } else {
        groups.set(key, [model]);
      }
    }
    return groups;
  }, [models, showAll, groupBy, isSearching]);

  useEffect(() => {
    setHighlightIdx(-1);
  }, [visibleModels]);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setShowAll(false);
      setHighlightIdx(-1);
      setHarnessOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const handleHarnessChange = useCallback(
    (newHarness: HarnessOption) => {
      setInternalHarness(newHarness);
      onHarnessChange?.(newHarness);
      onHarnessResolved?.(newHarness);
      setShowAll(false);
      setSearchQuery("");
    },
    [onHarnessChange, onHarnessResolved],
  );

  const selectModel = useCallback(
    (model: ModelInfo) => {
      onValueChange(model.modelId);
      setOpen(false);
    },
    [onValueChange],
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

  const showShowAllButton = !isSearching && !showAll && featuredModels.length > 0 && featuredModels.length < models.length;

  const triggerLabel = selectedModel?.displayName ?? "Select model";
  const triggerHarness = !isHarnessLocked ? HARNESS_META[activeHarness].label : undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border",
          "bg-background px-2.5 py-1.5 text-xs text-foreground",
          "hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          "transition-colors max-w-[20rem] max-sm:max-w-[12rem]",
          className,
        )}
      >
        {triggerHarness && (
          <span className="shrink-0 text-muted-foreground">{triggerHarness}</span>
        )}
        {triggerHarness && (
          <span className="shrink-0 text-border" aria-hidden>·</span>
        )}
        <span className="truncate">{triggerLabel}</span>
        <ChevronIcon />
      </Popover.Trigger>

      <Popover.Portal container={portalContainer}>
        <Popover.Positioner sideOffset={4}>
          <Popover.Popup
            role="dialog"
            aria-label="Model selector"
            className={cn(
              "z-popover w-72 rounded-lg border border-border bg-popover shadow-md",
              "text-popover-foreground",
            )}
          >
            {/* Harness selector — inline label + compact dropdown; disabled when locked */}
            <div className="relative flex items-center justify-between border-b border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">Harness</span>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={harnessOpen}
                aria-label="Select harness"
                disabled={isHarnessLocked}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-border",
                  "bg-background px-2.5 py-1.5 text-xs text-foreground",
                  "transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isHarnessLocked
                    ? "cursor-not-allowed opacity-50"
                    : "hover:bg-accent-hover",
                )}
                onClick={() => {
                  if (!isHarnessLocked) setHarnessOpen(!harnessOpen);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && harnessOpen) {
                    e.stopPropagation();
                    setHarnessOpen(false);
                  }
                }}
              >
                <span>{HARNESS_META[activeHarness].label}</span>
                {!isHarnessLocked && <ChevronIcon />}
              </button>

              {!isHarnessLocked && harnessOpen && (
                <div
                  role="listbox"
                  aria-label="Available harnesses"
                  className={cn(
                    "absolute right-3 top-full z-10 mt-1 overflow-hidden rounded-md border border-border",
                    "bg-popover shadow-md",
                  )}
                >
                  {resolvedHarnesses.map((h) => {
                    const isActive = h === activeHarness;
                    return (
                      <button
                        key={h}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        className={cn(
                          "flex w-full items-center gap-2 px-2.5 py-1.5 text-xs transition-colors",
                          "hover:bg-accent-hover",
                          isActive && "font-medium",
                        )}
                        onClick={() => {
                          handleHarnessChange(h);
                          setHarnessOpen(false);
                        }}
                      >
                        <span className="flex-1 text-left">{HARNESS_META[h].label}</span>
                        {isActive && <CheckIcon className="shrink-0 text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Search input */}
            <div className="border-b border-border px-3 py-1.5">
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
              className="max-h-72 overflow-y-auto p-1"
            >
              {visibleModels.length === 0 && (
                <div className="px-2 py-3 text-center text-xs text-muted-foreground">
                  No models found
                </div>
              )}

              {/* Grouped rendering */}
              {groupedModels ? (
                Array.from(groupedModels.entries()).map(([group, groupModels]) => (
                  <div key={group}>
                    <div className="px-2 pb-0.5 pt-2 text-[0.6rem] font-medium uppercase tracking-wider text-muted-foreground">
                      {group}
                    </div>
                    {groupModels.map((model) => (
                      <ModelRow
                        key={model.modelId}
                        model={model}
                        isSelected={model.modelId === selectedModel?.modelId}
                        showDescription={false}
                        showSpeedBadge={showSpeedBadge}
                        onClick={() => selectModel(model)}
                      />
                    ))}
                  </div>
                ))
              ) : (
                visibleModels.map((model, idx) => (
                  <ModelRow
                    key={model.modelId}
                    model={model}
                    isSelected={model.modelId === selectedModel?.modelId}
                    isHighlighted={idx === highlightIdx}
                    showDescription={showDescriptions && !compact && !isSearching && !showAll}
                    showSpeedBadge={showSpeedBadge}
                    onClick={() => selectModel(model)}
                    onMouseEnter={() => setHighlightIdx(idx)}
                  />
                ))
              )}

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
                  Show all models
                </button>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

interface ModelRowProps {
  model: ModelInfo;
  isSelected: boolean;
  isHighlighted?: boolean;
  showDescription: boolean;
  showSpeedBadge: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
}

function ModelRow({
  model,
  isSelected,
  isHighlighted,
  showDescription,
  showSpeedBadge,
  onClick,
  onMouseEnter,
}: ModelRowProps) {
  return (
    <button
      data-model-option=""
      role="option"
      aria-selected={isSelected}
      type="button"
      className={cn(
        "flex w-full cursor-pointer flex-col rounded-md px-2 py-1.5 text-xs outline-none",
        "transition-colors",
        isHighlighted && "bg-accent text-accent-foreground",
        !isHighlighted && "hover:bg-accent-hover",
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="flex w-full items-center gap-2">
        <span className="flex-1 truncate text-left font-medium">{model.displayName}</span>

        <span className="shrink-0 text-[0.6rem] text-muted-foreground">
          {showSpeedBadge
            ? `${SPEED_TIER_LABEL[model.speedTier]} ${COST_TIER_LABEL[model.costTier]}`
            : COST_TIER_LABEL[model.costTier]}
        </span>

        {isSelected && <CheckIcon className="shrink-0 text-primary" />}
      </div>

      {showDescription && model.shortDescription && (
        <span className="mt-0.5 block text-left text-[0.65rem] text-muted-foreground">
          {model.shortDescription}
        </span>
      )}
    </button>
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
