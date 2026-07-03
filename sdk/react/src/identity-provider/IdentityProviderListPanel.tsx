"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { IdentityProvider } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
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
        className={cn("space-y-2", className)}
        aria-busy="true"
        aria-label="Loading identity providers"
      >
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="bg-muted-subtle h-14 animate-pulse rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("text-destructive text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (identityProviders.length === 0) {
    return (
      <p
        className={cn(
          "text-muted-foreground py-4 text-center text-xs",
          className,
        )}
      >
        No identity providers configured.
      </p>
    );
  }

  return (
    <div
      className={cn("space-y-2", className)}
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
        className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive-subtle px-3 py-2.5"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground">
            Delete <span className="font-medium">{name}</span>?
          </p>
          {error && (
            <p className="mt-0.5 text-[0.65rem] text-destructive">
              {getUserMessage(error)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
              "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
              "disabled:pointer-events-none disabled:opacity-50",
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
              "rounded-md px-2.5 py-1 text-xs",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "disabled:pointer-events-none disabled:opacity-50",
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
      className="flex items-center gap-3 rounded-lg border border-border-muted px-3 py-2.5 hover:border-border transition-colors"
    >
      <ShieldIcon />

      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {name}
        </span>
        {slug && (
          <span className="block text-xs text-muted-foreground font-mono">
            {slug}
          </span>
        )}
      </div>

      <div className="hidden sm:flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
        {isSso && (
          <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary-subtle px-2 py-0.5 text-[0.65rem] font-medium text-primary">
            SSO
          </span>
        )}
        {isJit && (
          <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary-subtle px-2 py-0.5 text-[0.65rem] font-medium text-primary">
            JIT
          </span>
        )}
        {createdAt && (
          <span title={`Created ${timestampDate(createdAt).toISOString()}`}>
            {formatShortDate(timestampDate(createdAt))}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${name}`}
            className={cn(
              "shrink-0 rounded p-1",
              "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
              "transition-colors",
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
            "shrink-0 rounded p-1",
            "text-muted-foreground hover:text-destructive hover:bg-destructive-subtle",
            "transition-colors",
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
      className="shrink-0 text-muted-foreground"
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
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
