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
import { ArrowLeft } from "lucide-react";
import { useCallback, useId, useRef, useState, type FormEvent } from "react";
import { create } from "@bufbuild/protobuf";
import { cn } from "@stigmer/design-tokens";
import {
  getUserMessage,
  iamRoleDisplayName,
  iamRoleToString,
} from "@stigmer/client";
import { saveErrorMessage } from "@stigmer/react-core/internal";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  ApiResourceRefSchema,
  GrantSpecSchema,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { ApiKeyCreatedAlert } from "../api-key/ApiKeyCreatedAlert.js";
import { useUpdateIdentityAccount } from "../identity-account/useUpdateIdentityAccount.js";
import { useRoleSelector } from "../grant/useRoleSelector.js";
import { ChoiceGroup } from "../internal/form/ChoiceGroup.js";
import { useOrgDisplayName } from "../organization/useOrgDisplayName.js";
import { useCreateGrant } from "../grant/useCreateGrant.js";
import { useDeleteGrant } from "../grant/useDeleteGrant.js";
import { useResourceAccess } from "../grant/useResourceAccess.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Card } from "../internal/surface/Card.js";
import { SERVICE_ACCOUNT_OMITTED_ROLES } from "./copy.js";
import { CreateServiceAccountKeyForm } from "./CreateServiceAccountKeyForm.js";
import { orgRoleOf } from "./org-role.js";
import { ServiceAccountKeyListPanel } from "./ServiceAccountKeyListPanel.js";
import { useDeleteServiceAccount } from "./useDeleteServiceAccount.js";
import { Button } from "../button/Button.js";
import { Section } from "../resource-detail/Section.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { FieldError, TextInput } from "../internal/form/index.js";

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
  /**
   * Draw the account's name as the panel's heading. `true` (the default)
   * where the panel stands alone; `false` where the page's own title
   * already names the account (the settings page while one is open).
   */
  readonly showName?: boolean;
}

/**
 * Manage one service account.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
 *
 * type Props = { account: IdentityAccount; onUpdated: () => void; onClose: () => void };
 *
 * function AccountDetail({ account, onUpdated, onClose }: Props) {
 *   return <ServiceAccountDetailPanel serviceAccount={account} org="acme" onUpdated={onUpdated} onDeleted={onClose} onBack={onClose} />;
 * }
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
  showName = true,
}: ServiceAccountDetailPanelProps) {
  const id = serviceAccount.metadata?.id ?? "";
  const name = serviceAccount.metadata?.name || id;

  return (
    <div className={cn("stg:space-y-4", className)}>
      {onBack && (
        <Button variant="ghost" size="xs" icon={<ArrowLeft className="stg:size-3" aria-hidden="true" />} onClick={onBack}>
          Service accounts
        </Button>
      )}

      <NameSection serviceAccount={serviceAccount} onRenamed={onUpdated} showName={showName} />
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

function NameSection({
  serviceAccount,
  onRenamed,
  showName,
}: {
  readonly serviceAccount: IdentityAccount;
  readonly onRenamed?: (serviceAccount: IdentityAccount) => void;
  readonly showName: boolean;
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
        // The update names the display name alone.
        const renamed = await update(
          {
            metadata: {
              id: serviceAccount.metadata?.id ?? "",
              etag: serviceAccount.metadata?.etag ?? "",
              name: trimmed,
            },
          },
          ["metadata.name"],
        );
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
          {showName && (
            <h3 className="stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">
              {current}
            </h3>
          )}
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
            What its keys create says it was created by {current}.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDraft(current);
            setEditing(true);
          }}
        >
          Rename
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="stg:space-y-2">
      <label htmlFor={`${baseId}-name`} className={SECTION_HEADING}>
        Name
      </label>
      <TextInput
        id={`${baseId}-name`}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={isUpdating}
        autoFocus
        required
        className="stg:w-full"
      />
      {error && (
        <FieldError>
          {saveErrorMessage(error, "service account")}
        </FieldError>
      )}
      <div className="stg:flex stg:items-center stg:gap-2">
        <Button type="submit" size="xs" disabled={!canSave} icon={isUpdating ? <SpinnerIcon size={12} /> : undefined}>
          Save
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            clearError();
            setEditing(false);
          }}
          disabled={isUpdating}
        >
          Cancel
        </Button>
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
  const { create: grant, isCreating } = useCreateGrant();
  const { remove: revoke, isDeleting } = useDeleteGrant();
  const [selected, setSelected] = useState<IamRole | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const isWorking = isCreating || isDeleting;
  const chosen = selected ?? current?.role ?? null;
  const refetchAccess = access.refetch;

  const handleSave = useCallback(async (role: IamRole) => {
    setError(null);
    const specFor = (relation: string) =>
      create(GrantSpecSchema, {
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

  const where = useOrgDisplayName();
  const { options } = useRoleSelector(ApiResourceKind.organization, undefined, "identity_account", SERVICE_ACCOUNT_OMITTED_ROLES);

  return (
    <Section title="Organization role">
      <div className="stg:space-y-3 stg:p-4">
        <p className="stg:m-0 stg:text-xs stg:text-muted-foreground">
          {access.isLoading
            ? "Reading its role…"
            : current
              ? `${name} acts with the ${iamRoleDisplayName(current.role)} role in ${where}.`
              : `${name} holds no role in ${where}. Give it one so its keys can act.`}
        </p>
        {/* One role of a few, each with what it allows: a choice list. */}
        <ChoiceGroup
          variant="list"
          aria-label="Organization role"
          value={chosen === null ? "" : String(chosen)}
          onChange={(value) => setSelected(Number(value) as IamRole)}
          options={options.map((opt) => ({ value: String(opt.role), label: opt.label, description: opt.description }))}
          disabled={isWorking || access.isLoading}
        />
        {error && (
          <FieldError>
            {getUserMessage(error)}
          </FieldError>
        )}
        {selected !== null && selected !== current?.role && (
          <div className="stg:flex stg:items-center stg:gap-2">
            <Button
              size="sm"
              onClick={() => void handleSave(selected)}
              disabled={isWorking}
              icon={isWorking ? <SpinnerIcon size={14} /> : undefined}
            >
              {isWorking ? "Changing role…" : "Save role"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)} disabled={isWorking}>
              Cancel
            </Button>
          </div>
        )}
      </div>
    </Section>
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
    <Section
      title="API keys"
      headerActions={
        flow.phase === "idle" && (
          <Button variant="outline" size="xs" onClick={() => setFlow({ phase: "creating" })}>
            + New key
          </Button>
        )
      }
    >
      <div className="stg:space-y-3 stg:p-4">
        {flow.phase === "creating" && (
          <Card>
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
          </Card>
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
    </Section>
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
  const { deleteServiceAccount } = useDeleteServiceAccount();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();

  const askToDelete = useCallback(async () => {
    const deleted = await confirm({
      title: `Delete ${name}?`,
      description: `Its keys stop working at once. What it created stays, still saying ${name} created it.`,
      confirmLabel: "Delete service account",
      variant: "destructive",
      action: async () => {
        await deleteServiceAccount(accountId);
      },
      failureTitle: `Couldn't delete ${name}.`,
    });
    if (deleted) onDeleted?.();
  }, [confirm, deleteServiceAccount, accountId, name, onDeleted]);

  return (
    <Section title="Delete this service account">
      <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-3 stg:p-4">
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
          Its keys stop working at once. What it created stays, still saying {name} created it.
        </p>
        <Button variant="outline" size="sm" onClick={askToDelete}>
          Delete service account
        </Button>
      </div>
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </Section>
  );
}
