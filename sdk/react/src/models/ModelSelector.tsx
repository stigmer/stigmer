"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/theme";
import { useStigmerPortalContainer } from "../portal-container.js";
import { Switch } from "../switch/Switch.js";
import { useModelRegistry } from "./useModelRegistry.js";
import type { ModelInfo, CostTier, SpeedTier } from "./registry.js";
import { HARNESS_META, HARNESS_OPTIONS, type HarnessOption } from "./harness.js";
import { FAST_SERVICE_TIER, type ServiceTierOption } from "./service-tier.js";
import type { ThinkingModeOption } from "./thinking-mode.js";

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

/**
 * Whether the thinking switch may act on this model (stigmer/stigmer#772):
 * the registry declares the capability AND the model is cursor-harness —
 * the only harness with a thinking translation in v1. Native models
 * truthfully declare the capability too, but selecting it there would be
 * refused at create time, so the control never renders for them.
 */
function supportsThinking(model: ModelInfo): boolean {
  return model.harness === "cursor" && model.thinkingCapable === true;
}

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
   * Trigger label shown while `value` is empty, instead of falling back
   * to the registry's default model. Lets a form distinguish "nothing
   * pinned — the platform default applies" from an actual selection
   * (the schedule form's contract: an unset model inherits the
   * surface's platform default). The harness prefix is hidden while
   * the placeholder shows, since no engine is pinned either.
   */
  readonly placeholderLabel?: string;

  /**
   * Current service tier for the selected model (stigmer/stigmer#357).
   * Defaults to "standard". Only meaningful together with
   * {@link onServiceTierChange}.
   */
  readonly serviceTier?: ServiceTierOption;
  /**
   * Called when the user toggles the fast tier. Providing this enables the
   * "Fast tier" switch in the popover's options area (top of the popover,
   * beside the harness row — the Cursor options-panel convention), which
   * renders ONLY while the selected model prices a fast variant
   * ({@link ModelInfo.serviceTiers}) — no dead controls.
   *
   * An active fast tier persists across switches between fast-capable
   * models (the tier is always visible: trigger badge + options switch),
   * so "fast, but on that other model" is one action, not a re-toggle.
   * Selecting a model without a fast tier resets to "standard" through
   * this callback — an unsupported combination can never be submitted
   * (#357, refused at create time).
   */
  readonly onServiceTierChange?: (tier: ServiceTierOption) => void;

  /**
   * Current thinking mode for the selected model (stigmer/stigmer#772).
   * Defaults to "disabled". Only meaningful together with
   * {@link onThinkingModeChange}.
   */
  readonly thinkingMode?: ThinkingModeOption;
  /**
   * Called when the user toggles extended reasoning. Providing this enables
   * the "Thinking" switch as a sibling of the fast-tier switch in the
   * popover's options area, which renders ONLY while the selected model is
   * a cursor-harness model declaring the thinking capability
   * ({@link ModelInfo.thinkingCapable}) — no dead controls, and v1 honors
   * the selection on the cursor harness only.
   *
   * The same persistence rule as the fast tier: an active thinking mode
   * survives switches between thinking-capable models (trigger badge +
   * options switch keep it visible) and resets to "disabled" only when the
   * new model lacks the capability — an unsupported combination can never
   * be submitted (#772, refused at create time). Unlike fast, thinking
   * bills at base per-token rates; enabled turns consume more output
   * (reasoning) tokens.
   */
  readonly onThinkingModeChange?: (mode: ThinkingModeOption) => void;

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
 * **Service tier (#357).** When the consumer opts in via
 * {@link ModelSelectorProps.onServiceTierChange} and the selected model
 * prices a fast variant, a "Fast tier" switch renders in the options area
 * at the TOP of the popover — the first thing visible on open, mirroring
 * Cursor's own options panel (Jakob's Law: our users already know that
 * layout). Deliberately not a per-row affordance: row-level chips crowd
 * the rows and collide with the "Fast/Fastest" speed badge, and an
 * interactive element inside `role="option"` is an ARIA authoring error
 * (option children are presentational). An active fast tier persists
 * across switches between fast-capable models — the visible badge and
 * switch keep the state honest — and resets only for models with no fast
 * variant, where it would be refused at create time.
 *
 * **Thinking mode (#772).** The same options-area pattern for the second
 * variant dimension: opting in via
 * {@link ModelSelectorProps.onThinkingModeChange} renders a "Thinking"
 * switch for cursor-harness models declaring the thinking capability.
 * Capability-gated rather than priced-variant-gated — thinking bills at
 * base per-token rates and costs more only through extra reasoning
 * (output) tokens. Persistence and reset rules mirror the fast tier's.
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
  placeholderLabel,
  serviceTier = "standard",
  onServiceTierChange,
  thinkingMode = "disabled",
  onThinkingModeChange,
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

  const { models, featured, defaultModel, getModel, byProvider, isLoading, error, refetch } = useModelRegistry(
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
      // An active fast tier survives a switch between fast-capable models —
      // resetting it forced users to re-toggle on every model change, and
      // the tier is never silent (trigger badge + options switch both show
      // it). It resets ONLY when the new model prices no fast variant: a
      // stale tier there would be refused at create time (#357).
      if (
        serviceTier === "fast"
        && onServiceTierChange
        && !model.serviceTiers.includes(FAST_SERVICE_TIER)
      ) {
        onServiceTierChange("standard");
      }
      // The identical persistence rule for the thinking mode (#772):
      // survives between thinking-capable cursor models, resets only
      // where the selection would be refused at create time.
      if (
        thinkingMode === "enabled"
        && onThinkingModeChange
        && !supportsThinking(model)
      ) {
        onThinkingModeChange("disabled");
      }
      setOpen(false);
    },
    [onValueChange, serviceTier, onServiceTierChange, thinkingMode, onThinkingModeChange],
  );

  const scrollHighlightIntoView = useCallback((idx: number) => {
    const container = listRef.current;
    if (!container) return;
    const items = container.querySelectorAll<HTMLElement>("[data-model-option]");
    items[idx]?.scrollIntoView({ block: "nearest" });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
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

  // The options-area switch exists only where it applies: a consumer opted
  // in AND the selected model prices a fast variant (recognition over
  // recall — never a dead control on models with no tier choice).
  const showServiceTierToggle =
    onServiceTierChange !== undefined
    && selectedModel !== undefined
    && selectedModel.serviceTiers.includes(FAST_SERVICE_TIER);
  // The trigger badge is display-only: fast is in effect iff the tier is
  // fast AND the selected model actually prices the variant.
  const fastActive =
    serviceTier === "fast"
    && (selectedModel?.serviceTiers.includes(FAST_SERVICE_TIER) ?? false);
  // The thinking switch renders under the same no-dead-controls rule,
  // gated on the capability instead of a priced variant (#772).
  const showThinkingToggle =
    onThinkingModeChange !== undefined
    && selectedModel !== undefined
    && supportsThinking(selectedModel);
  const thinkingActive =
    thinkingMode === "enabled"
    && (selectedModel !== undefined && supportsThinking(selectedModel));

  const usingPlaceholder = !value && placeholderLabel !== undefined;
  const triggerLabel = usingPlaceholder
    ? placeholderLabel
    : (selectedModel?.displayName ?? "Select model");
  const triggerHarness =
    !isHarnessLocked && !usingPlaceholder
      ? HARNESS_META[activeHarness].label
      : undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:border stg:border-border",
          "stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
          "stg:hover:bg-accent-hover stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          "stg:transition-colors stg:max-w-[20rem] stg:max-sm:max-w-[12rem]",
          className,
        )}
      >
        {triggerHarness && (
          <span className="stg:shrink-0 stg:text-muted-foreground">{triggerHarness}</span>
        )}
        {triggerHarness && (
          <span className="stg:shrink-0 stg:text-border" aria-hidden>·</span>
        )}
        <span className="stg:truncate">{triggerLabel}</span>
        {fastActive && (
          <span
            className={cn(
              "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-0.5 stg:rounded-full stg:border stg:border-primary stg:px-1.5 stg:py-px",
              "stg:text-[0.6rem] stg:font-medium stg:uppercase stg:tracking-wider stg:text-primary",
            )}
          >
            <BoltIcon />
            Fast
          </span>
        )}
        {thinkingActive && (
          <span
            className={cn(
              "stg:inline-flex stg:shrink-0 stg:items-center stg:gap-0.5 stg:rounded-full stg:border stg:border-primary stg:px-1.5 stg:py-px",
              "stg:text-[0.6rem] stg:font-medium stg:uppercase stg:tracking-wider stg:text-primary",
            )}
          >
            Thinking
          </span>
        )}
        <ChevronIcon />
      </Popover.Trigger>

      <Popover.Portal container={portalContainer}>
        <Popover.Positioner sideOffset={4}>
          <Popover.Popup
            role="dialog"
            aria-label="Model selector"
            className={cn(
              "stg:z-popover stg:w-72 stg:rounded-lg stg:border stg:border-border stg:bg-popover stg:shadow-md",
              "stg:text-popover-foreground",
            )}
          >
            {/* Harness selector — inline label + compact dropdown; disabled when locked */}
            <div className="stg:relative stg:flex stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-3 stg:py-2">
              <span className="stg:text-xs stg:text-muted-foreground">Harness</span>
              <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={harnessOpen}
                aria-label="Select harness"
                disabled={isHarnessLocked}
                className={cn(
                  "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:border stg:border-border",
                  "stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
                  "stg:transition-colors",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                  isHarnessLocked
                    ? "stg:cursor-not-allowed stg:opacity-50"
                    : "stg:hover:bg-accent-hover",
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
                    "stg:absolute stg:right-3 stg:top-full stg:z-10 stg:mt-1 stg:overflow-hidden stg:rounded-md stg:border stg:border-border",
                    "stg:bg-popover stg:shadow-md",
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
                          "stg:flex stg:w-full stg:items-center stg:gap-2 stg:px-2.5 stg:py-1.5 stg:text-xs stg:transition-colors",
                          "stg:hover:bg-accent-hover",
                          isActive && "stg:font-medium",
                        )}
                        onClick={() => {
                          handleHarnessChange(h);
                          setHarnessOpen(false);
                        }}
                      >
                        <span className="stg:flex-1 stg:text-left">{HARNESS_META[h].label}</span>
                        {isActive && <CheckIcon className="stg:shrink-0 stg:text-primary" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Options area — the Cursor options-panel convention: settings
                of the CURRENT selection sit at the top of the popover, the
                first thing visible on open, never buried under the list.
                Rendered only while the selected model prices a fast
                variant (#357). */}
            {showServiceTierToggle && (
              <div className="stg:flex stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-3 stg:py-2">
                <div className="stg:flex stg:flex-col">
                  <span className="stg:text-xs stg:text-foreground">Fast tier</span>
                  <span className="stg:text-[0.65rem] stg:text-muted-foreground">
                    Faster responses at higher per-token rates
                  </span>
                </div>
                <Switch
                  checked={fastActive}
                  onCheckedChange={(next) =>
                    onServiceTierChange?.(next ? "fast" : "standard")
                  }
                  aria-label="Fast tier"
                />
              </div>
            )}

            {showThinkingToggle && (
              <div className="stg:flex stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-3 stg:py-2">
                <div className="stg:flex stg:flex-col">
                  <span className="stg:text-xs stg:text-foreground">Thinking</span>
                  <span className="stg:text-[0.65rem] stg:text-muted-foreground">
                    Extended reasoning; uses more output tokens
                  </span>
                </div>
                <Switch
                  checked={thinkingActive}
                  onCheckedChange={(next) =>
                    onThinkingModeChange?.(next ? "enabled" : "disabled")
                  }
                  aria-label="Thinking"
                />
              </div>
            )}

            {/* Search input */}
            <div className="stg:border-b stg:border-border stg:px-3 stg:py-1.5">
              <input
                ref={searchRef}
                role="searchbox"
                aria-label="Search models"
                placeholder="Search models…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                className={cn(
                  "stg:w-full stg:bg-transparent stg:text-xs stg:text-foreground stg:placeholder:text-muted-foreground",
                  "stg:outline-none",
                )}
              />
            </div>

            {/* Model list */}
            <div
              ref={listRef}
              role="listbox"
              aria-label="Available models"
              className="stg:max-h-72 stg:overflow-y-auto stg:p-1"
            >
              {visibleModels.length === 0 && isLoading && (
                <div className="stg:flex stg:items-center stg:justify-center stg:gap-2 stg:px-2 stg:py-3">
                  <div className="stg:size-3 stg:animate-spin stg:rounded-full stg:border stg:border-muted stg:border-t-primary" />
                  <span className="stg:text-xs stg:text-muted-foreground">Loading models…</span>
                </div>
              )}

              {visibleModels.length === 0 && !isLoading && error != null && (
                <div className="stg:flex stg:flex-col stg:items-center stg:gap-1.5 stg:px-2 stg:py-3">
                  <span className="stg:text-xs stg:text-muted-foreground">Failed to load models</span>
                  <button
                    type="button"
                    className={cn(
                      "stg:rounded-md stg:border stg:border-border stg:bg-background stg:px-2.5 stg:py-1 stg:text-xs stg:text-foreground",
                      "stg:hover:bg-accent-hover stg:transition-colors stg:cursor-pointer",
                    )}
                    onClick={refetch}
                  >
                    Retry
                  </button>
                </div>
              )}

              {visibleModels.length === 0 && !isLoading && error == null && (
                <div className="stg:px-2 stg:py-3 stg:text-center stg:text-xs stg:text-muted-foreground">
                  No models found
                </div>
              )}

              {/* Grouped rendering */}
              {groupedModels ? (
                Array.from(groupedModels.entries()).map(([group, groupModels]) => (
                  <div key={group}>
                    <div className="stg:px-2 stg:pb-0.5 stg:pt-2 stg:text-[0.6rem] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
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
                    "stg:mt-1 stg:flex stg:w-full stg:items-center stg:justify-center stg:rounded-md stg:border stg:border-dashed stg:border-border",
                    "stg:px-2 stg:py-1.5 stg:text-xs stg:text-muted-foreground",
                    "stg:hover:bg-accent-hover stg:hover:text-foreground stg:transition-colors stg:cursor-pointer",
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
        "stg:flex stg:w-full stg:cursor-pointer stg:flex-col stg:rounded-md stg:px-2 stg:py-1.5 stg:text-xs stg:outline-none",
        "stg:transition-colors",
        isHighlighted && "stg:bg-accent stg:text-accent-foreground",
        !isHighlighted && "stg:hover:bg-accent-hover",
      )}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="stg:flex stg:w-full stg:items-center stg:gap-2">
        <span className="stg:flex-1 stg:truncate stg:text-left stg:font-medium">{model.displayName}</span>

        {/* Explicit vision:false only (stigmer/stigmer#386) — an unassessed
            model (absent capabilities block) shows nothing, per the
            registry's tri-state convention. Visible text, not a tooltip:
            keyboard and touch users must see it before picking the model. */}
        {model.visionCapability === false && (
          <span className="stg:flex stg:shrink-0 stg:items-center stg:gap-0.5 stg:text-[0.6rem] stg:text-muted-foreground">
            <NoImageInputIcon />
            No image input
          </span>
        )}

        <span className="stg:shrink-0 stg:text-[0.6rem] stg:text-muted-foreground">
          {showSpeedBadge
            ? `${SPEED_TIER_LABEL[model.speedTier]} ${COST_TIER_LABEL[model.costTier]}`
            : COST_TIER_LABEL[model.costTier]}
        </span>

        {isSelected && <CheckIcon className="stg:shrink-0 stg:text-primary" />}
      </div>

      {showDescription && model.shortDescription && (
        <span className="stg:mt-0.5 stg:block stg:text-left stg:text-[0.65rem] stg:text-muted-foreground">
          {model.shortDescription}
        </span>
      )}
    </button>
  );
}

function ChevronIcon() {
  return (
    <svg
      className="stg:shrink-0 stg:text-muted-foreground"
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

/**
 * "Image with a slash" glyph for models explicitly assessed as unable to
 * see images. Decorative (`aria-hidden`) — the wrapping span carries the
 * accessible text.
 */
function NoImageInputIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="1.5" y="2" width="9" height="8" rx="1.2" />
      <path d="M1.5 8L4.2 5.6L6.4 7.6" />
      <circle cx="7.6" cy="4.6" r="0.8" fill="currentColor" stroke="none" />
      <path d="M1 1L11 11" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg
      className="stg:shrink-0"
      width="8"
      height="10"
      viewBox="0 0 8 10"
      fill="currentColor"
      aria-hidden
    >
      <path d="M4.9 0.2L0.6 5.6h2.6L3.1 9.8l4.3-5.4H4.8L4.9 0.2z" />
    </svg>
  );
}
