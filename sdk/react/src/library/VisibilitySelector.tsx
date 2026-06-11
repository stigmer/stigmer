"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/theme";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useStigmerPortalContainer } from "../portal-container";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog";
import { useConfirmAction } from "../resource-detail/useConfirmAction";
import {
  PROMPT_STYLES,
  VISIBILITY_CHIP_CLASS,
  VisibilityIcon,
  VisibilityOptionRow,
} from "./VisibilityOptionRow";
import {
  visibilityOption,
  type VisibilityLevelOption,
} from "./visibilityLevels";

/** How the selector presents itself and how it confirms escalations. */
export type VisibilitySelectorMode = "manage" | "create";

/** Props for {@link VisibilitySelector}. */
export interface VisibilitySelectorProps {
  /** Current visibility of the resource. */
  readonly visibility: ApiResourceVisibility;
  /**
   * Levels to offer, in escalation order (least to most exposed). Selecting
   * a level later in the list than the current one is an escalation and is
   * confirmed by severity (see {@link mode}); de-escalation applies
   * immediately (revoking access is always safe).
   */
  readonly options: readonly VisibilityLevelOption[];
  /** Called when the user selects (and, for escalations, confirms) a level. */
  readonly onVisibilityChange: (v: ApiResourceVisibility) => void;
  /**
   * Presentation + confirmation mode.
   *
   * - `"manage"` (default) — a compact current-state chip opens a popover
   *   ladder of levels. Escalations are confirmed by severity: a light
   *   inline prompt for levels carrying {@link VisibilityLevelOption.confirmPrompt}
   *   (e.g. Organization), and a blocking modal for levels carrying
   *   {@link VisibilityLevelOption.confirmDialog} (Platform, Public). This is
   *   the live-resource case.
   * - `"create"` — an inline radio list that applies immediately, with no
   *   escalation confirmation. Used to pick an initial value while creating
   *   a resource (typically inside a native `<dialog>`, where a portaled
   *   popover would render beneath the modal's top layer).
   *
   * @default "manage"
   */
  readonly mode?: VisibilitySelectorMode;
  /** Shows a spinner/disabled state while the RPC is in flight. */
  readonly isPending?: boolean;
  /** Disables all interaction (e.g., when the user lacks can_edit). */
  readonly disabled?: boolean;
  /** Accessible name for the control. Defaults to "Resource visibility". */
  readonly ariaLabel?: string;
  /** Additional CSS classes applied to the root element. */
  readonly className?: string;
}

