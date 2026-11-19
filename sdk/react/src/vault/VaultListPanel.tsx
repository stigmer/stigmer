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
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { useUpdateVault } from "./useUpdateVault.js";
import { useVaultEntries } from "./useVaultEntries.js";
import { isMyVault, useVaultList } from "./useVaultList.js";
import { VaultEntriesEditor } from "./VaultEntriesEditor.js";
import { ResourceSlugField } from "../resource-detail/RenameSlugField.js";
import { Button } from "../button/Button.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { List, ListRow } from "../internal/surface/List.js";
import { Field, FieldError, TextInput } from "../internal/form/index.js";
import { Section } from "../resource-detail/Section.js";
import { Box, ChevronRight } from "lucide-react";

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
  /** The empty list's line, for a caller who may not create a shared vault. */
  readonly emptyDescription?: string;
  /**
   * Open a vault in place instead of expanding its row: rows become links
   * to the vault, and the panel draws the open one (`openId`) as its own
   * sections. Called with the vault on a row's press, and again with the
   * fresh copy whenever the list re-reads it, so a host can name its page.
   */
  readonly onOpen?: (vault: Vault) => void;
  /** The id of the vault open in place, with `onOpen`. */
  readonly openId?: string | null;
  /** Called when the open vault is gone (deleted here or elsewhere). */
  readonly onClose?: () => void;
  /**
   * Told how many shared vaults the list holds once it reads them, and
   * `null` while it reads or after a read failed, so a host heading can
   * carry the count ("Shared vaults 4").
   */
  readonly onSharedCountChange?: (count: number | null) => void;
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
  emptyDescription,
  onOpen,
  openId,
  onClose,
  onSharedCountChange,
  className,
}: VaultListPanelProps) {
  const { vaults, isLoading, error, refetch } = useVaultList(org);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (onRefetchRef) onRefetchRef(refetch);

  const shared = useMemo(() => vaults.filter((v) => !isMyVault(v)), [vaults]);
  const open = openId ? (shared.find((v) => v.metadata?.id === openId) ?? null) : null;
  // The host names its page from the open vault, kept fresh as the list re-reads.
  useEffect(() => {
    if (open) onOpen?.(open);
  }, [open, onOpen]);
  // The host's heading counts what the list holds, and nothing while it reads.
  const sharedCount = isLoading || error ? null : shared.length;
  useEffect(() => {
    onSharedCountChange?.(sharedCount);
  }, [sharedCount, onSharedCountChange]);
  // An open vault the list no longer holds is gone: back to the list.
  useEffect(() => {
    if (openId && !isLoading && !error && !open) onClose?.();
  }, [openId, isLoading, error, open, onClose]);

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
        description={emptyDescription ?? "A shared vault holds the organization's own keys; a conversation, a routine or a channel can name one so its runs use it."}
        action={emptyAction}
        className={className}
      />
    );
  }

  if (open) {
    return (
      <VaultDetail
        vault={open}
        org={org}
        readOnly={readOnly}
        onChanged={refetch}
        className={className}
      />
    );
  }

  return (
    <List aria-label="Shared vaults" className={className}>
      {shared.map((vault) => {
        const id = vault.metadata?.id ?? "";
        if (onOpen) {
          return <OpenableVaultRow key={id} vault={vault} onOpen={() => onOpen(vault)} />;
        }
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
            <PermissionGate fail="closed" resource={{ kind: "vault", id }} relation="can_edit">
              <VaultDetailsForm vault={vault} onChanged={onChanged} />
            </PermissionGate>
          )}
        </div>
      }
    />
  );
}

/** A shared vault's row that opens it in place: its name, what it's for, who may use it. */
function OpenableVaultRow({ vault, onOpen }: { readonly vault: Vault; readonly onOpen: () => void }) {
  const name = vault.metadata?.name || vault.metadata?.slug || "Unnamed";
  const description = vault.spec?.description ?? "";
  const entryCount =
    Object.keys(vault.spec?.secrets ?? {}).length + Object.keys(vault.spec?.connections ?? {}).length;
  const visibility = vault.metadata?.visibility ?? ApiResourceVisibility.visibility_private;
  return (
    <ListRow
      leading={<Box className="stg:size-4 stg:text-muted-foreground" aria-hidden="true" />}
      name={name}
      description={[description, `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`].filter(Boolean).join(" · ")}
      onClick={onOpen}
      trailing={
        <>
          <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">
            {visibility === ApiResourceVisibility.visibility_org ? "Everyone can use" : "Admins and granted"}
          </span>
          <ChevronRight className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" aria-hidden="true" />
        </>
      }
    />
  );
}

/**
 * A shared vault opened in place: its secrets and its logins as rows in
 * their own sections, its details, and its own Delete.
 */
