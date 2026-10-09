"use client";

/**
 * The form an organization's admin creates a shared vault with: a name, and
 * optionally what it is for and the integrator's own id for it. Entries are
 * added after creation, through the entries editor; sharing is set on the
 * vault itself.
 */
import { type FormEvent, useCallback, useId, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { INPUT_CLASS, PRIMARY_BUTTON_CLASS, QUIET_BUTTON_CLASS } from "./styles.js";
import { useCreateVault } from "./useCreateVault.js";

/** Props for {@link CreateVaultForm}. */
export interface CreateVaultFormProps {
  /** Organization the vault belongs to (id or slug). */
  readonly org: string;
  /** Fired with the created vault. */
  readonly onCreated?: (vault: Vault) => void;
  /** Fired when the user cancels. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Compact form for creating a shared vault.
 *
 * @example
 * ```tsx
 * <CreateVaultForm org="acme" onCreated={() => refetch()} />
 * ```
 */
export function CreateVaultForm({
  org,
  onCreated,
  onCancel,
  className,
}: CreateVaultFormProps) {
  const baseId = useId();
  const { create, isCreating, error, clearError } = useCreateVault();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [externalId, setExternalId] = useState("");

  const trimmedName = name.trim();
  const canSubmit = trimmedName !== "" && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      try {
        const vault = await create({
          org,
          name: trimmedName,
          description: description.trim() || undefined,
          externalId: externalId.trim() || undefined,
        });
        setName("");
        setDescription("");
        setExternalId("");
        onCreated?.(vault);
      } catch {
        // Surfaced through `error`.
      }
    },
    [canSubmit, create, org, trimmedName, description, externalId, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-name`} className="stg:text-xs stg:font-medium stg:text-foreground">
          Name
        </label>
        <input
          id={`${baseId}-name`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            clearError();
          }}
          placeholder="Support tools"
          disabled={isCreating}
          className={INPUT_CLASS}
          autoFocus
        />
      </div>
      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-description`} className="stg:text-xs stg:font-medium stg:text-muted-foreground">
          Description <span className="stg:text-muted-foreground-subtle">(optional)</span>
        </label>
        <input
          id={`${baseId}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="The support team's Zendesk key"
          disabled={isCreating}
          className={INPUT_CLASS}
        />
      </div>
      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-external`} className="stg:text-xs stg:font-medium stg:text-muted-foreground">
          External id <span className="stg:text-muted-foreground-subtle">(optional, your own id for it)</span>
        </label>
        <input
          id={`${baseId}-external`}
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="customer-1234"
          disabled={isCreating}
          className={INPUT_CLASS}
        />
      </div>
      {error && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}
      <div className="stg:flex stg:items-center stg:gap-2">
        <button type="submit" disabled={!canSubmit} className={PRIMARY_BUTTON_CLASS}>
          {isCreating && <SpinnerIcon />}
          Create vault
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={isCreating} className={QUIET_BUTTON_CLASS}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
