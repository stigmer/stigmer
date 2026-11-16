"use client";

// A field: its label, its control, then its hint or its error. The label
// names the control (`htmlFor`), the hint or the error describes it
// (`aria-describedby`) and an error marks it invalid (`aria-invalid`), all
// wired here through context, so no form wires them by hand. An error
// replaces the hint: it is the person's to fix, so it never carries the help
// line a form's failure does (`ErrorMessage`).
//
// Sizes: the label 14/20 medium in the foreground, the hint 12/16 muted, the
// error 12/16 in the failed status hue with its icon; 8px between them.

import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { CircleAlert } from "lucide-react";
import { FIELD_HINT_CLASSES, FIELD_LABEL_CLASSES } from "./fieldClasses.js";

/** What a field tells the control inside it: its id, what describes it, and whether it is in error. */
export interface FieldWiring {
  readonly id: string;
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
}

const FieldContext = createContext<FieldWiring | null>(null);

/** The wiring of the field a control sits in, or null outside one. */
export function useFieldWiring(): FieldWiring | null {
  return useContext(FieldContext);
}

/** Merges a control's own props with its field's wiring: inside a field the field's id names it (pass `id` to the `Field`), and the control's own descriptions come first. */
export function wireControl(
  wiring: FieldWiring | null,
  own: {
    readonly id?: string;
    readonly "aria-describedby"?: string;
    readonly "aria-invalid"?: boolean | "true" | "false";
    readonly invalid?: boolean;
  },
): {
  id: string | undefined;
  "aria-describedby": string | undefined;
  "aria-invalid": true | undefined;
  invalid: boolean;
} {
  const invalid =
    own.invalid === true ||
    own["aria-invalid"] === true ||
    own["aria-invalid"] === "true" ||
    (wiring?.invalid ?? false);
  const describedBy = [own["aria-describedby"], wiring?.describedBy]
    .filter((x): x is string => typeof x === "string" && x !== "")
    .join(" ");
  return {
    id: wiring?.id ?? own.id,
    "aria-describedby": describedBy === "" ? undefined : describedBy,
    "aria-invalid": invalid ? true : undefined,
    invalid,
  };
}

/** Props for {@link Field}. */
export interface FieldProps {
  /** The field's name, shown above the control and naming it. */
  readonly label: ReactNode;
  /** Draws "(optional)" after the label. */
  readonly optional?: boolean;
  /** A line under the control: what to write, what happens. Hidden while there is an error. */
  readonly hint?: ReactNode;
  /** What's wrong with the value, under the control. Marks the control invalid. */
  readonly error?: ReactNode;
  /** The control's id, when the form needs to know it; one is made otherwise. */
  readonly id?: string;
  /** Hides the label from sight (`sr-only`) while it still names the control: for a control whose row already says what it is. */
  readonly labelHidden?: boolean;
  /** The control: one of the form parts, which reads its wiring from here. */
  readonly children: ReactNode;
  readonly className?: string;
}

/** A label, a control, and its hint or its error, wired to each other. */
export function Field({
  label,
  optional,
  hint,
  error,
  id,
  labelHidden,
  children,
  className,
}: FieldProps) {
  const made = useId();
  const controlId = id ?? `${made}-control`;
  const hintId = `${made}-hint`;
  const errorId = `${made}-error`;
  const hasError =
    error !== undefined && error !== null && error !== false && error !== "";
  const hasHint =
    !hasError &&
    hint !== undefined &&
    hint !== null &&
    hint !== false &&
    hint !== "";
  const wiring: FieldWiring = {
    id: controlId,
    describedBy: hasError ? errorId : hasHint ? hintId : undefined,
    invalid: hasError,
  };
  return (
    <div
      className={cn("stg:flex stg:min-w-0 stg:flex-col stg:gap-2", className)}
    >
      <label
        htmlFor={controlId}
        className={labelHidden ? "stg:sr-only" : FIELD_LABEL_CLASSES}
      >
        {label}
        {optional && (
          <span className="stg:font-normal stg:text-muted-foreground">
            {" "}
            (optional)
          </span>
        )}
      </label>
      <FieldContext.Provider value={wiring}>{children}</FieldContext.Provider>
      {hasError && <FieldError id={errorId}>{error}</FieldError>}
      {hasHint && (
        <p id={hintId} className={FIELD_HINT_CLASSES}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** A field's error line: the failed status hue with its icon, announced as it appears. */
export function FieldError({
  id,
  children,
  className,
}: {
  readonly id?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <p
      id={id}
      role="alert"
      className={cn(
        "stg:m-0 stg:flex stg:items-start stg:gap-1 stg:text-xs stg:text-status-failed",
        className,
      )}
    >
      <CircleAlert
        className="stg:mt-px stg:size-3.5 stg:shrink-0"
        aria-hidden="true"
      />
      {children}
    </p>
  );
}

/** A field's hint line, for a control drawn outside a `Field` (a checkbox's or a switch's own words). */
export function FieldHint({
  id,
  children,
  className,
}: {
  readonly id?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <p id={id} className={cn(FIELD_HINT_CLASSES, className)}>
      {children}
    </p>
  );
}

/** A label for a group of controls (a radio list, a set of checkboxes): the field's label type, not tied to one control. */
export function FieldLegend({
  id,
  children,
  optional,
  className,
}: {
  readonly id?: string;
  readonly children: ReactNode;
  readonly optional?: boolean;
  readonly className?: string;
}) {
  return (
    <span id={id} className={cn(FIELD_LABEL_CLASSES, className)}>
      {children}
      {optional && (
        <span className="stg:font-normal stg:text-muted-foreground">
          {" "}
          (optional)
        </span>
      )}
    </span>
  );
}
