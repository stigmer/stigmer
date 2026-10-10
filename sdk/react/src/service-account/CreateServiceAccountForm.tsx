"use client";

/**
 * Creating a service account, then its first key, in one flow: the name and
 * the role first (Member preselected; Admin, Member and Viewer offered, never
 * Owner), then the offer of a first key, then that key shown once with copy.
 * Most service accounts exist to hold a key, so the key is offered while the
 * admin is still here, and declining it leaves a service account that gets
 * its keys later from its detail panel.
 *
 * The account exists from the first step on: `onCreated` fires as soon as the
 * server answers, so the host's list shows it whether or not a key follows,
 * and `onDone` fires when the flow is over (the key dismissed or declined).
 */
import { useCallback, useId, useState, type FormEvent } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, iamRoleDisplayName } from "@stigmer/sdk";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ApiKeyCreatedAlert } from "../api-key/ApiKeyCreatedAlert.js";
import { RoleSelector } from "../iam-policy/RoleSelector.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import {
  DEFAULT_SERVICE_ACCOUNT_ROLE,
  SERVICE_ACCOUNT_OMITTED_ROLES,
} from "./copy.js";
import { CreateServiceAccountKeyForm } from "./CreateServiceAccountKeyForm.js";
import { useCreateServiceAccount } from "./useCreateServiceAccount.js";

/** Props for {@link CreateServiceAccountForm}. */
export interface CreateServiceAccountFormProps {
  /** The organization the service account belongs to, by id. */
  readonly org: string;
  /** Fired with the created service account, before its first key is offered. */
  readonly onCreated?: (serviceAccount: IdentityAccount) => void;
  /** Fired when the flow is over: the first key dismissed, or declined. */
  readonly onDone?: () => void;
  /** Fired when the user cancels before the account is created. */
  readonly onCancel?: () => void;
  readonly className?: string;
}

type Step =
  | { readonly phase: "account" }
  | { readonly phase: "firstKey"; readonly account: IdentityAccount; readonly role: IamRole }
  | { readonly phase: "revealed"; readonly rawKey: string; readonly keyName: string };

/**
 * The create flow for a service account and its first key.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <CreateServiceAccountForm
 *   org={orgId}
 *   onCreated={() => refetch()}
 *   onDone={() => setCreating(false)}
 *   onCancel={() => setCreating(false)}
 * />
 * ```
 */
export function CreateServiceAccountForm({
  org,
  onCreated,
  onDone,
  onCancel,
  className,
}: CreateServiceAccountFormProps) {
  const [step, setStep] = useState<Step>({ phase: "account" });

  switch (step.phase) {
    case "account":
      return (
        <AccountStep
          org={org}
          className={className}
          onCancel={onCancel}
          onCreated={(account, role) => {
            onCreated?.(account);
            setStep({ phase: "firstKey", account, role });
          }}
        />
      );
    case "firstKey": {
      const name = step.account.metadata?.name ?? "";
      return (
        <div className={cn("stg:space-y-3", className)}>
          <div>
            <p className="stg:text-sm stg:font-medium stg:text-foreground">
              {name} created with the {iamRoleDisplayName(step.role)} role
            </p>
            <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
              Create its first API key now, for the CI job or script that
              will act as {name}.
            </p>
          </div>
          <CreateServiceAccountKeyForm
            serviceAccountId={step.account.metadata?.id ?? ""}
            serviceAccountName={name}
            onCreated={(apiKey) =>
              setStep({
                phase: "revealed",
                rawKey: apiKey.spec?.keyHash ?? "",
                keyName: apiKey.metadata?.name ?? "API key",
              })
            }
            onCancel={onDone}
            cancelLabel="Not now"
          />
        </div>
      );
    }
    case "revealed":
      return (
        <ApiKeyCreatedAlert
          rawKey={step.rawKey}
          keyName={step.keyName}
          onDismiss={() => onDone?.()}
          className={className}
        />
      );
    default: {
      const unreachable: never = step;
      return unreachable;
    }
  }
}

// ---------------------------------------------------------------------------
// AccountStep (internal)
// ---------------------------------------------------------------------------

function AccountStep({
  org,
  onCreated,
  onCancel,
  className,
}: {
  readonly org: string;
  readonly onCreated: (account: IdentityAccount, role: IamRole) => void;
  readonly onCancel?: () => void;
  readonly className?: string;
}) {
  const { create, isCreating, error, clearError } = useCreateServiceAccount();
  const baseId = useId();
  const [name, setName] = useState("");
  const [role, setRole] = useState<IamRole>(DEFAULT_SERVICE_ACCOUNT_ROLE);

  const trimmedName = name.trim();
  const canSubmit = trimmedName !== "" && org !== "" && !isCreating;

  const handleSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      clearError();
      try {
        const account = await create({ org, name: trimmedName, role });
        onCreated(account, role);
      } catch {
        // error state is managed by useCreateServiceAccount
      }
    },
    [canSubmit, clearError, create, org, trimmedName, role, onCreated],
  );

  return (
    <form onSubmit={handleSubmit} className={cn("stg:space-y-3", className)}>
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
          placeholder="e.g. ci-deploy"
          disabled={isCreating}
          autoFocus
          required
          aria-describedby={`${baseId}-name-hint`}
          className={cn(
            "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
            "stg:placeholder:text-muted-foreground",
            "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        />
        <p
          id={`${baseId}-name-hint`}
          className="stg:text-[0.65rem] stg:text-muted-foreground"
        >
          What it creates says it was created by this name.
        </p>
      </div>

      <RoleSelector
        kind={ApiResourceKind.organization}
        selected={role}
        onSelect={setRole}
        omitRoles={SERVICE_ACCOUNT_OMITTED_ROLES}
        disabled={isCreating}
      />

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
          Create service account
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
