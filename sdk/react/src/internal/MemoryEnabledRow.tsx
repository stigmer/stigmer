"use client";

import { getUserMessage } from "@stigmer/client";
import { Switch } from "../switch/Switch.js";
import { SpinnerIcon } from "./SpinnerIcon.js";
import { FieldError } from "./form/Field.js";

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
   * The scope-specific helper copy (the memory transparency statement
   * belongs here). Rendered under the title, wired as the switch's
   * accessible description.
   */
  readonly helperText: string;
  /** The switch's name, under its section's title. Defaults to "Memory". */
  readonly label?: string;
}

/**
 * The `memory_enabled` consent toggle, its switch leading as every settings
 * switch's does — one row, shared verbatim by
 * {@link OrgPreferencesPanel} and {@link AccountPreferencesPanel} so the
 * two scopes of the double opt-in present identically.
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
  label = "Memory",
}: MemoryEnabledRowProps) {
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <div className="stg:space-y-1">
      <div className="stg:flex stg:items-start stg:gap-3">
        <span className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
          <Switch
            id={id}
            checked={checked}
            onCheckedChange={onToggle}
            disabled={saving || readOnly}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
          />
          {saving && <SpinnerIcon size={12} />}
        </span>
        <div className="stg:min-w-0 stg:flex-1">
          <span
            id={titleId}
            className="stg:block stg:text-sm stg:font-medium stg:text-foreground"
          >
            {label}
          </span>
          <p
            id={descriptionId}
            className="stg:m-0 stg:mt-1 stg:text-xs stg:text-muted-foreground"
          >
            {helperText}
          </p>
        </div>
      </div>
      {error && <FieldError>{getUserMessage(error)}</FieldError>}
    </div>
  );
}
