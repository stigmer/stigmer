"use client";

/**
 * The form an organization's admin creates a shared vault with: a name, and
 * optionally what it is for and the integrator's own id for it. Entries are
 * added after creation, through the entries editor; sharing is set on the
 * vault itself.
 */
import { type FormEvent, useCallback, useId, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { useCreateVault } from "./useCreateVault.js";
import { Button } from "../button/Button.js";
import { FIELD_LABEL_CLASSES, FieldError, TextInput } from "../internal/form/index.js";

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
 * function NewVault({ onCreated }: { onCreated: () => void }) {
 *   return <CreateVaultForm org="acme" onCreated={onCreated} />;
 * }
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
        <label htmlFor={`${baseId}-name`} className={FIELD_LABEL_CLASSES}>
          Name
        </label>
        <TextInput
          id={`${baseId}-name`}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            clearError();
          }}
          placeholder="Ledger keys"
          disabled={isCreating}
          autoFocus
        />
      </div>
      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-description`} className={FIELD_LABEL_CLASSES}>
          Description <span className="stg:text-muted-foreground">(optional)</span>
        </label>
        <TextInput
          id={`${baseId}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="The finance team's ledger key"
          disabled={isCreating}
        />
      </div>
      <div className="stg:space-y-1">
        <label htmlFor={`${baseId}-external`} className={FIELD_LABEL_CLASSES}>
          External id <span className="stg:text-muted-foreground">(optional, your own id for it)</span>
        </label>
        <TextInput
          id={`${baseId}-external`}
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="customer-1234"
          disabled={isCreating}
        />
      </div>
      {error && (
        <FieldError>
          {getUserMessage(error)}
        </FieldError>
      )}
      <div className="stg:flex stg:items-center stg:gap-2">
        <Button type="submit" disabled={!canSubmit} icon={isCreating ? <SpinnerIcon /> : undefined}>
          Create vault
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={isCreating}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
