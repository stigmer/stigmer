"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { usePlatformClientList } from "./usePlatformClientList";
import { useDeletePlatformClient } from "./useDeletePlatformClient";

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
        className={cn("space-y-2", className)}
        aria-busy="true"
        aria-label="Loading platform clients"
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

  if (platformClients.length === 0) {
    return (
      <p
        className={cn(
          "text-muted-foreground py-4 text-center text-xs",
          className,
        )}
      >
        No platform clients configured.
      </p>
    );
  }

  return (
    <div
      className={cn("space-y-2", className)}
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
        className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive-subtle px-3 py-2.5"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground">
            Delete <span className="font-medium">{name}</span>?
            {clientId && (
              <span className="ml-1 text-muted-foreground">
                This will invalidate client ID{" "}
                <code className="font-mono">{clientId}</code>.
              </span>
            )}
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
      <KeyIcon />

      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {name}
        </span>
        {clientId && (
          <span className="block truncate text-xs text-muted-foreground font-mono">
            {clientId}
          </span>
        )}
      </div>

      <div className="hidden sm:flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
        {fingerprint && (
          <span
            className="font-mono"
            title={`Secret fingerprint: ${fingerprint}`}
          >
            ••••{fingerprint.slice(-4)}
          </span>
        )}
        <ExpiryBadge spec={spec} />
        {spec?.autoProvisionAccounts && (
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
// ExpiryBadge (internal)
// ---------------------------------------------------------------------------

function ExpiryBadge({ spec }: { spec: PlatformClient["spec"] }) {
  if (spec?.neverExpires) {
    return (
      <span className="text-[0.65rem] text-muted-foreground">No expiry</span>
    );
  }
  if (spec?.expiresAt) {
    const date = timestampDate(spec.expiresAt);
    const isExpired = date < new Date();
    return (
      <span
        className={cn(
          "text-[0.65rem]",
          isExpired ? "text-destructive font-medium" : "text-muted-foreground",
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
      className="shrink-0 text-muted-foreground"
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
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
