"use client";

import { cn } from "@stigmer/theme";

// ---------------------------------------------------------------------------
// Shared form primitives for the operator pricing surfaces (BaselineEditor,
// RetireConfirm, the console's search inputs). Internal — not exported
// from the billing barrel.
// ---------------------------------------------------------------------------

/** Standard text-input styling for the pricing surfaces. */
export const INPUT_CLASSES = cn(
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
  "placeholder:text-muted-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-50",
);

/** Labelled form field wrapper. */
export function Field({
  label,
  required,
  className,
  children,
}: {
  readonly label: string;
  readonly required?: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}

/** Dollar-rate input field (decimal keypad, "$ per million tokens"). */
export function RateField({
  label,
  value,
  placeholder,
  disabled,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <input
        className={INPUT_CLASSES}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "0.00"}
        disabled={disabled}
      />
    </Field>
  );
}
