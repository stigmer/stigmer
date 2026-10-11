"use client";

import { useCallback, useId, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { useCreateApiKey } from "./useCreateApiKey.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import {
  DEFAULT_KEY_EXPIRY,
  KeyExpiryFieldset,
  keyExpiryFields,
  type KeyExpiryOption,
} from "./KeyExpiryFieldset.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link CreateApiKeyForm}. */
export interface CreateApiKeyFormProps {
  /**
   * The active organization's id (a slug is also accepted): the key's
   * `metadata.org`, and the organization **This organization only** limits
   * the key to (`spec.bound_org`).
   */
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

/**
 * Compact form for creating a new API key.
 *
 * Collects a **name** (required), an **expiry** choice (30 / 60 /
 * 90 days or never) and **This organization only** (checked by default,
 * which limits the key to `org`: it is refused in every other organization;
 * unchecked, the key works in every organization the owner's sign-in reaches),
 * then creates the key via {@link useCreateApiKey}.
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
  const [expiry, setExpiry] = useState<KeyExpiryOption>(DEFAULT_KEY_EXPIRY);
  const [thisOrgOnly, setThisOrgOnly] = useState(true);

  const trimmedName = name.trim();
  // A limit needs an organization to name: with none active yet, an empty
  // `bound_org` would mint a key that works everywhere, so the limited
  // key waits for one rather than silently becoming unlimited.
  const limitWithoutOrg = thisOrgOnly && org === "";
  const canSubmit = trimmedName !== "" && !isCreating && !limitWithoutOrg;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;

      clearError();
      try {
        const apiKey = await create({
          name: trimmedName,
          org,
          ...(thisOrgOnly ? { boundOrg: org } : {}),
          ...keyExpiryFields(expiry),
        });
        onCreated?.(apiKey);
      } catch {
        // error state is managed by useCreateApiKey
      }
    },
    [
      canSubmit,
      trimmedName,
      org,
      thisOrgOnly,
      expiry,
      create,
      clearError,
      onCreated,
    ],
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

        <KeyExpiryFieldset
          value={expiry}
          onChange={setExpiry}
          disabled={isCreating}
        />

        {/* Organization limit */}
        <div className="stg:space-y-0.5">
          <label className="stg:inline-flex stg:cursor-pointer stg:items-center stg:gap-2 stg:text-xs stg:font-medium stg:text-foreground">
            <input
              type="checkbox"
              checked={thisOrgOnly}
              disabled={isCreating}
              onChange={(e) => setThisOrgOnly(e.target.checked)}
              aria-describedby={`${baseId}-org-only-hint`}
            />
            This organization only
          </label>
          <p
            id={`${baseId}-org-only-hint`}
            className="stg:text-[0.65rem] stg:text-muted-foreground"
          >
            {limitWithoutOrg
              ? "Open an organization to limit the key to it, or clear the box."
              : thisOrgOnly
                ? "The key works in this organization and is refused in every other one."
                : "The key works in every organization your sign-in reaches."}
          </p>
        </div>
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
