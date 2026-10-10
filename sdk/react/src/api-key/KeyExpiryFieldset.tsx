"use client";

/**
 * The expiry choice every API key form offers: 30, 60 or 90 days, or never.
 *
 * One control for a person's own key (`CreateApiKeyForm`) and a service
 * account's (`CreateServiceAccountKeyForm`), so the two forms cannot drift
 * in what lifetimes they offer. The radio-group name is minted per mount: a
 * fixed name would merge two mounted forms into one keyboard group. Not
 * exported from the package barrel.
 */
import { useId } from "react";
import { cn } from "@stigmer/theme";
import { UNSTYLED_FIELDSET } from "../internal/element-resets.js";

/** A key lifetime the forms offer. */
export type KeyExpiryOption = "30" | "60" | "90" | "never";

/** The lifetime a key form starts on. */
export const DEFAULT_KEY_EXPIRY: KeyExpiryOption = "never";

const EXPIRY_OPTIONS: readonly { value: KeyExpiryOption; label: string }[] = [
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "never", label: "Never" },
];

/** The create request's expiry fields for a choice, read at submit time. */
export function keyExpiryFields(
  option: KeyExpiryOption,
): { readonly neverExpires: true } | { readonly expiresAt: Date } {
  if (option === "never") return { neverExpires: true };
  const date = new Date();
  date.setDate(date.getDate() + Number(option));
  return { expiresAt: date };
}

/** Props for {@link KeyExpiryFieldset}. */
export interface KeyExpiryFieldsetProps {
  readonly value: KeyExpiryOption;
  readonly onChange: (value: KeyExpiryOption) => void;
  readonly disabled?: boolean;
}

/** The "Expiration" radio group. */
export function KeyExpiryFieldset({
  value,
  onChange,
  disabled = false,
}: KeyExpiryFieldsetProps) {
  const name = useId();
  return (
    <fieldset className={cn(UNSTYLED_FIELDSET, "stg:space-y-1.5")}>
      <legend className="stg:text-xs stg:font-medium stg:text-foreground">
        Expiration
      </legend>
      <div className="stg:flex stg:flex-wrap stg:gap-2">
        {EXPIRY_OPTIONS.map((option) => {
          const checked = value === option.value;
          return (
            <label
              key={option.value}
              className={cn(
                "stg:inline-flex stg:cursor-pointer stg:items-center stg:rounded-md stg:border stg:px-2.5 stg:py-1 stg:text-xs stg:transition-colors",
                checked
                  ? "stg:border-primary stg:bg-primary-subtle stg:text-primary stg:font-medium"
                  : "stg:border-input stg:bg-background stg:text-muted-foreground stg:hover:border-border stg:hover:text-foreground",
                disabled && "stg:pointer-events-none stg:opacity-50",
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(option.value)}
                className="stg:sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
