"use client";

import { useCallback, useState } from "react";
import { getUserMessage } from "@stigmer/client";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { PermissionGate } from "../grant/PermissionGate.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useFederationIssuerList } from "./useFederationIssuerList.js";
import { useDeleteFederationIssuer } from "./useDeleteFederationIssuer.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import type { EmptyStateAction } from "../empty-state/types.js";
import { Button } from "../button/Button.js";
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
 * organization with inline delete confirmation.
 *
 * Each issuer is rendered as a row showing name, slug, a JIT badge
 * (when a first sign-in creates the person's account), and creation date. The edit and
 * delete buttons appear only on rows the caller may edit or delete
 * (`can_edit`, `can_delete`); delete opens an inline confirmation.
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
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
    <List aria-label="Federation issuers" className={className}>
      {federationIssuers.map((issuer) => {
        const id = issuer.metadata?.id ?? "";
        return (
          <IssuerRow
            key={id}
            federationIssuer={issuer}
            isConfirming={confirmingId === id}
            onEdit={onEdit ? () => onEdit(issuer) : undefined}
            onConfirmDelete={() => setConfirmingId(id)}
            onCancelDelete={() => setConfirmingId(null)}
            onDeleted={() => {
              setConfirmingId(null);
              refetch();
            }}
          />
        );
      })}
    </List>
  );
}

// ---------------------------------------------------------------------------
// IssuerRow (internal)
// ---------------------------------------------------------------------------

function IssuerRow({
  federationIssuer,
  isConfirming,
  onEdit,
  onConfirmDelete,
  onCancelDelete,
  onDeleted,
}: {
  federationIssuer: FederationIssuer;
  isConfirming: boolean;
  onEdit?: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDeleted: () => void;
}) {
  const { deleteProvider, isDeleting, error } = useDeleteFederationIssuer();

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

  const handleDelete = useCallback(async () => {
    try {
      await deleteProvider({ resourceId: id });
      onDeleted();
    } catch {
      // error state is surfaced via the hook
    }
  }, [id, deleteProvider, onDeleted]);

  if (isConfirming) {
    return (
      // The confirmation's sentence wraps, so it keeps its own markup on the
      // list's row padding rather than a ListRow's one truncated line.
      <li className="stg:flex stg:min-h-10 stg:items-center stg:justify-between stg:gap-3 stg:bg-destructive-subtle stg:px-3.5 stg:py-2.5">
        <div className="stg:min-w-0 stg:flex-1">
          <p className="stg:text-xs stg:text-foreground">
            Delete <span className="stg:font-medium">{name}</span>?
          </p>
          {error && (
            <p className="stg:mt-0.5 stg:text-2xs stg:text-destructive">
              {getUserMessage(error)}
            </p>
          )}
        </div>

        <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
          <Button
            variant="destructive"
            size="xs"
            onClick={handleDelete}
            disabled={isDeleting}
            icon={isDeleting ? <SpinnerIcon size={12} /> : undefined}
          >
            Delete
          </Button>
          <Button variant="ghost" size="xs" onClick={onCancelDelete} disabled={isDeleting}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

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
                resource={{ kind: "federation_issuer", id }}
                relation="can_edit"
              >
                <IconButton label={`Edit ${name}`} size="xs" onClick={onEdit} icon={<PencilIcon />} />
              </PermissionGate>
            )}
            <PermissionGate
              resource={{ kind: "federation_issuer", id }}
              relation="can_delete"
            >
              <IconButton
                label={`Delete ${name}`}
                size="xs"
                onClick={onConfirmDelete}
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

