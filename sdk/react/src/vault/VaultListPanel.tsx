"use client";

/**
 * The organization's shared vaults, each an expandable row: what it is
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
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { ManageAccessButton } from "../access/ManageAccessButton.js";
import { PermissionGate } from "../grant/PermissionGate.js";
import { useStigmer } from "@stigmer/react-core";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import type { EmptyStateAction } from "../empty-state/types.js";
import { INPUT_CLASS } from "./styles.js";
import { useUpdateVault } from "./useUpdateVault.js";
import { useVaultEntries } from "./useVaultEntries.js";
import { isMyVault, useVaultList } from "./useVaultList.js";
import { VaultEntriesEditor } from "./VaultEntriesEditor.js";
import { ResourceSlugField } from "../resource-detail/RenameSlugField.js";
import { Button } from "../button/Button.js";
import { List, ListRow } from "../internal/surface/List.js";

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
  /**
   * The page's create act, carried by the empty list (the same label and
   * handler as the page header's button). Absent when the caller may not
   * create one, or a create is already open.
   */
  readonly emptyAction?: EmptyStateAction;
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
  emptyAction,
  className,
}: VaultListPanelProps) {
  const { vaults, isLoading, error, refetch } = useVaultList(org);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (onRefetchRef) onRefetchRef(refetch);

  const shared = useMemo(() => vaults.filter((v) => !isMyVault(v)), [vaults]);

  if (isLoading) {
    return <SettingsSkeleton label="Loading vaults" rows={3} className={className} />;
  }

  if (error) {
    return (
      <ErrorMessage
        error={error}
        title="Couldn't load the shared vaults."
        comfort="Your organization's vaults are safe; only this page's read failed."
        retry={refetch}
        className={className}
      />
    );
  }

  if (shared.length === 0) {
    return (
      <EmptyState
        variant="first-use"
        title="No shared vaults yet"
        description="A shared vault holds the organization's own keys; a conversation, a routine or a channel can name one so its runs use it."
        action={emptyAction}
        className={className}
      />
    );
  }

  return (
    <List aria-label="Shared vaults" className={className}>
      {shared.map((vault) => {
        const id = vault.metadata?.id ?? "";
        return (
          <SharedVaultRow
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
    </List>
  );
}

function SharedVaultRow({
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
    <ListRow
      leading={<ChevronIcon expanded={isExpanded} />}
      name={name}
      description={description || undefined}
      onClick={onToggle}
      aria-expanded={isExpanded}
      trailing={
        <>
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
        </>
      }
      open={isExpanded && id !== ""}
      expanded={
        <div className="stg:space-y-4">
          <SharedVaultEntries vault={vault} org={org} readOnly={readOnly} onChanged={onChanged} />
          {!readOnly && (
            <PermissionGate resource={{ kind: "vault", id }} relation="can_edit">
              <VaultDetailsForm vault={vault} onChanged={onChanged} />
            </PermissionGate>
          )}
        </div>
      }
    />
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
      {/* My vault is named after its person and keeps its name. */}
      {!isMyVault(vault) && (
        <ResourceSlugField
          kind="vault"
          resourceId={vault.metadata?.id || null}
          currentSlug={vault.metadata?.slug ?? ""}
          onRenamed={onChanged}
          className="stg:max-w-md"
        />
      )}
      {(error || deleteError) && (
        <p className="stg:text-destructive stg:text-2xs" role="alert">
          {deleteError ?? (error ? getUserMessage(error) : "")}
        </p>
      )}
      <div className="stg:flex stg:items-center stg:gap-2">
        <Button size="xs" disabled={!dirty || isUpdating || name.trim() === ""} onClick={() => void save()}>
          Save details
        </Button>
        <PermissionGate resource={{ kind: "vault", id: vault.metadata?.id ?? "" }} relation="can_delete">
          {confirmingDelete ? (
            <>
              <span className="stg:text-xs stg:text-muted-foreground">
                Delete this vault and every value in it? Surfaces that name it stop at their next run.
              </span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void remove()}
                className="stg:text-destructive stg:hover:bg-destructive-subtle"
              >
                Delete
              </Button>
              <Button variant="ghost" size="xs" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="xs" onClick={() => setConfirmingDelete(true)} className="stg:hover:bg-destructive-subtle stg:hover:text-destructive">
              Delete vault
            </Button>
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
