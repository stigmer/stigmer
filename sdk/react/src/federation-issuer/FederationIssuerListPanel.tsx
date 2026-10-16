"use client";

import { type ReactNode, useCallback, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { PermissionGate } from "../grant/PermissionGate.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useFederationIssuerList } from "./useFederationIssuerList.js";
import { useDeleteFederationIssuer } from "./useDeleteFederationIssuer.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

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
  readonly emptyState?: ReactNode;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
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
 * <FederationIssuerListPanel
 *   org="acme"
 *   onEdit={(issuer) => navigate(`/settings/issuer/${issuer.metadata?.id}`)}
 *   onRefetchRef={(refetch) => { listRefetchRef.current = refetch; }}
 * />
 * ```
 */
export function FederationIssuerListPanel({
  org,
  onEdit,
  onRefetchRef,
  emptyState = "No federation issuers configured.",
  className,
}: FederationIssuerListPanelProps) {
  const { federationIssuers, isLoading, error, refetch } =
    useFederationIssuerList(org);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  if (isLoading) {
    return (
      <LoadingRegion
        className={cn("stg:space-y-2", className)}
        label="Loading federation issuers"
      >
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="stg:bg-muted-subtle stg:h-14 stg:animate-pulse stg:rounded-lg"
          />
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

  if (federationIssuers.length === 0) {
    return (
      <p
        className={cn(
          "stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs",
          className,
        )}
      >
        {emptyState}
      </p>
    );
  }

  return (
    <div
      className={cn("stg:space-y-2", className)}
      role="list"
      aria-label="Federation issuers"
    >
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
    </div>
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
      <div
        role="listitem"
        className="stg:flex stg:items-center stg:justify-between stg:rounded-lg stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-3 stg:py-2.5"
      >
        <div className="stg:min-w-0 stg:flex-1">
          <p className="stg:text-xs stg:text-foreground">
            Delete <span className="stg:font-medium">{name}</span>?
          </p>
          {error && (
            <p className="stg:mt-0.5 stg:text-[0.65rem] stg:text-destructive">
              {getUserMessage(error)}
            </p>
          )}
        </div>

        <div className="stg:flex stg:shrink-0 stg:items-center stg:gap-1.5">
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
            onClick={onCancelDelete}
            disabled={isDeleting}
            className={cn(
              "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs",
              "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
              "stg:disabled:pointer-events-none stg:disabled:opacity-50",
            )}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="listitem"
      className="stg:flex stg:items-center stg:gap-3 stg:rounded-lg stg:border stg:border-border-muted stg:px-3 stg:py-2.5 stg:hover:border-border stg:transition-colors"
    >
      <ShieldIcon />

      <div className="stg:min-w-0 stg:flex-1">
        <span className="stg:block stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
          {name}
        </span>
        {slug && (
          <span className="stg:block stg:text-xs stg:text-muted-foreground stg:font-mono">
            {slug}
          </span>
        )}
      </div>

      <div className="stg:hidden stg:sm:flex stg:shrink-0 stg:items-center stg:gap-3 stg:text-xs stg:text-muted-foreground">
        {isJit && (
          <span className="stg:inline-flex stg:items-center stg:rounded-full stg:border stg:border-primary/30 stg:bg-primary-subtle stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-primary">
            JIT
          </span>
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
            <button
              type="button"
              onClick={onEdit}
              aria-label={`Edit ${name}`}
              className={cn(
                "stg:shrink-0 stg:rounded stg:p-1",
                "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
                "stg:transition-colors",
              )}
            >
              <PencilIcon />
            </button>
          </PermissionGate>
        )}
        <PermissionGate
          resource={{ kind: "federation_issuer", id }}
          relation="can_delete"
        >
          <button
            type="button"
            onClick={onConfirmDelete}
            aria-label={`Delete ${name}`}
            className={cn(
              "stg:shrink-0 stg:rounded stg:p-1",
              "stg:text-muted-foreground stg:hover:text-destructive stg:hover:bg-destructive-subtle",
              "stg:transition-colors",
            )}
          >
            <TrashIcon />
          </button>
        </PermissionGate>
      </div>
    </div>
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

