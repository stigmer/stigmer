"use client";

import { useCallback, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { useCreateApiKey } from "./useCreateApiKey.js";

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
    <form onSubmit={handleSubmit} className={cn("space-y-3", className)}>
      <div className="space-y-3">
        {/* Name */}
        <div className="space-y-1">
          <label
            htmlFor="stgm-new-apikey-name"
            className="text-xs font-medium text-foreground"
          >
            Name
          </label>
          <input
            id="stgm-new-apikey-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ci-deploy-key"
            disabled={isCreating}
            autoFocus
            required
            className={cn(
              "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
              "placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          />
        </div>

        {/* Expiry */}
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium text-foreground">
            Expiration
          </legend>
          <div className="flex flex-wrap gap-2">
            {EXPIRY_OPTIONS.map(({ value, label }) => (
              <ExpiryRadio
                key={value}
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
        <p className="text-destructive text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "disabled:pointer-events-none disabled:opacity-40",
          )}
        >
          {isCreating && <SpinnerIcon />}
          Create API key
        </button>

        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isCreating}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "disabled:pointer-events-none disabled:opacity-50",
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
  value,
  label,
  checked,
  disabled,
  onChange,
}: {
  value: ExpiryOption;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: ExpiryOption) => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center rounded-md border px-2.5 py-1 text-xs transition-colors",
        checked
          ? "border-primary bg-primary-subtle text-primary font-medium"
          : "border-input bg-background text-muted-foreground hover:border-border hover:text-foreground",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <input
        type="radio"
        name="stgm-apikey-expiry"
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="sr-only"
      />
      {label}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
