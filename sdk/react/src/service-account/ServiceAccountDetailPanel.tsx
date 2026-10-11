"use client";

/**
 * One service account, as its organization's admins manage it: rename it,
 * change its role, list, create and revoke its API keys, and delete it.
 *
 * Every act is an ordinary RPC: the rename is the identity account's update,
 * the role change is the organization's grant path (the new role granted
 * before the old one is revoked, so a refused step leaves the account with
 * the role it had, as the Members page does it), a key's revoke is the key's
 * delete, and the delete is the account's delete, which ends every key at
 * once. Owner is never offered: the server refuses it for a service account.
 */
import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import { create } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import {
  getUserMessage,
  iamRoleDisplayName,
  iamRoleToString,
  toIdentityAccountUpdateInput,
} from "@stigmer/sdk";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  ApiResourceRefSchema,
  IamPolicySpecSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ApiKeyCreatedAlert } from "../api-key/ApiKeyCreatedAlert.js";
import { useUpdateIdentityAccount } from "../identity-account/useUpdateIdentityAccount.js";
import { RoleSelector } from "../iam-policy/RoleSelector.js";
import { useCreateIamPolicy } from "../iam-policy/useCreateIamPolicy.js";
import { useDeleteIamPolicy } from "../iam-policy/useDeleteIamPolicy.js";
import { useResourceAccess } from "../iam-policy/useResourceAccess.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { SERVICE_ACCOUNT_OMITTED_ROLES } from "./copy.js";
import { CreateServiceAccountKeyForm } from "./CreateServiceAccountKeyForm.js";
import { orgRoleOf } from "./org-role.js";
import { ServiceAccountKeyListPanel } from "./ServiceAccountKeyListPanel.js";
import { useDeleteServiceAccount } from "./useDeleteServiceAccount.js";

/** Props for {@link ServiceAccountDetailPanel}. */
export interface ServiceAccountDetailPanelProps {
  /** The service account to manage. */
  readonly serviceAccount: IdentityAccount;
  /** Its organization, by id. */
  readonly org: string;
  /** Fired with the renamed account, or after a role change. */
  readonly onUpdated?: (serviceAccount: IdentityAccount) => void;
  /** Fired after the account is deleted. */
  readonly onDeleted?: () => void;
  /** Fired when the user goes back to the list. */
  readonly onBack?: () => void;
  readonly className?: string;
  /**
   * Reference instant for the keys' "last used" stamps. Deterministic hosts
   * (documentation embeds) pass a frozen instant.
   */
  readonly now?: Date;
}

/**
 * Manage one service account.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <ServiceAccountDetailPanel
 *   serviceAccount={account}
 *   org={orgId}
 *   onUpdated={() => refetch()}
 *   onDeleted={() => setOpen(null)}
 *   onBack={() => setOpen(null)}
 * />
 * ```
 */
export function ServiceAccountDetailPanel({
  serviceAccount,
  org,
  onUpdated,
  onDeleted,
  onBack,
  className,
  now,
}: ServiceAccountDetailPanelProps) {
  const id = serviceAccount.metadata?.id ?? "";
  const name = serviceAccount.metadata?.name || id;

  return (
    <div className={cn("stg:space-y-5", className)}>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="stg:text-xs stg:text-muted-foreground stg:hover:text-foreground stg:transition-colors"
        >
          ← Service accounts
        </button>
      )}

      <NameSection serviceAccount={serviceAccount} onRenamed={onUpdated} />
      <RoleSection
        accountId={id}
        name={name}
        org={org}
        onChanged={() => onUpdated?.(serviceAccount)}
      />
      <KeysSection accountId={id} name={name} now={now} />
      <DeleteSection accountId={id} name={name} onDeleted={onDeleted} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections (internal)
// ---------------------------------------------------------------------------

const SECTION_HEADING = "stg:text-xs stg:font-semibold stg:text-foreground";

const PRIMARY_BUTTON = cn(
  "stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
  "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
  "stg:disabled:pointer-events-none stg:disabled:opacity-40",
);

const QUIET_BUTTON = cn(
  "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs",
  "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
);

