"use client";

// A setting that turns on and off: the kit's Switch, its label beside it in
// the field's label type, and its line under the label. The label names the
// switch and the line describes it, so a screen reader hears both.

import { useId, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { Switch } from "../../switch/Switch.js";

/** Props for {@link SwitchField}. */
export interface SwitchFieldProps {
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly className?: string;
}

/** A switch with its label and its line. */
export function SwitchField({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
}: SwitchFieldProps) {
  const made = useId();
  const switchId = id ?? `${made}-switch`;
  const labelId = `${made}-label`;
  const hintId = `${made}-hint`;
  return (
    <div className={cn("stg:flex stg:items-start stg:gap-3", className)}>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-labelledby={labelId}
        aria-describedby={hint !== undefined ? hintId : undefined}
      />
      <div className="stg:flex stg:min-w-0 stg:flex-col stg:gap-1">
        <label
          id={labelId}
          htmlFor={switchId}
          className="stg:text-sm stg:font-medium stg:text-foreground"
        >
          {label}
        </label>
        {hint !== undefined && (
          <p
            id={hintId}
            className="stg:m-0 stg:text-xs stg:text-muted-foreground"
          >
            {hint}
          </p>
        )}
      </div>
    </div>
  );
}
