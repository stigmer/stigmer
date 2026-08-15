"use client";

import type { ReactNode } from "react";
import { cn } from "@stigmer/theme";

/**
 * Both `OrganizationPreferences.standing_context` and
 * `IdentityAccountPreferences.standing_context` pin `max_len = 2000`
 * (buf.validate, spec.proto in each package).
 */
export const STANDING_CONTEXT_MAX_LEN = 2000;
/** Show the remaining-characters counter once within this margin. */
const COUNTER_THRESHOLD = 200;

/** Props for {@link StandingContextField}. */
export interface StandingContextFieldProps {
  /** DOM id for the textarea (label association). */
  readonly id: string;
  /** Current field value. */
  readonly value: string;
  /** Fired with the new value on every edit. */
  readonly onChange: (value: string) => void;
  /** Disables editing while a save is in flight. */
  readonly disabled?: boolean;
  /**
   * Renders the field as read-only (still selectable/copyable) for
   * viewers without edit permission.
   */
  readonly readOnly?: boolean;
  /** Example text shown when the field is empty. */
  readonly placeholder?: string;
  /** Helper line rendered under the textarea. */
  readonly helperText?: ReactNode;
}

/**
 * Shared textarea for declared-preference standing context — the one
 * free-text field both the organization and account preference editors
 * render. Owns the proto length cap and the remaining-characters
 * counter; the parent panel owns label, load/save, and dirty state.
 *
 * Internal to `@stigmer/react` — the public surface is the panels.
 */
export function StandingContextField({
  id,
  value,
  onChange,
  disabled,
  readOnly,
  placeholder,
  helperText,
}: StandingContextFieldProps) {
  const remaining = STANDING_CONTEXT_MAX_LEN - value.length;

  return (
    <div className="stg:space-y-1">
      <label
        htmlFor={id}
        className="stg:text-xs stg:font-medium stg:text-foreground"
      >
        Standing context
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={STANDING_CONTEXT_MAX_LEN}
        rows={6}
        disabled={disabled}
        readOnly={readOnly}
        placeholder={readOnly ? undefined : placeholder}
        className={cn(
          "stg:w-full stg:resize-y stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
          "stg:placeholder:text-muted-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          readOnly && "stg:bg-muted-subtle stg:text-muted-foreground",
        )}
      />
      {helperText && (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          {helperText}
        </p>
      )}
      {!readOnly && remaining <= COUNTER_THRESHOLD && (
        <p className="stg:text-[0.65rem] stg:text-muted-foreground">
          {remaining} characters left
        </p>
      )}
    </div>
  );
}
