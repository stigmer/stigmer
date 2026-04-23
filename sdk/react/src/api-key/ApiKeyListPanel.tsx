"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { useApiKeyList } from "./useApiKeyList";
import { useDeleteApiKey } from "./useDeleteApiKey";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link ApiKeyListPanel}. */
export interface ApiKeyListPanelProps {
  /** Re-expose refetch so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Displays a list of {@link ApiKey} resources for the authenticated
 * identity with inline delete confirmation.
 *
 * Each key is rendered as a row showing name, fingerprint, creation
 * date, expiry, and last-used time. A delete button triggers an
 * inline confirmation — the row transforms to show confirm/cancel
 * actions.
 *
 * API keys are identity-scoped: the server returns all keys belonging
 * to the authenticated user, regardless of organization.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <ApiKeyListPanel />
 *
 * <ApiKeyListPanel
 *   onRefetchRef={(refetch) => { listRefetchRef.current = refetch; }}
 * />
 * ```
 */
export function ApiKeyListPanel({
  onRefetchRef,
  className,
}: ApiKeyListPanelProps) {
  const { apiKeys, isLoading, error, refetch } = useApiKeyList();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  if (isLoading) {
    return (
      <div
        className={cn("space-y-2", className)}
        aria-busy="true"
        aria-label="Loading API keys"
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

  if (apiKeys.length === 0) {
    return (
      <p
        className={cn(
          "text-muted-foreground py-4 text-center text-xs",
          className,
        )}
      >
        No API keys yet.
      </p>
    );
  }

  return (
    <div
      className={cn("space-y-2", className)}
      role="list"
      aria-label="API keys"
    >
      {apiKeys.map((key) => {
        const id = key.metadata?.id ?? "";
        return (
          <ApiKeyRow
            key={id}
            apiKey={key}
            isConfirming={confirmingId === id}
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
// ApiKeyRow (internal)
// ---------------------------------------------------------------------------

function ApiKeyRow({
  apiKey,
  isConfirming,
  onConfirmDelete,
  onCancelDelete,
  onDeleted,
}: {
  apiKey: ApiKey;
  isConfirming: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onDeleted: () => void;
}) {
  const { deleteKey, isDeleting, error } = useDeleteApiKey();

  const id = apiKey.metadata?.id ?? "";
  const name = apiKey.metadata?.name || apiKey.metadata?.slug || "Unnamed key";
  const fingerprint = apiKey.spec?.fingerprint;
  const neverExpires = apiKey.spec?.neverExpires;
  const expiresAt = apiKey.spec?.expiresAt;
  const lastUsedAt = apiKey.status?.lastUsedAt;
  const createdAt = apiKey.status?.audit?.specAudit?.createdAt;

  const handleDelete = useCallback(async () => {
    try {
      await deleteKey(id);
      onDeleted();
    } catch {
      // error state is surfaced via the hook
    }
  }, [id, deleteKey, onDeleted]);

  if (isConfirming) {
    return (
      <div
        role="listitem"
        className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive-subtle px-3 py-2.5"
      >
        <div className="min-w-0 flex-1">
          <p className="text-xs text-foreground">
            Delete <span className="font-medium">{name}</span>?
            {fingerprint && (
              <span className="text-muted-foreground">
                {" "}
                (…{fingerprint})
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
      {/* Key icon */}
      <KeyIcon />

      {/* Name + fingerprint */}
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {name}
        </span>
        {fingerprint && (
          <span className="block text-xs text-muted-foreground font-mono">
            …{fingerprint}
          </span>
        )}
      </div>

      {/* Metadata columns */}
      <div className="hidden sm:flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
        {createdAt && (
          <span title={`Created ${timestampDate(createdAt).toISOString()}`}>
            {formatShortDate(timestampDate(createdAt))}
          </span>
        )}
        <span>
          {neverExpires
            ? "No expiry"
            : expiresAt
              ? `Expires ${formatShortDate(timestampDate(expiresAt))}`
              : "No expiry"}
        </span>
        <span>
          {lastUsedAt ? formatRelativeTime(timestampDate(lastUsedAt)) : "Never used"}
        </span>
      </div>

      {/* Delete button */}
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

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();

  if (diffMs < 0) return "Just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "Just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatShortDate(date);
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
      <circle cx="5.5" cy="10.5" r="3" />
      <path d="M8 8l5.5-5.5M11 5l2-2M10.5 2.5l2 2" />
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
