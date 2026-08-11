"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { usePlatformClientList } from "./usePlatformClientList.js";
import { useDeletePlatformClient } from "./useDeletePlatformClient.js";

/** Props for {@link PlatformClientListPanel}. */
export interface PlatformClientListPanelProps {
  /** Organization slug whose platform clients should be listed. */
  readonly org: string;
  /** Fired when the user wants to edit a platform client. */
  readonly onEdit?: (pc: PlatformClient) => void;
  /** Expose the refetch function so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Displays a list of {@link PlatformClient} resources for an
 * organization with inline delete confirmation.
 *
 * Each row shows the client name, `client_id` (monospace), secret
 * fingerprint, expiry status, and creation date. A delete button
 * triggers an inline confirmation flow.
 *
 * Platform clients are admin-level resources with small cardinality
 * (typically 1–5 per org), so the list is rendered without pagination.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <PlatformClientListPanel org="acme" />
 * ```
 *
 * @example
 * ```tsx
 * <PlatformClientListPanel
 *   org="acme"
 *   onEdit={(pc) => setFlow({ phase: "editing", platformClient: pc })}
 *   onRefetchRef={(refetch) => { listRefetchRef.current = refetch; }}
 * />
 * ```
 */
export function PlatformClientListPanel({
  org,
  onEdit,
  onRefetchRef,
  className,
}: PlatformClientListPanelProps) {
  const { platformClients, isLoading, error, refetch } =
    usePlatformClientList(org);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  if (isLoading) {
    return (
      <div
        className={cn("stg:space-y-2", className)}
        aria-busy="true"
        aria-label="Loading platform clients"
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

  if (platformClients.length === 0) {
    return (
      <p
        className={cn(
          "stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs",
          className,
        )}
      >
        No platform clients configured.
      </p>
    );
  }

  return (
    <div
      className={cn("stg:space-y-2", className)}
      role="list"
      aria-label="Platform clients"
    >
      {platformClients.map((pc) => {
        const id = pc.metadata?.id ?? "";
        return (
          <PlatformClientRow
            key={id}
            platformClient={pc}
            isConfirming={confirmingId === id}
            onEdit={onEdit ? () => onEdit(pc) : undefined}
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
// PlatformClientRow (internal)
// ---------------------------------------------------------------------------

function PlatformClientRow({
  platformClient,
  isConfirming,
  onEdit,
  onConfirmDelete,
  onCancelDelete,
  onDeleted,
}: {
  platformClient: PlatformClient;
  isConfirming: boolean;
  onEdit?: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDeleted: () => void;
}) {
  const { deletePlatformClient, isDeleting, error } =
    useDeletePlatformClient();

  const id = platformClient.metadata?.id ?? "";
  const spec = platformClient.spec;
  const name = platformClient.metadata?.name ?? "Unnamed client";
  const clientId = spec?.clientId ?? "";
  const fingerprint = spec?.secretFingerprint ?? "";
  const createdAt =
    platformClient.status?.audit?.specAudit?.createdAt;

  const handleDelete = useCallback(async () => {
    try {
      await deletePlatformClient({ resourceId: id });
      onDeleted();
    } catch {
      // error state is surfaced via the hook
    }
  }, [id, deletePlatformClient, onDeleted]);

  if (isConfirming) {
    return (
      <div
        role="listitem"
        className="stg:flex stg:items-center stg:justify-between stg:rounded-lg stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-3 stg:py-2.5"
      >
        <div className="stg:min-w-0 stg:flex-1">
          <p className="stg:text-xs stg:text-foreground">
            Delete <span className="stg:font-medium">{name}</span>?
            {clientId && (
              <span className="stg:ml-1 stg:text-muted-foreground">
                This will invalidate client ID{" "}
                <code className="stg:font-mono">{clientId}</code>.
              </span>
            )}
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
      <KeyIcon />

      <div className="stg:min-w-0 stg:flex-1">
        <span className="stg:block stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
          {name}
        </span>
        {clientId && (
          <span className="stg:block stg:truncate stg:text-xs stg:text-muted-foreground stg:font-mono">
            {clientId}
          </span>
        )}
      </div>

      <div className="stg:hidden stg:sm:flex stg:shrink-0 stg:items-center stg:gap-3 stg:text-xs stg:text-muted-foreground">
        {fingerprint && (
          <span
            className="stg:font-mono"
            title={`Secret fingerprint: ${fingerprint}`}
          >
            ••••{fingerprint.slice(-4)}
          </span>
        )}
        <ExpiryBadge spec={spec} />
        {spec?.autoProvisionAccounts && (
          <span className="stg:inline-flex stg:items-center stg:rounded-full stg:border stg:border-primary/30 stg:bg-primary-subtle stg:px-2 stg:py-0.5 stg:text-[0.65rem] stg:font-medium stg:text-primary">
            JIT
          </span>
        )}
        {createdAt && (
          <span title={`Created ${timestampDate(createdAt).toISOString()}`}>
            {formatShortDate(timestampDate(createdAt))}
          </span>
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
// ExpiryBadge (internal)
// ---------------------------------------------------------------------------

function ExpiryBadge({ spec }: { spec: PlatformClient["spec"] }) {
  if (spec?.neverExpires) {
    return (
      <span className="stg:text-[0.65rem] stg:text-muted-foreground">No expiry</span>
    );
  }
  if (spec?.expiresAt) {
    const date = timestampDate(spec.expiresAt);
    const isExpired = date < new Date();
    return (
      <span
        className={cn(
          "stg:text-[0.65rem]",
          isExpired ? "stg:text-destructive stg:font-medium" : "stg:text-muted-foreground",
        )}
        title={`Expires ${date.toISOString()}`}
      >
        {isExpired ? "Expired" : `Exp ${formatShortDate(date)}`}
      </span>
    );
  }
  return null;
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

function KeyIcon() {
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
      <circle cx="10.5" cy="5.5" r="3" />
      <path d="M8.5 7.5L3 13l-.5-2.5L5 10l1-1-1-1 3.5.5z" />
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
