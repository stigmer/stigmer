"use client";

/**
 * The form that saves a credential: its name, what it is for, whose it
 * is, what it is used for by default, and (on create) its first values.
 *
 * Whose it is: yours, or the organization's. The organization's is
 * offered only to someone the server confirms may save it (an admin), so
 * a member is never shown a choice the server would refuse; a member's
 * form has no owner choice at all and saves a credential of their own.
 * The owner never changes after create, so the edit form shows it as a
 * fact rather than a control.
 *
 * Values are secret by default: each new field is typed into a password
 * input, and "plain" marks configuration that may be read back. On edit,
 * values are edited in the credential's own field editor, beside this
 * form, one at a time.
 *
 * Pinned by `__tests__/CredentialForm.test.tsx`.
 */
import { type FormEvent, useCallback, useId, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, type CredentialFieldInput } from "@stigmer/sdk";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { INPUT_CLASSES } from "../internal/form-primitives.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { UNSTYLED_FIELDSET, UNSTYLED_LIST } from "../internal/element-resets.js";
import {
  credentialOwnerKind,
  servedTargets,
  type CredentialOwnerKind,
  type CredentialTargetRef,
} from "./model.js";
import { CredentialServesEditor } from "./CredentialServesEditor.js";
import { useCanManageOrgCredentials } from "./useCanManageOrgCredentials.js";
import { useCreateCredential } from "./useCreateCredential.js";
import { useUpdateCredential } from "./useUpdateCredential.js";

const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Props for {@link CredentialForm}. */
export interface CredentialFormProps {
  /** The organization the credential lives in (an id; a slug is also accepted). */
  readonly org: string;
  /** The credential to edit; omitted to create one. */
  readonly credential?: Credential;
  /** The owner a new credential starts with. @default "person" */
  readonly defaultOwner?: CredentialOwnerKind;
  /** Targets a new credential starts serving (an agent the person came from). */
  readonly defaultServes?: readonly CredentialTargetRef[];
  /** Fired with the credential as stored after a save. */
  readonly onSaved?: (credential: Credential) => void;
  /** Fired when the person cancels. */
  readonly onCancel?: () => void;
  /** Additional CSS class names for the root form. */
  readonly className?: string;
}

interface DraftField {
  readonly id: number;
  readonly name: string;
  readonly value: string;
  readonly plain: boolean;
}

/**
 * Creates or edits a credential.
 *
 * @example
 * ```tsx
 * <CredentialForm org={org} onSaved={() => setShowForm(false)} />
 * <CredentialForm org={org} credential={credential} onSaved={refetch} />
 * ```
 */
