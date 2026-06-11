"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  visibilityOption,
  type VisibilityLevelOption,
} from "./visibilityLevels";

/** Props for {@link VisibilitySelector}. */
export interface VisibilitySelectorProps {
  /** Current visibility of the resource. */
  readonly visibility: ApiResourceVisibility;
  /**
   * Levels to offer, in escalation order (see {@link visibilityLevels}).
   * Selecting a level later in the list than the current one is an
   * escalation and shows that option's inline confirmation prompt;
   * de-escalation applies immediately (revoking access is always safe).
   */
  readonly options: readonly VisibilityLevelOption[];
  /** Called when the user selects (and, for escalations, confirms) a level. */
  readonly onVisibilityChange: (v: ApiResourceVisibility) => void;
  /** Shows a spinner/disabled state while the RPC is in flight. */
  readonly isPending?: boolean;
  /** Disables all interaction (e.g., when the user lacks can_edit). */
  readonly disabled?: boolean;
  /** Accessible name for the radio group. Defaults to "Resource visibility". */
  readonly ariaLabel?: string;
  /** Additional CSS classes applied to the root element. */
  readonly className?: string;
}

/**
 * Segmented visibility selector — the single control for resource
 * visibility across blueprints AND instances. The offered levels are pure
 * data ({@link VisibilityLevelOption}); per-kind level sets live in
 * `visibilityLevels.ts`, so this component carries no kind-specific logic.
 *
 * Escalating (moving right in the options list) shows an inline
 * confirmation prompt colored by the target level's tone, since expanding
 * access is consequential. De-escalating applies immediately.
 *
 * If the current visibility is not among the offered options (e.g. a
 * platform-shared blueprint whose org no longer operates an
 * IdentityProvider), its canonical option is rendered in place so the
 * state stays legible and the user can still move to an offered level.
 *
 * WAI-ARIA Radio Group with roving tabindex, following the same visual
 * pattern as {@link ScopeToggle}. All visual properties flow through
 * `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <VisibilitySelector
 *   visibility={agent.metadata.visibility}
 *   options={blueprintVisibilityLevels({ deploymentMode, hasIdentityProvider })}
 *   onVisibilityChange={updateVisibility}
 *   isPending={isPending}
 * />
 * ```
 */
