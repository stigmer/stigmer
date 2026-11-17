"use client";

import { useCallback } from "react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { PermissionGate } from "../grant/PermissionGate.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useFederationIssuerList } from "./useFederationIssuerList.js";
import { useDeleteFederationIssuer } from "./useDeleteFederationIssuer.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import type { EmptyStateAction } from "../empty-state/types.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { IconButton } from "../button/IconButton.js";
import { List, ListRow } from "../internal/surface/List.js";
import { Tag } from "../internal/surface/Tag.js";

/** Props for {@link FederationIssuerListPanel}. */
export interface FederationIssuerListPanelProps {
  /** Id of the organization whose federation issuers should be listed (a slug is also accepted). */
  readonly org: string;
  /** Fired when the user wants to edit a federation issuer. */
  readonly onEdit?: (issuer: FederationIssuer) => void;
  /** Expose the refetch function so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /**
   * Shown when the list is empty. Defaults to "No federation issuers
   * configured." The list holds only the issuers the caller may view, so
   * a host that knows the caller may not manage issuers should say who
   * does instead.
   */
  readonly emptyState?: string;
  /** What to do about the empty list, under {@link FederationIssuerListPanelProps.emptyState}. */
  readonly emptyDescription?: string;
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
 * Displays a list of {@link FederationIssuer} resources for an
 * organization, each deleted after a confirm dialog that does the delete.
 *
 * Each issuer is rendered as a row showing name, slug, a JIT badge
 * (when a first sign-in creates the person's account), and creation date. The edit and
 * delete buttons appear only on rows the caller may edit or delete
 * (`can_edit`, `can_delete`), each only after the server's yes; delete
 * opens a confirm dialog that runs the delete and says a refusal there.
 *
 * Federation issuers are admin-level resources with small cardinality
 * (typically 1–3 per org), so the list is rendered without pagination.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <FederationIssuerListPanel org="acme" />
 * ```
 *
 * @example
 * ```tsx
 * function Issuers({ onOpen }: { onOpen: (href: string) => void }) {
 *   return <FederationIssuerListPanel org="acme" onEdit={(issuer) => onOpen(`/settings/issuer/${issuer.metadata?.id}`)} />;
 * }
 * ```
 */
export function FederationIssuerListPanel({
  org,
  onEdit,
  onRefetchRef,
  emptyState = "No federation issuers configured.",
  emptyDescription = "Add one, and this organization accepts the tokens that platform issues.",
  emptyAction,
  className,
}: FederationIssuerListPanelProps) {
  const { federationIssuers, isLoading, error, refetch } =
    useFederationIssuerList(org);
  const { deleteProvider } = useDeleteFederationIssuer();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const askToDelete = useCallback(
    async (id: string, name: string) => {
      const deleted = await confirm({
        title: `Delete ${name}?`,
        description: `Tokens from ${name} stop working at once. People who joined through it keep their accounts and roles.`,
        confirmLabel: "Delete issuer",
        variant: "destructive",
        action: async () => {
          await deleteProvider({ resourceId: id });
        },
        failureTitle: `Couldn't delete ${name}.`,
      });
      if (deleted) refetch();
    },
    [confirm, deleteProvider, refetch],
  );

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  if (isLoading) {
    return <SettingsSkeleton label="Loading federation issuers" rows={3} className={className} />;
  }

  if (error) {
    return <ErrorMessage error={error} title="Couldn't load the federation issuers." retry={refetch} className={className} />;
  }

  if (federationIssuers.length === 0) {
    return (
      <EmptyState
        variant="first-use"
        title={emptyState}
        description={emptyDescription}
        action={emptyAction}
        className={className}
      />
    );
  }

  return (
    <div className={className}>
      <List aria-label="Federation issuers">
        {federationIssuers.map((issuer) => {
          const id = issuer.metadata?.id ?? "";
          return (
            <IssuerRow
              key={id}
              federationIssuer={issuer}
              onEdit={onEdit ? () => onEdit(issuer) : undefined}
              onDelete={askToDelete}
            />
          );
        })}
      </List>
      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// IssuerRow (internal)
// ---------------------------------------------------------------------------

function IssuerRow({
  federationIssuer,
  onEdit,
  onDelete,
}: {
  federationIssuer: FederationIssuer;
  onEdit?: () => void;
  onDelete: (id: string, name: string) => void;
}) {
  const id = federationIssuer.metadata?.id ?? "";
  const spec = federationIssuer.spec;
  const name =
    spec?.displayName ||
    federationIssuer.metadata?.name ||
    "Unnamed issuer";
  const slug = federationIssuer.metadata?.slug;
  const isJit = spec?.createAccountsOnSignIn;
  const createdAt =
    federationIssuer.status?.audit?.specAudit?.createdAt;

  return (
    <ListRow
      leading={<ShieldIcon />}
      name={name}
      description={slug ? <span className="stg:font-mono">{slug}</span> : undefined}
      trailing={
        <>
          <div className="stg:hidden stg:sm:flex stg:shrink-0 stg:items-center stg:gap-3 stg:text-xs stg:text-muted-foreground">
            {isJit && (
              <Tag>JIT</Tag>
            )}
            {createdAt && (
              <Tooltip>
                <TooltipTrigger
                  render={<time dateTime={timestampDate(createdAt).toISOString()} />}
                >
                  {formatShortDate(timestampDate(createdAt))}
                </TooltipTrigger>
                <TooltipContent side="top">
                  {`Created ${timestampDate(createdAt).toISOString()}`}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1">
            {onEdit && (
              <PermissionGate
                fail="closed"
                resource={{ kind: "federation_issuer", id }}
                relation="can_edit"
              >
                <IconButton label={`Edit ${name}`} size="xs" onClick={onEdit} icon={<PencilIcon />} />
              </PermissionGate>
            )}
            <PermissionGate
              fail="closed"
              resource={{ kind: "federation_issuer", id }}
              relation="can_delete"
            >
              <IconButton
                label={`Delete ${name}`}
                size="xs"
                onClick={() => onDelete(id, name)}
                icon={<TrashIcon />}
                className="stg:hover:bg-destructive-subtle stg:hover:text-destructive"
              />
            </PermissionGate>
          </div>
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatShortDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ShieldIcon() {
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
      className="stg:shrink-0 stg:text-muted-foreground"
    >
      <path d="M8 1.5L2 4v4c0 3.5 2.5 5.5 6 7 3.5-1.5 6-3.5 6-7V4L8 1.5z" />
    </svg>
  );
}

function PencilIcon() {
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
    >
      <path d="M11 2.5l2.5 2.5L5 13.5H2.5V11L11 2.5z" />
    </svg>
  );
}

function TrashIcon() {
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
    >
      <path d="M2.5 4h11M5.5 4V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4" />
      <path d="M12.5 4v9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V4" />
      <line x1="6.5" y1="7" x2="6.5" y2="11" />
      <line x1="9.5" y1="7" x2="9.5" y2="11" />
    </svg>
  );
}

