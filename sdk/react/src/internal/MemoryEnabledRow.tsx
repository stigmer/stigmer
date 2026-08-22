"use client";

import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { Switch } from "../switch/Switch.js";
import { SpinnerIcon } from "./SpinnerIcon.js";

/** Props for {@link MemoryEnabledRow}. */
export interface MemoryEnabledRowProps {
  /** Id for the switch control (aria-labelledby wiring). */
  readonly id: string;
  /** The stored flag value (server state, or an optimistic pending value). */
  readonly checked: boolean;
  /** Fired with the next value when the user flips the switch. */
  readonly onToggle: (next: boolean) => void;
  /** `true` while the flip is being saved (switch disabled, spinner shown). */
  readonly saving: boolean;
  /** `true` when the caller may not edit the flag (read-only rendering). */
  readonly readOnly?: boolean;
  /** Error from the last failed flip, or `null`. */
  readonly error: Error | null;
  /**
   * The scope-specific helper copy (DD-006 D6's transparency statement
   * belongs here). Rendered under the title, wired as the switch's
   * accessible description.
   */
  readonly helperText: string;
}

/**
 * The `memory_enabled` consent toggle — one row, shared verbatim by
 * {@link OrgPreferencesPanel} and {@link AccountPreferencesPanel} so the
 * two scopes of the double opt-in (DD-006 D1) present identically.
 *
 * INSTANT-APPLY by deliberate exception (UX checkpoint, owner-approved
 * 2026-08-22): both host panels are save-button forms, but a consent bit
 * flipped-and-unsaved that silently reverts on navigation is exactly the
 * failure consent UX must not have — so this row saves the moment it is
 * flipped, matching the Switch primitive's own contract ("instant binary
 * changes") and every peer product's memory toggle. The helper copy
 * states it. Hosts wire `onToggle` to their own full-spec-replace update
 * and pass the in-flight/error state back down.
 */
export function MemoryEnabledRow({
  id,
  checked,
  onToggle,
  saving,
  readOnly = false,
  error,
  helperText,
}: MemoryEnabledRowProps) {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <div className="stg:space-y-1">
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3">
        <div className="stg:min-w-0 stg:flex-1">
          <span
            id={titleId}
            className="stg:block stg:text-xs stg:font-medium stg:text-foreground"
          >
            Memory
          </span>
          <p
            id={descriptionId}
            className="stg:text-[0.65rem] stg:leading-snug stg:text-muted-foreground"
          >
            {helperText}
          </p>
        </div>
        <span className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
          {saving && <SpinnerIcon size={12} />}
          <Switch
            id={id}
            checked={checked}
            onCheckedChange={onToggle}
            disabled={saving || readOnly}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          />
        </span>
      </div>
      {error && (
        <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}
    </div>
  );
}
