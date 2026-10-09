"use client";

/**
 * The organization's shared vaults, each an expandable card: what it is
 * for, its entries (write-only), who may use it, and its own fields.
 *
 * Who may use a shared vault is the Manage access dialog's: organization
 * visibility lets every member use it in every edition, and editions that
 * grant roles on a single resource add per-person and per-Team "Can use"
 * grants there. Admins manage; members see the vaults they may use, with
 * entry names only. A person's own My vault is never listed here: its own
 * card shows it.
 */
import { useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ManageAccessButton } from "../access/ManageAccessButton.js";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
import { useStigmer } from "../hooks.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import {
  DANGER_BUTTON_CLASS,
  INPUT_CLASS,
  PRIMARY_BUTTON_CLASS,
  QUIET_BUTTON_CLASS,
} from "./styles.js";
import { useUpdateVault } from "./useUpdateVault.js";
import { useVaultEntries } from "./useVaultEntries.js";
import { isMyVault, useVaultList } from "./useVaultList.js";
import { VaultEntriesEditor } from "./VaultEntriesEditor.js";

/** Props for {@link VaultListPanel}. */
export interface VaultListPanelProps {
  /** Organization to list shared vaults for (id or slug). */
  readonly org: string;
  /** Show every vault without write controls. */
  readonly readOnly?: boolean;
  /** Re-expose refetch so parents can refresh the list after a create. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Lists the organization's shared vaults with their entries and access.
 *
 * @example
 * ```tsx
 * <VaultListPanel org="acme" />
 * ```
 */
export function VaultListPanel({
  org,
  readOnly = false,
  onRefetchRef,
  className,
}: VaultListPanelProps) {
  const { vaults, isLoading, error, refetch } = useVaultList(org);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (onRefetchRef) onRefetchRef(refetch);

  const shared = useMemo(() => vaults.filter((v) => !isMyVault(v)), [vaults]);

  if (isLoading) {
    return (
      <LoadingRegion className={cn("stg:space-y-2", className)} label="Loading vaults">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="stg:bg-muted-subtle stg:h-14 stg:animate-pulse stg:rounded-lg" />
        ))}
      </LoadingRegion>
    );
  }

  if (error) {
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (shared.length === 0) {
    return (
      <p className={cn("stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs", className)}>
        No shared vaults yet.
      </p>
    );
  }

  return (
    <div className={cn("stg:space-y-2", className)} role="list" aria-label="Shared vaults">
      {shared.map((vault) => {
        const id = vault.metadata?.id ?? "";
        return (
          <SharedVaultCard
            key={id}
            vault={vault}
            org={org}
            isExpanded={expandedId === id}
            onToggle={() => setExpandedId((cur) => (cur === id ? null : id))}
            readOnly={readOnly}
            onChanged={refetch}
          />
        );
      })}
    </div>
  );
}

function SharedVaultCard({
  vault,
  org,
  isExpanded,
  onToggle,
  readOnly,
  onChanged,
}: {
  readonly vault: Vault;
  readonly org: string;
  readonly isExpanded: boolean;
  readonly onToggle: () => void;
  readonly readOnly: boolean;
  readonly onChanged: () => void;
}) {
  const id = vault.metadata?.id ?? "";
  const name = vault.metadata?.name || vault.metadata?.slug || "Unnamed";
  const description = vault.spec?.description ?? "";
  const entryCount =
    Object.keys(vault.spec?.secrets ?? {}).length +
    Object.keys(vault.spec?.connections ?? {}).length;
  const visibility = vault.metadata?.visibility ?? ApiResourceVisibility.visibility_private;

  return (
    <div
      role="listitem"
      className={cn(
        "stg:rounded-lg stg:border stg:transition-colors",
        isExpanded ? "stg:border-border stg:bg-card" : "stg:border-border-muted stg:hover:border-border",
      )}
    >
      <div className="stg:flex stg:w-full stg:items-center stg:gap-3 stg:px-3 stg:py-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="stg:flex stg:min-w-0 stg:flex-1 stg:items-center stg:gap-3 stg:text-left"
        >
          <ChevronIcon expanded={isExpanded} />
          <div className="stg:min-w-0 stg:flex-1">
            <span className="stg:block stg:truncate stg:text-sm stg:font-medium stg:text-foreground">{name}</span>
            {description && (
              <span className="stg:block stg:truncate stg:text-xs stg:text-muted-foreground">{description}</span>
            )}
          </div>
        </button>
        <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">
          {visibility === ApiResourceVisibility.visibility_org ? "Everyone can use" : "Admins and granted"}
        </span>
        {!readOnly && id !== "" && (
          <ManageAccessButton
            resource={{ kind: ApiResourceKind.vault, kindString: "vault", id, org }}
            visibility={{ kind: "vault", current: visibility, onChanged }}
            label="Who can use"
            className="stg:shrink-0"
          />
        )}
        <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">
          {entryCount} {entryCount === 1 ? "entry" : "entries"}
        </span>
      </div>
      {isExpanded && id !== "" && (
        <div className="stg:border-border-muted stg:space-y-4 stg:border-t stg:px-3 stg:pb-3 stg:pt-2">
          <SharedVaultEntries vault={vault} org={org} readOnly={readOnly} onChanged={onChanged} />
          {!readOnly && (
            <PermissionGate resource={{ kind: "vault", id }} relation="can_edit">
              <VaultDetailsForm vault={vault} onChanged={onChanged} />
            </PermissionGate>
          )}
        </div>
      )}
    </div>
  );
}