function NameSection({
  serviceAccount,
  onRenamed,
}: {
  readonly serviceAccount: IdentityAccount;
  readonly onRenamed?: (serviceAccount: IdentityAccount) => void;
}) {
  const baseId = useId();
  const current = serviceAccount.metadata?.name ?? "";
  const { update, isUpdating, error, clearError } = useUpdateIdentityAccount();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);

  const trimmed = draft.trim();
  const canSave = trimmed !== "" && trimmed !== current && !isUpdating;

  const handleSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!canSave) return;
      clearError();
      try {
        const renamed = await update({
          ...toIdentityAccountUpdateInput(serviceAccount),
          name: trimmed,
        });
        setEditing(false);
        onRenamed?.(renamed);
      } catch {
        // error state is managed by useUpdateIdentityAccount
      }
    },
    [canSave, clearError, update, serviceAccount, trimmed, onRenamed],
  );

  if (!editing) {
    return (
      <div className="stg:flex stg:items-center stg:justify-between stg:gap-3">
        <div className="stg:min-w-0">
          <h3 className="stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">
            {current}
          </h3>
          <p className="stg:text-xs stg:text-muted-foreground">
            What its keys create says it was created by {current}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setDraft(current);
            setEditing(true);
          }}
          className={QUIET_BUTTON}
        >
          Rename
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="stg:space-y-2">
      <label htmlFor={`${baseId}-name`} className={SECTION_HEADING}>
        Name
      </label>
      <input
        id={`${baseId}-name`}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={isUpdating}
        autoFocus
        required
        className={cn(
          "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
          "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
        )}
      />
      {error && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}
      <div className="stg:flex stg:items-center stg:gap-2">
        <button type="submit" disabled={!canSave} className={PRIMARY_BUTTON}>
          {isUpdating && <SpinnerIcon size={12} />}
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            clearError();
            setEditing(false);
          }}
          disabled={isUpdating}
          className={QUIET_BUTTON}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function RoleSection({
  accountId,
  name,
  org,
  onChanged,
}: {
  readonly accountId: string;
  readonly name: string;
  readonly org: string;
  readonly onChanged: () => void;
}) {
  const access = useResourceAccess(org ? { kind: "organization", id: org } : null);
  const current = orgRoleOf(access.members, accountId);
  const { create: grant, isCreating } = useCreateIamPolicy();
  const { remove: revoke, isDeleting } = useDeleteIamPolicy();
  const [selected, setSelected] = useState<IamRole | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const isWorking = isCreating || isDeleting;
  const chosen = selected ?? current?.role ?? null;
  const refetchAccess = access.refetch;

  const handleSave = useCallback(async (role: IamRole) => {
    setError(null);
    const specFor = (relation: string) =>
      create(IamPolicySpecSchema, {
        principal: create(ApiResourceRefSchema, { kind: "identity_account", id: accountId }),
        resource: create(ApiResourceRefSchema, { kind: "organization", id: org }),
        relation,
      });
    try {
      // Grant first, then revoke: a refusal of either step leaves the
      // account holding a role, never none, and the revoke is the one that
      // can be retried.
      await grant(specFor(iamRoleToString(role)));
      if (current) await revoke(specFor(current.code));
      setSelected(null);
      refetchAccess();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to change the role"));
    }
  }, [accountId, org, grant, current, revoke, refetchAccess, onChanged]);

  return (
    <div className="stg:space-y-2">
      <h4 className={SECTION_HEADING}>Organization role</h4>
      <p className="stg:text-xs stg:text-muted-foreground">
        {access.isLoading
          ? "Reading its role…"
          : current
            ? `${name} acts with the ${iamRoleDisplayName(current.role)} role in this organization.`
            : `${name} holds no role in this organization. Give it one so its keys can act.`}
      </p>
      <RoleSelector
        kind={ApiResourceKind.organization}
        selected={chosen}
        onSelect={setSelected}
        omitRoles={SERVICE_ACCOUNT_OMITTED_ROLES}
        disabled={isWorking || access.isLoading}
      />
      {error && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {getUserMessage(error)}
        </p>
      )}
      {selected !== null && selected !== current?.role && (
        <div className="stg:flex stg:items-center stg:gap-2">
          <button
            type="button"
            onClick={() => void handleSave(selected)}
            disabled={isWorking}
            className={PRIMARY_BUTTON}
          >
            {isWorking && <SpinnerIcon size={12} />}
            {isWorking ? "Changing role…" : "Save role"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(null)}
            disabled={isWorking}
            className={QUIET_BUTTON}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

type KeysFlow =
  | { readonly phase: "idle" }
  | { readonly phase: "creating" }
  | { readonly phase: "revealed"; readonly rawKey: string; readonly keyName: string };

function KeysSection({
  accountId,
  name,
  now,
}: {
  readonly accountId: string;
  readonly name: string;
  readonly now?: Date;
}) {
  const [flow, setFlow] = useState<KeysFlow>({ phase: "idle" });
  const refetchRef = useRef<(() => void) | null>(null);
  const handleRefetchRef = useCallback((refetch: () => void) => {
    refetchRef.current = refetch;
  }, []);

  return (
    <div className="stg:space-y-2">
      <div className="stg:flex stg:items-center stg:justify-between">
        <h4 className={SECTION_HEADING}>API keys</h4>
        {flow.phase === "idle" && (
          <button
            type="button"
            onClick={() => setFlow({ phase: "creating" })}
            className="stg:text-primary stg:hover:text-foreground stg:text-xs stg:font-medium stg:transition-colors"
          >
            + New key
          </button>
        )}
      </div>

      {flow.phase === "creating" && (
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <CreateServiceAccountKeyForm
            serviceAccountId={accountId}
            serviceAccountName={name}
            onCreated={(apiKey) => {
              refetchRef.current?.();
              setFlow({
                phase: "revealed",
                rawKey: apiKey.spec?.keyHash ?? "",
                keyName: apiKey.metadata?.name ?? "API key",
              });
            }}
            onCancel={() => setFlow({ phase: "idle" })}
          />
        </div>
      )}

      {flow.phase === "revealed" && (
        <ApiKeyCreatedAlert
          rawKey={flow.rawKey}
          keyName={flow.keyName}
          onDismiss={() => setFlow({ phase: "idle" })}
        />
      )}

      <ServiceAccountKeyListPanel
        serviceAccountId={accountId}
        onRefetchRef={handleRefetchRef}
        now={now}
      />
    </div>
  );
}

function DeleteSection({
  accountId,
  name,
  onDeleted,
}: {
  readonly accountId: string;
  readonly name: string;
  readonly onDeleted?: () => void;
}) {
  const { deleteServiceAccount, isDeleting, error, clearError } = useDeleteServiceAccount();
  const [confirming, setConfirming] = useState(false);

  const handleDelete = useCallback(async () => {
    try {
      await deleteServiceAccount(accountId);
      onDeleted?.();
    } catch {
      // error state is surfaced via the hook
    }
  }, [deleteServiceAccount, accountId, onDeleted]);

  if (!confirming) {
    return (
      <div className="stg:border-t stg:border-border stg:pt-4">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="stg:text-xs stg:font-medium stg:text-destructive stg:hover:underline"
        >
          Delete service account
        </button>
      </div>
    );
  }

  return (
    <div
      role="alertdialog"
      aria-label={`Delete ${name}`}
      className="stg:space-y-2 stg:rounded-lg stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-3 stg:py-2.5"
    >
      <p className="stg:text-xs stg:text-foreground">
        Delete <span className="stg:font-medium">{name}</span>? Its API keys
        stop working at once, and anything still using them is refused. What it
        created stays with the organization.
      </p>
      {error && (
        <p className="stg:text-[0.65rem] stg:text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}
      <div className="stg:flex stg:items-center stg:gap-1.5">
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className={cn(
            "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
            "stg:bg-destructive stg:text-destructive-foreground stg:hover:bg-destructive-hover",
            "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          )}
        >
          {isDeleting && <SpinnerIcon size={12} />}
          Delete
        </button>
        <button
          type="button"
          onClick={() => {
            // A refused delete's reason belongs to that attempt, not the next.
            clearError();
            setConfirming(false);
          }}
          disabled={isDeleting}
          className={QUIET_BUTTON}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
