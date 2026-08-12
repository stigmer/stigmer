"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useIdentityProviderList } from "./useIdentityProviderList.js";
import { useDeleteIdentityProvider } from "./useDeleteIdentityProvider.js";

/** Props for {@link IdentityProviderListPanel}. */
export interface IdentityProviderListPanelProps {
  /** Organization slug whose identity providers should be listed. */
  readonly org: string;
  /** Fired when the user wants to edit an identity provider. */
  readonly onEdit?: (idp: IdentityProvider) => void;
  /** Expose the refetch function so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Displays a list of {@link IdentityProvider} resources for an
 * organization with inline delete confirmation.
 *
 * Each provider is rendered as a row showing name, slug, SSO badge
 * (when `is_sso_provider` is true), and creation date. A delete
 * button triggers an inline confirmation flow.
 *
 * Identity providers are admin-level resources with small cardinality
 * (typically 1–3 per org), so the list is rendered without pagination.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <IdentityProviderListPanel org="acme" />
 * ```
 *
 * @example
 * ```tsx
 * <IdentityProviderListPanel
 *   org="acme"
 *   onEdit={(idp) => navigate(`/settings/idp/${idp.metadata?.id}`)}
 *   onRefetchRef={(refetch) => { listRefetchRef.current = refetch; }}
 * />
 * ```
 */
export function IdentityProviderListPanel({
  org,
  onEdit,
  onRefetchRef,
  className,
}: IdentityProviderListPanelProps) {
  const { identityProviders, isLoading, error, refetch } =
    useIdentityProviderList(org);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  if (isLoading) {
    return (
      <div
        className={cn("stg:space-y-2", className)}
        aria-busy="true"
        aria-label="Loading identity providers"
      >
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="stg:bg-muted-subtle stg:h-14 stg:animate-pulse stg:rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (identityProviders.length === 0) {
    return (
      <p
        className={cn(
          "stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs",
          className,
        )}
      >
        No identity providers configured.
      </p>
    );
  }

  return (
    <div
      className={cn("stg:space-y-2", className)}
      role="list"
      aria-label="Identity providers"
    >
      {identityProviders.map((idp) => {
        const id = idp.metadata?.id ?? "";
        return (
          <IdpRow
            key={id}
            identityProvider={idp}
            isConfirming={confirmingId === id}
            onEdit={onEdit ? () => onEdit(idp) : undefined}
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
// IdpRow (internal)
// ---------------------------------------------------------------------------

function IdpRow({
  identityProvider,
  isConfirming,
  onEdit,
  onConfirmDelete,
  onCancelDelete,
  onDeleted,
}: {
  identityProvider: IdentityProvider;
  isConfirming: boolean;
  onEdit?: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDeleted: () => void;
}) {
  const { deleteProvider, isDeleting, error } = useDeleteIdentityProvider();

  const id = identityProvider.metadata?.id ?? "";
  const spec = identityProvider.spec;
  const name =
    spec?.displayName ||
    identityProvider.metadata?.name ||
    "Unnamed provider";
  const slug = identityProvider.metadata?.slug;
  const isSso = spec?.isSsoProvider;
  const isJit = !isSso && spec?.autoProvisionAccounts;
  const createdAt =
    identityProvider.status?.audit?.specAudit?.createdAt;

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
            {isDeleting && <SpinnerIcon />}
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
        {isSso && (
          <span className="stg:inline-flex stg:items-center stg:rounded-full stg:border stg:border-primary/30 stg:bg-primary-subtle stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-primary">
            SSO
          </span>
        )}
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
        )}
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

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="stg:animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
