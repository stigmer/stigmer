"use client";

/**
 * The form that creates an API key for a service account: a name and an
 * expiry, the same choices a person's own key offers, without the
 * organization limit, because a service account's key always works in its
 * organization alone.
 *
 * Used twice: as the offer of a first key right after a service account is
 * created, and from the account's detail panel. The caller shows the key the
 * create returns (`ApiKeyCreatedAlert`): its raw value is in
 * `spec.keyHash` this once.
 */
import { useCallback, useId, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import {
  DEFAULT_KEY_EXPIRY,
  KeyExpiryFieldset,
  keyExpiryFields,
  type KeyExpiryOption,
} from "../api-key/KeyExpiryFieldset.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { useCreateServiceAccountKey } from "./useCreateServiceAccountKey.js";

/** Props for {@link CreateServiceAccountKeyForm}. */
export interface CreateServiceAccountKeyFormProps {
  /** The service account the key speaks for, by id. */
  readonly serviceAccountId: string;
  /** The service account's name, for the form's explanation. */
  readonly serviceAccountName: string;
  /** Fired with the created key, its raw value in `spec.keyHash`. */
  readonly onCreated?: (apiKey: ApiKey) => void;
  /** Fired when the user declines. Omit to offer no way out. */
  readonly onCancel?: () => void;
  /** The decline button's label. Defaults to "Cancel". */
  readonly cancelLabel?: string;
  /** Seeds the name field on mount; the field stays editable. */
  readonly initialName?: string;
  readonly className?: string;
}

/**
 * Compact form for creating a service account's API key.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <CreateServiceAccountKeyForm
 *   serviceAccountId={account.metadata!.id}
 *   serviceAccountName="ci-deploy"
 *   onCreated={(key) => setRevealed(key)}
 *   onCancel={() => setCreating(false)}
 * />
 * ```
 */
export function CreateServiceAccountKeyForm({
  serviceAccountId,
  serviceAccountName,
  onCreated,
  onCancel,
  cancelLabel = "Cancel",
  initialName = "",
  className,
}: CreateServiceAccountKeyFormProps) {
  const { create, isCreating, error, clearError } = useCreateServiceAccountKey();
  const baseId = useId();
  const [name, setName] = useState(initialName);
  const [expiry, setExpiry] = useState<KeyExpiryOption>(DEFAULT_KEY_EXPIRY);

  const trimmedName = name.trim();
  const canSubmit = trimmedName !== "" && serviceAccountId !== "" && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      clearError();
      try {
        const apiKey = await create({
          serviceAccountId,
          name: trimmedName,
          ...keyExpiryFields(expiry),
        });
        onCreated?.(apiKey);
      } catch {
        // error state is managed by useCreateServiceAccountKey
      }
    },
    [canSubmit, clearError, create, serviceAccountId, trimmedName, expiry, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
      <p className="stg:text-xs stg:text-muted-foreground">
        The key speaks for {serviceAccountName}, not for you: it works only in
        this organization, and it keeps working if you leave.
      </p>

      <div className="stg:space-y-1">
        <label
          htmlFor={`${baseId}-name`}
          className="stg:text-xs stg:font-medium stg:text-foreground"
        >
          Key name
        </label>
        <input
          id={`${baseId}-name`}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. github-actions"
          disabled={isCreating}
          required
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        />
      </div>

      <KeyExpiryFieldset value={expiry} onChange={setExpiry} disabled={isCreating} />

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
          Create key
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
            {cancelLabel}
          </button>
        )}
      </div>
    </form>
  );
}
