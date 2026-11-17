"use client";

/**
 * The expiry choice every API key form offers: 30, 60 or 90 days, or never.
 *
 * One control for a person's own key (`CreateApiKeyForm`) and a service
 * account's (`CreateServiceAccountKeyForm`), so the two forms cannot drift
 * in what lifetimes they offer. Not exported from the package barrel.
 */
import { useId } from "react";
import { ChoiceGroup } from "../internal/form/ChoiceGroup.js";

/** A key lifetime the forms offer. */
export type KeyExpiryOption = "30" | "60" | "90" | "never";

/**
 * The lifetime a key form starts on: 90 days, as the CLI and the service
 * account guide make them, so a key made for a script and forgotten stops
 * on its own. Never stays one click away (stigmer#2910).
 */
export const DEFAULT_KEY_EXPIRY: KeyExpiryOption = "90";

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

/** The "Expires" choice: the kit's segmented choice group in a field. */
export function KeyExpiryFieldset({
  value,
  onChange,
  disabled = false,
}: KeyExpiryFieldsetProps) {
  const labelId = useId();
  return (
    <div className="stg:flex stg:flex-col stg:gap-1.5">
      <span
        id={labelId}
        className="stg:text-sm stg:font-medium stg:text-foreground"
      >
        Expires
      </span>
      <ChoiceGroup
        aria-labelledby={labelId}
        value={value}
        onChange={onChange}
        options={EXPIRY_OPTIONS}
        disabled={disabled}
      />
    </div>
  );
}
