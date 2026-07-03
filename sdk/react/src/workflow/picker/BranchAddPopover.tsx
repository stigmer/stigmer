"use client";

import { memo, useState, useCallback, useRef, useEffect } from "react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/theme";
import { useStigmerPortalContainer } from "../../portal-container.js";

/** The type of branch being added. */
export type BranchAddMode = "switch-case" | "fork-branch" | "catch-handler";

export interface BranchAddResult {
  /** The name/identifier for the new branch. */
  readonly name: string;
  /** For switch cases: the condition expression. */
  readonly condition?: string;
  /** For catch handlers: the error type filter. */
  readonly errorType?: string;
}

export interface BranchAddPopoverProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (result: BranchAddResult) => void;
  readonly anchorRef: React.RefObject<HTMLElement | null>;
  readonly mode: BranchAddMode;
  /** Existing branch names to prevent duplicates. */
  readonly existingNames?: ReadonlySet<string>;
  readonly side?: "top" | "bottom" | "right" | "left";
  readonly align?: "start" | "center" | "end";
}

const MODE_CONFIG: Record<
  BranchAddMode,
  { title: string; namePlaceholder: string; nameLabel: string; showCondition: boolean; showErrorType: boolean }
> = {
  "switch-case": {
    title: "Add Case",
    namePlaceholder: "e.g. enterprise",
    nameLabel: "Case name",
    showCondition: true,
    showErrorType: false,
  },
  "fork-branch": {
    title: "Add Branch",
    namePlaceholder: "e.g. enrich_crm",
    nameLabel: "Branch name",
    showCondition: false,
    showErrorType: false,
  },
  "catch-handler": {
    title: "Add Catch Handler",
    namePlaceholder: "e.g. timeout_error",
    nameLabel: "Handler name",
    showCondition: false,
    showErrorType: true,
  },
};

/**
 * Inline popover for adding a branch to a switch_case, fork, or try_catch node.
 *
 * Renders a minimal form with contextual fields based on `mode`:
 * - switch-case: name + condition expression
 * - fork-branch: name only
 * - catch-handler: name + error type filter
 *
 * @since T08 (Contextual Task Picker)
 */
export const BranchAddPopover = memo(function BranchAddPopover({
  open,
  onOpenChange,
  onSubmit,
  anchorRef,
  mode,
  existingNames,
  side = "bottom",
  align = "start",
}: BranchAddPopoverProps) {
  const portalContainer = useStigmerPortalContainer();
  const config = MODE_CONFIG[mode];
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [condition, setCondition] = useState("");
  const [errorType, setErrorType] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setCondition("");
      setErrorType("");
      setNameError(null);
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  }, [open]);

  const validateAndSubmit = useCallback(() => {
    const trimmedName = name.trim();

    if (!trimmedName) {
      setNameError("Name is required");
      return;
    }

    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmedName)) {
      setNameError("Must start with a letter or underscore, alphanumeric only");
      return;
    }

    if (existingNames?.has(trimmedName)) {
      setNameError("This name already exists");
      return;
    }

    const result: BranchAddResult = {
      name: trimmedName,
      ...(config.showCondition && condition.trim() && { condition: condition.trim() }),
      ...(config.showErrorType && errorType.trim() && { errorType: errorType.trim() }),
    };

    onSubmit(result);
    onOpenChange(false);
  }, [name, condition, errorType, existingNames, config, onSubmit, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        validateAndSubmit();
      }
    },
    [validateAndSubmit],
  );

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal container={portalContainer}>
        <Popover.Positioner
          anchor={anchorRef}
          side={side}
          align={align}
          sideOffset={8}
        >
          <Popover.Popup
            className={cn(
              "stgm z-popover w-60 overflow-hidden rounded-lg border border-border bg-popover shadow-md text-popover-foreground",
            )}
          >
            <div className="flex flex-col" onKeyDown={handleKeyDown}>
              {/* Header */}
              <div className="border-b border-border px-3 py-2">
                <p className="text-xs font-semibold text-[var(--stgm-foreground,#1a1a2e)]">
                  {config.title}
                </p>
              </div>

              {/* Form fields */}
              <div className="space-y-2.5 p-3">
                {/* Name field */}
                <div>
                  <label className="mb-1 block text-[10px] font-medium text-[var(--stgm-muted-foreground,#737373)]">
                    {config.nameLabel}
                  </label>
                  <input
                    ref={nameRef}
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setNameError(null);
                    }}
                    placeholder={config.namePlaceholder}
                    className={cn(
                      "w-full rounded border bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#737373)] outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]",
                      nameError ? "border-[var(--stgm-destructive,#ef4444)]" : "border-border",
                    )}
                    aria-invalid={!!nameError}
                    aria-describedby={nameError ? "branch-name-error" : undefined}
                  />
                  {nameError && (
                    <p
                      id="branch-name-error"
                      className="mt-0.5 text-[10px] text-[var(--stgm-destructive,#ef4444)]"
                    >
                      {nameError}
                    </p>
                  )}
                </div>

                {/* Condition field (switch-case only) */}
                {config.showCondition && (
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-[var(--stgm-muted-foreground,#737373)]">
                      Condition
                      <span className="ml-1 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={condition}
                      onChange={(e) => setCondition(e.target.value)}
                      placeholder='e.g. $.plan == "enterprise"'
                      className="w-full rounded border border-border bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] px-2 py-1.5 text-xs font-mono text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#737373)] outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
                    />
                  </div>
                )}

                {/* Error type field (catch-handler only) */}
                {config.showErrorType && (
                  <div>
                    <label className="mb-1 block text-[10px] font-medium text-[var(--stgm-muted-foreground,#737373)]">
                      Error type filter
                      <span className="ml-1 font-normal">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={errorType}
                      onChange={(e) => setErrorType(e.target.value)}
                      placeholder="e.g. TimeoutError"
                      className="w-full rounded border border-border bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#737373)] outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
                    />
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="button"
                  onClick={validateAndSubmit}
                  className="w-full rounded bg-[var(--stgm-primary,#3b82f6)] px-3 py-1.5 text-xs font-medium text-[var(--stgm-primary-foreground,#fff)] transition-colors hover:bg-[var(--stgm-primary,#3b82f6)]/90 focus:outline-none focus:ring-2 focus:ring-[var(--stgm-ring,#3b82f6)] focus:ring-offset-1"
                >
                  {config.title}
                </button>
              </div>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
});