export function CredentialForm({
  org,
  credential,
  defaultOwner = "person",
  defaultServes,
  onSaved,
  onCancel,
  className,
}: CredentialFormProps) {
  const baseId = useId();
  const editing = credential !== undefined;
  const { allowed: canManageOrg } = useCanManageOrgCredentials(editing ? null : org);
  const { create, isCreating, error: createError, clearError: clearCreateError } = useCreateCredential();
  const { update, isUpdating, error: updateError, clearError: clearUpdateError } = useUpdateCredential();

  const [name, setName] = useState(credential?.metadata?.name ?? "");
  const [description, setDescription] = useState(credential?.spec?.description ?? "");
  const [owner, setOwner] = useState<CredentialOwnerKind>(
    credential ? (credentialOwnerKind(credential) ?? "person") : defaultOwner,
  );
  const [serves, setServes] = useState<CredentialTargetRef[]>(() =>
    credential ? servedTargets(credential) : [...(defaultServes ?? [])],
  );
  const [fields, setFields] = useState<DraftField[]>(() =>
    editing ? [] : [{ id: 0, name: "", value: "", plain: false }],
  );
  const [nextFieldId, setNextFieldId] = useState(1);

  // The organization's is offered only to an admin; a choice made before
  // the answer arrived never survives a "no".
  const effectiveOwner: CredentialOwnerKind = editing || canManageOrg ? owner : "person";

  const isSaving = isCreating || isUpdating;
  const error = createError ?? updateError;
  const trimmedName = name.trim();

  const filledFields = useMemo(
    () => fields.filter((field) => field.name.trim() !== "" || field.value !== ""),
    [fields],
  );
  const invalidField = filledFields.find((field) => !FIELD_NAME_PATTERN.test(field.name.trim()));
  const duplicateField = useMemo(() => {
    const seen = new Set<string>();
    for (const field of filledFields) {
      const key = field.name.trim();
      if (seen.has(key)) return key;
      seen.add(key);
    }
    return undefined;
  }, [filledFields]);
  const canSubmit =
    trimmedName !== "" && !isSaving && invalidField === undefined && duplicateField === undefined;

  const updateField = useCallback((id: number, patch: Partial<Omit<DraftField, "id">>) => {
    setFields((prev) => prev.map((field) => (field.id === id ? { ...field, ...patch } : field)));
  }, []);

  const addField = useCallback(() => {
    setFields((prev) => [...prev, { id: nextFieldId, name: "", value: "", plain: false }]);
    setNextFieldId((id) => id + 1);
  }, [nextFieldId]);

  const removeField = useCallback((id: number) => {
    setFields((prev) => prev.filter((field) => field.id !== id));
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      clearCreateError();
      clearUpdateError();
      try {
        if (credential) {
          const saved = await update({
            credential,
            name: trimmedName,
            description: description.trim(),
            serves,
          });
          onSaved?.(saved);
          return;
        }
        const values: Record<string, CredentialFieldInput> = {};
        for (const field of filledFields) {
          values[field.name.trim()] = { value: field.value, ...(field.plain ? { plain: true } : {}) };
        }
        const saved = await create({
          org,
          name: trimmedName,
          description: description.trim() || undefined,
          owner: effectiveOwner,
          fields: values,
          serves,
        });
        onSaved?.(saved);
      } catch {
        // The hooks hold the error; it renders below.
      }
    },
    [canSubmit, clearCreateError, clearUpdateError, credential, update, trimmedName, description, serves, onSaved, filledFields, create, org, effectiveOwner],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("stg:space-y-4", className)} aria-label={editing ? "Edit credential" : "New credential"}>
      <div className="stg:grid stg:gap-3 stg:sm:grid-cols-2">
        <div className="stg:space-y-1">
          <label htmlFor={`${baseId}-name`} className="stg:text-xs stg:font-medium stg:text-foreground">
            Name
          </label>
          <input
            id={`${baseId}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. OpenAI, Linear, Deploy bot"
            disabled={isSaving}
            autoFocus={!editing}
            required
            className={INPUT_CLASSES}
          />
        </div>
        <div className="stg:space-y-1">
          <label htmlFor={`${baseId}-desc`} className="stg:text-xs stg:font-medium stg:text-muted-foreground">
            Description <span className="stg:text-muted-foreground-subtle">(optional)</span>
          </label>
          <input
            id={`${baseId}-desc`}
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is it for?"
            disabled={isSaving}
            className={INPUT_CLASSES}
          />
        </div>
      </div>

      {editing ? (
        <p className="stg:text-xs stg:text-muted-foreground">
          {owner === "org" ? "Belongs to the organization." : "Belongs to you."}
        </p>
      ) : (
        canManageOrg && (
          <fieldset className={cn(UNSTYLED_FIELDSET, "stg:space-y-1.5 stg:border-0")}>
            <legend className="stg:text-xs stg:font-medium stg:text-foreground">Whose is it?</legend>
            <OwnerOption
              name={`${baseId}-owner`}
              checked={effectiveOwner === "person"}
              onSelect={() => setOwner("person")}
              disabled={isSaving}
              title="Yours"
              detail="Only your runs use it. You can reveal its values later."
            />
            <OwnerOption
              name={`${baseId}-owner`}
              checked={effectiveOwner === "org"}
              onSelect={() => setOwner("org")}
              disabled={isSaving}
              title="The organization's"
              detail="You choose who may use it. Its values can be replaced, never read back."
            />
          </fieldset>
        )
      )}

      <div className="stg:space-y-1.5">
        <p className="stg:text-xs stg:font-medium stg:text-foreground">Use for…</p>
        <CredentialServesEditor org={org} value={serves} onChange={setServes} disabled={isSaving} />
      </div>

      {!editing && (
        <div className="stg:space-y-1.5">
          <p className="stg:text-xs stg:font-medium stg:text-foreground">Values</p>
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            Name each value after the key it fills, for example LINEAR_API_KEY.
            Values are secret unless marked plain.
          </p>
          <ul className={cn(UNSTYLED_LIST, "stg:space-y-1.5")} aria-label="Values">
            {fields.map((field, index) => (
              <li key={field.id} className="stg:flex stg:items-center stg:gap-2">
                <input
                  type="text"
                  value={field.name}
                  onChange={(e) => updateField(field.id, { name: e.target.value })}
                  placeholder="FIELD_NAME"
                  aria-label={`Value ${index + 1} name`}
                  disabled={isSaving}
                  className={cn(INPUT_CLASSES, "stg:w-44 stg:shrink-0 stg:font-mono")}
                />
                <input
                  type={field.plain ? "text" : "password"}
                  value={field.value}
                  onChange={(e) => updateField(field.id, { value: e.target.value })}
                  placeholder="Value"
                  aria-label={`Value ${index + 1}`}
                  autoComplete="off"
                  disabled={isSaving}
                  className={cn(INPUT_CLASSES, "stg:min-w-0 stg:flex-1 stg:font-mono")}
                />
                <label className="stg:flex stg:shrink-0 stg:items-center stg:gap-1 stg:text-[0.65rem] stg:text-muted-foreground stg:select-none">
                  <input
                    type="checkbox"
                    checked={field.plain}
                    onChange={(e) => updateField(field.id, { plain: e.target.checked })}
                    disabled={isSaving}
                    className="stg:size-3"
                  />
                  Plain
                </label>
                <button
                  type="button"
                  onClick={() => removeField(field.id)}
                  disabled={isSaving}
                  aria-label={`Remove value ${index + 1}`}
                  className="stg:rounded stg:px-1 stg:text-xs stg:text-muted-foreground stg:hover:text-destructive"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={addField}
            disabled={isSaving}
            className="stg:text-xs stg:text-muted-foreground stg:hover:text-foreground"
          >
            + Add value
          </button>
          {invalidField && (
            <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
              &quot;{invalidField.name.trim() || "(empty)"}&quot; is not a valid name: use letters, digits
              and underscores, not starting with a digit.
            </p>
          )}
          {duplicateField && (
            <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
              {duplicateField} is named twice.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="stg:text-destructive stg:text-xs" role="alert">
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
          {isSaving && <SpinnerIcon size={12} />}
          {editing ? "Save changes" : "Save credential"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function OwnerOption({
  name,
  checked,
  onSelect,
  disabled,
  title,
  detail,
}: {
  readonly name: string;
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly disabled: boolean;
  readonly title: string;
  readonly detail: string;
}) {
  return (
    <label className="stg:flex stg:cursor-pointer stg:items-start stg:gap-2 stg:text-xs">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="stg:mt-0.5 stg:size-3"
      />
      <span>
        <span className="stg:font-medium stg:text-foreground">{title}</span>
        <span className="stg:block stg:text-muted-foreground">{detail}</span>
      </span>
    </label>
  );
}