/**
 * The single control for resource visibility across blueprints AND
 * instances. Offered levels are pure data ({@link VisibilityLevelOption});
 * per-kind level sets live in `visibilityLevels.ts`, so this component
 * carries no kind-specific logic.
 *
 * In `"manage"` mode it renders a current-state chip (icon + label + caret)
 * that opens a popover listing each offered level with its own description —
 * scaling cleanly to four levels without the layout shift of a segmented
 * control, and explaining every choice at a glance (Recognition over
 * Recall). Escalation is confirmed in proportion to how far access expands:
 * de-escalation applies instantly, an Organization escalation shows a light
 * inline prompt, and Platform/Public escalations open a blocking
 * {@link ConfirmDialog} that names the exact audience. Confirmation is owned
 * here so every consumer — blueprint detail, instance detail, and any
 * standalone embed — behaves identically.
 *
 * In `"create"` mode it renders an inline radio list that applies
 * immediately (initial value selection has no escalation semantics).
 *
 * If the current visibility is not among the offered options (e.g. a
 * platform-shared blueprint whose org no longer operates an
 * IdentityProvider), its canonical option is rendered in place so the
 * state stays legible and the user can still move to an offered level.
 *
 * All visual properties flow through `--stgm-*` design tokens; portaled
 * content targets the {@link useStigmerPortalContainer} so it inherits the
 * active theme.
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
  mode = "manage",
  isPending = false,
  disabled = false,
  ariaLabel = "Resource visibility",
  className,
}: VisibilitySelectorProps) {
  const portalContainer = useStigmerPortalContainer();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();

  const [open, setOpen] = useState(false);
  // The Organization-style escalation awaiting its light inline confirm.
  const [pendingInline, setPendingInline] =
    useState<ApiResourceVisibility | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const effectivelyDisabled = disabled || isPending;

  // Keep the current state legible even when it is not offerable in the
  // current context: render its canonical option as an extra row.
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

  const apply = useCallback(
    (value: ApiResourceVisibility) => {
      setOpen(false);
      setPendingInline(null);
      onVisibilityChange(value);
    },
    [onVisibilityChange],
  );

  const handleSelect = useCallback(
    (option: VisibilityLevelOption) => {
      const value = option.value;
      if (value === visibility) {
        setPendingInline(null);
        setOpen(false);
        return;
      }

      // De-escalation (and create mode) never confirm — narrowing access is
      // always safe, and an initial pick has no escalation semantics.
      if (mode === "create" || !isEscalation(value)) {
        apply(value);
        return;
      }

      if (option.confirmDialog) {
        setOpen(false);
        setPendingInline(null);
        void confirm({
          title: option.confirmDialog.title,
          description: option.confirmDialog.description,
          confirmLabel: `Make ${option.label}`,
          // Exposure is reversible, so this is a primary (not destructive)
          // confirmation; the audience-naming copy carries the caution.
          variant: "default",
        }).then((ok) => {
          if (ok) onVisibilityChange(value);
        });
        return;
      }

      if (option.confirmPrompt) {
        setPendingInline(value);
        return;
      }

      apply(value);
    },
    [visibility, mode, isEscalation, apply, confirm, onVisibilityChange],
  );

  const moveFocus = useCallback(
    (from: number, delta: number) => {
      const count = effectiveOptions.length;
      const next = (from + delta + count) % count;
      setHighlightIdx(next);
      optionRefs.current[next]?.focus();
    },
    [effectiveOptions.length],
  );

  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (e.key) {
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          moveFocus(index, 1);
          break;
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          moveFocus(index, -1);
          break;
        case "Home":
          e.preventDefault();
          setHighlightIdx(0);
          optionRefs.current[0]?.focus();
          break;
        case "End": {
          e.preventDefault();
          const last = effectiveOptions.length - 1;
          setHighlightIdx(last);
          optionRefs.current[last]?.focus();
          break;
        }
      }
    },
    [moveFocus, effectiveOptions.length],
  );

  // On open, focus the current level so keyboard users land on a sensible row.
  useEffect(() => {
    if (!open) {
      setPendingInline(null);
      setHighlightIdx(-1);
      return;
    }
    const current = effectiveOptions.findIndex((o) => o.value === visibility);
    const start = current >= 0 ? current : 0;
    setHighlightIdx(start);
    const raf = requestAnimationFrame(() => optionRefs.current[start]?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, effectiveOptions, visibility]);

  const dialog = (
    <ConfirmDialog
      state={confirmState}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  );

  const renderRows = (role: "option" | "radio") =>
    effectiveOptions.map((option, index) => (
      <VisibilityOptionRow
        key={option.value}
        ref={(el) => {
          optionRefs.current[index] = el;
        }}
        option={option}
        role={role}
        isSelected={visibility === option.value}
        isHighlighted={role === "option" && highlightIdx === index}
        tabIndex={
          role === "radio"
            ? visibility === option.value
              ? 0
              : -1
            : highlightIdx === index
              ? 0
              : -1
        }
        disabled={effectivelyDisabled}
        onSelect={() => handleSelect(option)}
        onMouseEnter={
          role === "option" ? () => setHighlightIdx(index) : undefined
        }
        onKeyDown={(e) => handleRowKeyDown(e, index)}
      />
    ));

  // ---- Create mode: inline radio list, applies immediately ---------------
  if (mode === "create") {
    return (
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        aria-disabled={effectivelyDisabled || undefined}
        className={cn(
          "flex flex-col gap-0.5 rounded-md border border-border p-1",
          effectivelyDisabled && "pointer-events-none opacity-50",
          className,
        )}
      >
        {renderRows("radio")}
      </div>
    );
  }

  // ---- Manage mode: current-state chip + popover ladder ------------------
  const current = visibilityOption(visibility);
  const pendingOption =
    pendingInline !== null
      ? effectiveOptions.find((o) => o.value === pendingInline)
      : undefined;

  return (
    <>
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          disabled={effectivelyDisabled}
          aria-label={`${ariaLabel}: ${current.label}`}
          className={cn(
            VISIBILITY_CHIP_CLASS,
            "transition-colors hover:bg-accent-hover hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:pointer-events-none disabled:opacity-50",
            className,
          )}
        >
          {isPending ? (
            <span
              className="inline-block size-2.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
          ) : (
            <VisibilityIcon tone={current.tone} className="size-2.5" />
          )}
          {current.label}
          <CaretIcon />
        </Popover.Trigger>

        <Popover.Portal container={portalContainer}>
          <Popover.Positioner sideOffset={4} align="start">
            <Popover.Popup
              role="listbox"
              aria-label={ariaLabel}
              className={cn(
                "z-popover w-72 rounded-lg border border-border bg-popover p-1 shadow-md",
                "text-popover-foreground animate-in fade-in-0 zoom-in-95",
              )}
            >
              {renderRows("option")}

              {pendingOption?.confirmPrompt && (
                <div
                  role="alert"
                  className={cn(
                    "mt-1 flex items-center gap-2 rounded-md border px-2.5 py-1.5",
                    PROMPT_STYLES[pendingOption.tone].container,
                  )}
                >
                  <span
                    className={cn(
                      "flex-1 text-[0.65rem] leading-snug",
                      PROMPT_STYLES[pendingOption.tone].text,
                    )}
                  >
                    {pendingOption.confirmPrompt}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPendingInline(null)}
                    className={cn(
                      "rounded px-2 py-0.5 text-[0.65rem] font-medium",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      PROMPT_STYLES[pendingOption.tone].cancel,
                    )}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => apply(pendingOption.value)}
                    className={cn(
                      "rounded px-2 py-0.5 text-[0.65rem] font-medium text-white",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      PROMPT_STYLES[pendingOption.tone].confirm,
                    )}
                  >
                    Confirm
                  </button>
                </div>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {dialog}
    </>
  );
}

function CaretIcon() {
  return (
    <svg
      className="size-2.5 shrink-0 text-muted-foreground"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 4.5 6 7.5 9 4.5" />
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
 * silently blank. Shares the chip styling with the selector trigger so the
 * read-only and editable states are visually consistent.
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
    <span className={cn(VISIBILITY_CHIP_CLASS, className)}>
      <VisibilityIcon tone={option.tone} className="size-2.5" />
      {option.label}
    </span>
  );
}
