"use client";

import { useCallback, useId, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { useCreateApiKey } from "./useCreateApiKey.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link CreateApiKeyForm}. */
export interface CreateApiKeyFormProps {
  /** Organization slug used as the `org` field when creating the key. */
  readonly org: string;
  /**
   * Fired with the newly created API key after successful creation.
   * The `spec.keyHash` field of the returned key contains the raw
   * key value — available only at this moment.
   */
  readonly onCreated?: (apiKey: ApiKey) => void;
  /** Fired when the user cancels creation. */
  readonly onCancel?: () => void;
  /**
   * Seeds the name field on mount (e.g. a suggested key name, or a demo
   * scenario depicting the form mid-fill). One-time: consumed on mount;
   * subsequent changes are ignored. The field stays fully editable.
   */
  readonly initialName?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

type ExpiryOption = "30" | "60" | "90" | "never";

/**
 * Compact form for creating a new API key.
 *
 * Collects a **name** (required) and an **expiry** choice (30 / 60 /
 * 90 days or never), then creates the key via {@link useCreateApiKey}.
 * On success it fires `onCreated` with the full {@link ApiKey}
 * response, which includes the raw key in `spec.keyHash`.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <CreateApiKeyForm
 *   org="acme"
 *   onCreated={(key) => setRevealedKey(key)}
 *   onCancel={() => setShowForm(false)}
 * />
 * ```
 */
export function CreateApiKeyForm({
  org,
  onCreated,
  onCancel,
  initialName = "",
  className,
}: CreateApiKeyFormProps) {
  const { create, isCreating, error, clearError } = useCreateApiKey();
  const baseId = useId();

  const [name, setName] = useState(initialName);
  const [expiry, setExpiry] = useState<ExpiryOption>("never");

  const trimmedName = name.trim();
  const canSubmit = trimmedName !== "" && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      clearError();
      try {
        const apiKey = await create({
          name: trimmedName,
          org,
          ...(expiry === "never"
            ? { neverExpires: true }
            : { expiresAt: daysFromNow(Number(expiry)) }),
        });
        onCreated?.(apiKey);
      } catch {
        // error state is managed by useCreateApiKey
      }
    },
    [canSubmit, trimmedName, org, expiry, create, clearError, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
      <div className="stg:space-y-3">
        {/* Name */}
        <div className="stg:space-y-1">
          <label
            htmlFor={`${baseId}-name`}
            className="stg:text-xs stg:font-medium stg:text-foreground"
          >
            Name
          </label>
          <input
            id={`${baseId}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ci-deploy-key"
            disabled={isCreating}
            autoFocus
            required
            className={cn(
              "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
              "stg:placeholder:text-muted-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          />
        </div>

        {/* Expiry */}
        <fieldset className="stg:space-y-1.5">
          <legend className="stg:text-xs stg:font-medium stg:text-foreground">
            Expiration
          </legend>
          <div className="stg:flex stg:flex-wrap stg:gap-2">
            {/* The radio-group name is minted per mount: a hardcoded name
                would merge two mounted forms into one keyboard group. */}
            {EXPIRY_OPTIONS.map(({ value, label }) => (
              <ExpiryRadio
                key={value}
                name={`${baseId}-expiry`}
                value={value}
                label={label}
                checked={expiry === value}
                disabled={isCreating}
                onChange={setExpiry}
              />
            ))}
          </div>
        </fieldset>
      </div>

      {error && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="stg:flex stg:items-center stg:gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon size={12} />}
          Create API key
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Expiry helpers
// ---------------------------------------------------------------------------

const EXPIRY_OPTIONS: { value: ExpiryOption; label: string }[] = [
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "never", label: "Never" },
];

function daysFromNow(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

// ---------------------------------------------------------------------------
// ExpiryRadio (internal)
// ---------------------------------------------------------------------------

function ExpiryRadio({
  name,
  value,
  label,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  value: ExpiryOption;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: ExpiryOption) => void;
}) {
  return (
    <label
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
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="stg:sr-only"
      />
      {label}
    </label>
  );
}