export function VisibilitySelector({
  visibility,
  options,
  onVisibilityChange,
  isPending = false,
  disabled = false,
  ariaLabel = "Resource visibility",
  className,
}: VisibilitySelectorProps) {
  const [confirming, setConfirming] = useState<ApiResourceVisibility | null>(
    null,
  );
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const effectivelyDisabled = disabled || isPending;

  // Keep the current state legible even when it is not offerable in the
  // current context: render its canonical option as an extra segment.
  const effectiveOptions = useMemo(() => {
    if (options.some((o) => o.value === visibility)) return options;
    return [...options, visibilityOption(visibility)];
  }, [options, visibility]);

  const isEscalation = useCallback(
    (target: ApiResourceVisibility) => {
      const values = effectiveOptions.map((o) => o.value);
      return values.indexOf(target) > values.indexOf(visibility);
    },
    [effectiveOptions, visibility],
  );

  const handleSelect = useCallback(
    (value: ApiResourceVisibility) => {
      if (value === visibility) return;

      if (isEscalation(value)) {
        setConfirming(value);
        return;
      }

      setConfirming(null);
      onVisibilityChange(value);
    },
    [visibility, onVisibilityChange, isEscalation],
  );

  const confirmChange = useCallback(() => {
    if (confirming === null) return;
    setConfirming(null);
    onVisibilityChange(confirming);
  }, [confirming, onVisibilityChange]);

  const cancelConfirm = useCallback(() => {
    setConfirming(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (index + 1) % effectiveOptions.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex =
          (index - 1 + effectiveOptions.length) % effectiveOptions.length;
      }

      if (nextIndex !== null) {
        optionRefs.current[nextIndex]?.focus();
        handleSelect(effectiveOptions[nextIndex].value);
      }
    },
    [effectiveOptions, handleSelect],
  );

  const confirmingOption =
    confirming !== null
      ? effectiveOptions.find((o) => o.value === confirming)
      : undefined;

  return (
    <div className={cn("inline-flex flex-col gap-1.5", className)}>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        aria-disabled={effectivelyDisabled || undefined}
        className={cn(
          "inline-flex rounded-md bg-muted p-0.5",
          effectivelyDisabled && "pointer-events-none opacity-50",
        )}
      >
        {effectiveOptions.map((option, index) => {
          const isSelected = visibility === option.value;

          return (
            <button
              key={option.value}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${option.label}: ${option.description}`}
              tabIndex={isSelected ? 0 : -1}
              disabled={effectivelyDisabled}
              onClick={() => handleSelect(option.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? SELECTED_STYLES[option.tone]
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isPending && isSelected ? (
                <span
                  className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden="true"
                />
              ) : (
                <VisibilityIcon tone={option.tone} className="size-3" />
              )}
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Description of current state */}
      {confirming === null && (
        <p className="text-[0.65rem] text-muted-foreground">
          {effectiveOptions.find((o) => o.value === visibility)?.description}
        </p>
      )}

      {/* Confirmation prompt for escalation */}
      {confirmingOption?.confirmPrompt && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs",
            PROMPT_STYLES[confirmingOption.tone].container,
          )}
          role="alert"
        >
          <span className={PROMPT_STYLES[confirmingOption.tone].text}>
            {confirmingOption.confirmPrompt}
          </span>
          <button
            type="button"
            onClick={confirmChange}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium text-white",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              PROMPT_STYLES[confirmingOption.tone].confirm,
            )}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={cancelConfirm}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              PROMPT_STYLES[confirmingOption.tone].cancel,
            )}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tone styling — one row per visibility tone, keyed by VisibilityLevelOption
// ---------------------------------------------------------------------------

type Tone = VisibilityLevelOption["tone"];

const SELECTED_STYLES: Record<Tone, string> = {
  private:
    "bg-amber-50 text-amber-800 shadow-sm dark:bg-amber-900/30 dark:text-amber-300",
  org: "bg-blue-100 text-blue-800 shadow-sm dark:bg-blue-900/40 dark:text-blue-300",
  platform:
    "bg-violet-100 text-violet-800 shadow-sm dark:bg-violet-900/40 dark:text-violet-300",
  public:
    "bg-emerald-100 text-emerald-800 shadow-sm dark:bg-emerald-900/40 dark:text-emerald-300",
};

const PROMPT_STYLES: Record<
  Tone,
  { container: string; text: string; confirm: string; cancel: string }
> = {
  // Private never escalates, but the row keeps the Record total.
  private: {
    container:
      "border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-200",
    confirm:
      "bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500",
    cancel:
      "text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100",
  },
  org: {
    container:
      "border-blue-200 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-950/30",
    text: "text-blue-800 dark:text-blue-200",
    confirm:
      "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500",
    cancel:
      "text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100",
  },
  platform: {
    container:
      "border-violet-200 bg-violet-50 dark:border-violet-800/50 dark:bg-violet-950/30",
    text: "text-violet-800 dark:text-violet-200",
    confirm:
      "bg-violet-600 hover:bg-violet-700 dark:bg-violet-600 dark:hover:bg-violet-500",
    cancel:
      "text-violet-700 hover:text-violet-900 dark:text-violet-300 dark:hover:text-violet-100",
  },
  public: {
    container:
      "border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/30",
    text: "text-amber-800 dark:text-amber-200",
    confirm:
      "bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500",
    cancel:
      "text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100",
  },
};

// ---------------------------------------------------------------------------
// Icons — inline SVGs following the SDK pattern (no icon library dependency)
// ---------------------------------------------------------------------------

/** Icon for a visibility tone; shared with {@link VisibilityBadge}. */
export function VisibilityIcon({
  tone,
  className,
}: {
  readonly tone: Tone;
  readonly className?: string;
}) {
  switch (tone) {
    case "org":
      return <UsersIcon className={className} />;
    case "platform":
      return <BuildingsIcon className={className} />;
    case "public":
      return <GlobeIcon className={className} />;
    default:
      return <LockIcon className={className} />;
  }
}

function LockIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function UsersIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" />
      <circle cx="11.5" cy="5.5" r="2" />
      <path d="M14 13c0-1.66-1.12-3-2.5-3-.5 0-1 .14-1.4.4" />
    </svg>
  );
}

function BuildingsIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 14V4.5L6.5 2v12" />
      <path d="M6.5 6.5 14 8.5V14" />
      <path d="M2 14h12" />
      <path d="M4.25 6h.01M4.25 8.5h.01M4.25 11h.01M10.5 10.5h.01M10.5 12.5h.01" />
    </svg>
  );
}

function GlobeIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12" />
      <path d="M8 2c1.66 1.46 2.6 3.63 2.6 6s-.94 4.54-2.6 6c-1.66-1.46-2.6-3.63-2.6-6s.94-4.54 2.6-6Z" />
    </svg>
  );
}

/**
 * Read-only visibility indicator with a matching icon, covering all four
 * levels (Private / Organization / Platform / Public).
 *
 * Rendered wherever the interactive {@link VisibilitySelector} is not
 * available — for viewers who lack `can_edit`, and while a permission check
 * is in flight — so a resource's visibility is always legible rather than
 * silently blank.
 */
export function VisibilityBadge({
  visibility,
  className,
}: {
  readonly visibility: ApiResourceVisibility;
  readonly className?: string;
}) {
  const option = visibilityOption(visibility);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground",
        className,
      )}
    >
      <VisibilityIcon tone={option.tone} className="size-2.5" />
      {option.label}
    </span>
  );
}