function VaultDetail({
  vault,
  org,
  readOnly,
  onChanged,
  className,
}: {
  readonly vault: Vault;
  readonly org: string;
  readonly readOnly: boolean;
  readonly onChanged: () => void;
  readonly className?: string;
}) {
  const id = vault.metadata?.id ?? "";
  const secretCount = Object.keys(vault.spec?.secrets ?? {}).length;
  const loginCount = Object.keys(vault.spec?.connections ?? {}).length;
  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-4", className)}>
      <Section title="Secrets" count={secretCount}>
        <div className="stg:p-4">
          <SharedVaultEntries vault={vault} org={org} readOnly={readOnly} onChanged={onChanged} only="secrets" />
        </div>
      </Section>
      <Section title="Logins" count={loginCount}>
        <div className="stg:p-4">
          <SharedVaultEntries vault={vault} org={org} readOnly={readOnly} onChanged={onChanged} only="logins" />
        </div>
      </Section>
      {!readOnly && (
        <PermissionGate fail="closed" resource={{ kind: "vault", id }} relation="can_edit">
          <Section title="Details">
            <div className="stg:p-4">
              <VaultDetailsForm vault={vault} onChanged={onChanged} withDelete={false} />
            </div>
          </Section>
        </PermissionGate>
      )}
      {!readOnly && (
        <PermissionGate fail="closed" resource={{ kind: "vault", id }} relation="can_delete">
          <DeleteVault vault={vault} onDeleted={onChanged} />
        </PermissionGate>
      )}
    </div>
  );
}

/** The open vault's own Delete, asked in the dialog that does it. */
function DeleteVault({ vault, onDeleted }: { readonly vault: Vault; readonly onDeleted: () => void }) {
  const stigmer = useStigmer();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const vaultName = vault.metadata?.name || "this vault";
  const askToDelete = async () => {
    const deleted = await confirm({
      title: `Delete ${vaultName}?`,
      description: "Every value in it is deleted and can't be read back. Surfaces that name it stop at their next run.",
      confirmLabel: "Delete vault",
      variant: "destructive",
      action: async () => {
        await stigmer.vault.delete({ resourceId: vault.metadata?.id ?? "" });
      },
      failureTitle: `Couldn't delete ${vaultName}.`,
    });
    if (deleted) onDeleted();
  };
  return (
    <Section title="Delete this vault">
      <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-3 stg:p-4">
        <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">{`Runs that name ${vaultName} lose its keys at once.`}</p>
        <Button variant="outline" size="sm" onClick={() => void askToDelete()}>
          Delete vault
        </Button>
      </div>
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </Section>
  );
}

function SharedVaultEntries({
  vault,
  org,
  readOnly,
  onChanged,
  only,
}: {
  readonly vault: Vault;
  readonly org: string;
  readonly readOnly: boolean;
  readonly onChanged: () => void;
  readonly only?: "secrets" | "logins";
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
      only={only}
    />
  );
  if (readOnly) return editor;
  return (
    <PermissionGate
      fail="closed"
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
        only={only}
      />
    </PermissionGate>
  );
}

function VaultDetailsForm({
  vault,
  onChanged,
  withDelete = true,
}: {
  readonly vault: Vault;
  readonly onChanged: () => void;
  /** Offer Delete beside Save; a vault open in place has its own Delete card. */
  readonly withDelete?: boolean;
}) {
  const stigmer = useStigmer();
  const { update, isUpdating, error } = useUpdateVault();
  const [name, setName] = useState(vault.metadata?.name ?? "");
  const [description, setDescription] = useState(vault.spec?.description ?? "");
  const [externalId, setExternalId] = useState(vault.spec?.externalId ?? "");
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();

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

  const vaultName = vault.metadata?.name || "this vault";
  const askToDelete = async () => {
    const deleted = await confirm({
      title: `Delete ${vaultName}?`,
      description: "Every value in it is deleted and can't be read back. Surfaces that name it stop at their next run.",
      confirmLabel: "Delete vault",
      variant: "destructive",
      action: async () => {
        await stigmer.vault.delete({ resourceId: vault.metadata?.id ?? "" });
      },
      failureTitle: `Couldn't delete ${vaultName}.`,
    });
    if (deleted) onChanged();
  };

  const fields = (
    <>
      <Field label="Name">
        <TextInput value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description" optional>
        <TextInput value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="External id" optional>
        <TextInput placeholder="An id in your own system" value={externalId} onChange={(e) => setExternalId(e.target.value)} />
      </Field>
    </>
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-3" aria-label="Vault details">
      {withDelete && <h3 className="stg:m-0 stg:text-xs stg:font-semibold stg:text-foreground">Details</h3>}
      {withDelete ? <div className="stg:grid stg:grid-cols-1 stg:gap-2 stg:sm:grid-cols-3">{fields}</div> : fields}
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
      {error && (
        <FieldError>
          {getUserMessage(error)}
        </FieldError>
      )}
      <div className="stg:flex stg:items-center stg:gap-2">
        <Button size="sm" disabled={!dirty || isUpdating || name.trim() === ""} onClick={() => void save()}>
          Save details
        </Button>
        {withDelete && (
          <PermissionGate fail="closed" resource={{ kind: "vault", id: vault.metadata?.id ?? "" }} relation="can_delete">
            <Button variant="ghost" size="sm" onClick={() => void askToDelete()} className="stg:hover:bg-destructive-subtle stg:hover:text-destructive">
              Delete vault
            </Button>
          </PermissionGate>
        )}
      </div>
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
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