function SharedVaultEntries({
  vault,
  org,
  readOnly,
  onChanged,
}: {
  readonly vault: Vault;
  readonly org: string;
  readonly readOnly: boolean;
  readonly onChanged: () => void;
}) {
  const entries = useVaultEntries(org, vault.metadata?.id ?? null);
  const after = useCallback(
    <A extends unknown[]>(write: (...args: A) => Promise<Vault>) =>
      async (...args: A) => {
        const updated = await write(...args);
        onChanged();
        return updated;
      },
    [onChanged],
  );

  const editor = (
    <VaultEntriesEditor
      vault={vault}
      onSetSecrets={after(entries.setSecrets)}
      onRemoveSecrets={after(entries.removeSecrets)}
      onSetConnection={after(entries.setConnection)}
      onRemoveConnections={after(entries.removeConnections)}
      isMutating={entries.isMutating}
      readOnly
    />
  );
  if (readOnly) return editor;
  return (
    <PermissionGate
      resource={{ kind: "vault", id: vault.metadata?.id ?? "" }}
      relation="can_edit"
      fallback={editor}
    >
      <VaultEntriesEditor
        vault={vault}
        onSetSecrets={after(entries.setSecrets)}
        onRemoveSecrets={after(entries.removeSecrets)}
        onSetConnection={after(entries.setConnection)}
        onRemoveConnections={after(entries.removeConnections)}
        isMutating={entries.isMutating}
      />
    </PermissionGate>
  );
}

function VaultDetailsForm({
  vault,
  onChanged,
}: {
  readonly vault: Vault;
  readonly onChanged: () => void;
}) {
  const stigmer = useStigmer();
  const { update, isUpdating, error } = useUpdateVault();
  const [name, setName] = useState(vault.metadata?.name ?? "");
  const [description, setDescription] = useState(vault.spec?.description ?? "");
  const [externalId, setExternalId] = useState(vault.spec?.externalId ?? "");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const dirty =
    name.trim() !== (vault.metadata?.name ?? "") ||
    description.trim() !== (vault.spec?.description ?? "") ||
    externalId.trim() !== (vault.spec?.externalId ?? "");

  const save = async () => {
    try {
      await update({
        vault,
        name: name.trim(),
        description: description.trim(),
        externalId: externalId.trim(),
      });
      onChanged();
    } catch {
      // Surfaced through `error`.
    }
  };

  const remove = async () => {
    setDeleteError(null);
    try {
      await stigmer.vault.delete({ resourceId: vault.metadata?.id ?? "" });
      onChanged();
    } catch (err) {
      setDeleteError(getUserMessage(err));
    }
  };

  return (
    <div className="stg:space-y-2" aria-label="Vault details">
      <h3 className="stg:text-xs stg:font-semibold stg:text-foreground">Details</h3>
      <div className="stg:grid stg:grid-cols-1 stg:gap-2 stg:sm:grid-cols-3">
        <input aria-label="Vault name" value={name} onChange={(e) => setName(e.target.value)} className={INPUT_CLASS} />
        <input aria-label="Vault description" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} className={INPUT_CLASS} />
        <input aria-label="External id" placeholder="External id" value={externalId} onChange={(e) => setExternalId(e.target.value)} className={INPUT_CLASS} />
      </div>
      {(error || deleteError) && (
        <p className="stg:text-destructive stg:text-[0.65rem]" role="alert">
          {deleteError ?? (error ? getUserMessage(error) : "")}
        </p>
      )}
      <div className="stg:flex stg:items-center stg:gap-2">
        <button type="button" disabled={!dirty || isUpdating || name.trim() === ""} onClick={() => void save()} className={PRIMARY_BUTTON_CLASS}>
          Save details
        </button>
        <PermissionGate resource={{ kind: "vault", id: vault.metadata?.id ?? "" }} relation="can_delete">
          {confirmingDelete ? (
            <>
              <span className="stg:text-xs stg:text-muted-foreground">
                Delete this vault and every value in it? Surfaces that name it stop at their next run.
              </span>
              <button type="button" onClick={() => void remove()} className={DANGER_BUTTON_CLASS}>
                Delete
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className={QUIET_BUTTON_CLASS}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} className={DANGER_BUTTON_CLASS}>
              Delete vault
            </button>
          )}
        </PermissionGate>
      </div>
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "stg:shrink-0 stg:text-muted-foreground stg:transition-transform stg:duration-150",
        expanded && "stg:rotate-90",
      )}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
