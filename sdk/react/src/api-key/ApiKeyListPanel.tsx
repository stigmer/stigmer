"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { findOrgByRef, useOptionalOrg } from "../organization/OrgProvider.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useApiKeyList } from "./useApiKeyList.js";
import { useDeleteApiKey } from "./useDeleteApiKey.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { LastUsedLabel } from "../internal/LastUsedLabel.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link ApiKeyListPanel}. */
export interface ApiKeyListPanelProps {
  /** Re-expose refetch so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /**
   * Reference instant for the "last used" relative stamp. Defaults to
   * the live clock. **Deterministic hosts (documentation embeds, video
   * export) must pass a frozen instant** — otherwise a depicted key's
   * "2h ago" drifts with every replay.
   */
  readonly now?: Date;
}

/**
 * Displays a list of {@link ApiKey} resources for the authenticated
 * identity with inline delete confirmation.
 *
 * Each key is rendered as a row showing name, fingerprint, scope,
 * creation date, expiry, and last-used time. A delete button triggers
 * an inline confirmation — the row transforms to show confirm/cancel
 * actions.
 *
 * API keys belong to the authenticated user: the server returns all of
 * their keys, regardless of organization. A key's scope says where it
 * works: in every organization its owner belongs to, or in the one
 * organization it is limited to, named by its slug when the user's
 * organization list (from an enclosing `OrgProvider`) holds it.
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
  now,
}: ApiKeyListPanelProps) {
  const { apiKeys, isLoading, error, refetch } = useApiKeyList();

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  return (
    <ApiKeyListView
      apiKeys={apiKeys}
      isLoading={isLoading}
      error={error}
      onDeleted={refetch}
      emptyText="No API keys yet."
      className={className}
      now={now}
    />
  );
}

// ---------------------------------------------------------------------------
// ApiKeyListView (package-internal)
// ---------------------------------------------------------------------------

/** Props for {@link ApiKeyListView}. */
export interface ApiKeyListViewProps {
  readonly apiKeys: readonly ApiKey[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** Fired after a key is revoked, so the owner of the list re-reads it. */
  readonly onDeleted: () => void;
  /** Shown when the list is empty. */
  readonly emptyText: string;
  readonly className?: string;
  readonly now?: Date;
}

/**
 * The rows of a key list with their inline revoke confirmation, whoever's
 * keys they are: the caller's own ({@link ApiKeyListPanel}) or a service
 * account's (`ServiceAccountKeyListPanel`). Revoking is the ordinary
 * `apiKey.delete` either way. Not exported from the package barrel.
 */
export function ApiKeyListView({
  apiKeys,
  isLoading,
  error,
  onDeleted,
  emptyText,
  className,
  now,
}: ApiKeyListViewProps) {
  const orgs = useOptionalOrg()?.orgs ?? NO_ORGS;
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <LoadingRegion
        className={cn("stg:space-y-2", className)}
        label="Loading API keys"
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

  if (apiKeys.length === 0) {
    return (
      <p
        className={cn(
          "stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs",
          className,
        )}
      >
        {emptyText}
      </p>
    );
  }

  return (
    <div
      className={cn("stg:space-y-2", className)}
      role="list"
      aria-label="API keys"
    >
      {apiKeys.map((key) => {
        const id = key.metadata?.id ?? "";
        return (
          <ApiKeyRow
            key={id}
            apiKey={key}
            scope={describeKeyScope(key, orgs)}
            now={now}
            isConfirming={confirmingId === id}
            onConfirmDelete={() => setConfirmingId(id)}
            onCancelDelete={() => setConfirmingId(null)}
            onDeleted={() => {
              setConfirmingId(null);
              onDeleted();
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
  scope,
  now,
  isConfirming,
  onConfirmDelete,
  onCancelDelete,
  onDeleted,
}: {
  apiKey: ApiKey;
  scope: string;
  now?: Date;
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
        className="stg:flex stg:items-center stg:justify-between stg:rounded-lg stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:px-3 stg:py-2.5"
      >
        <div className="stg:min-w-0 stg:flex-1">
          <p className="stg:text-xs stg:text-foreground">
            Delete <span className="stg:font-medium">{name}</span>?
            {fingerprint && (
              <span className="stg:text-muted-foreground">
                {" "}
                (…{fingerprint})
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
      {/* Key icon */}
      <KeyIcon />

      {/* Name + fingerprint */}
      <div className="stg:min-w-0 stg:flex-1">
        <span className="stg:block stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
          {name}
        </span>
        {fingerprint && (
          <span className="stg:block stg:text-xs stg:text-muted-foreground stg:font-mono">
            …{fingerprint}
          </span>
        )}
        <span className="stg:block stg:truncate stg:text-xs stg:text-muted-foreground">
          {scope}
        </span>
      </div>

      {/* Metadata columns */}
      <div className="stg:hidden stg:sm:flex stg:shrink-0 stg:items-center stg:gap-4 stg:text-xs stg:text-muted-foreground">
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
        <span>
          {neverExpires
            ? "No expiry"
            : expiresAt
              ? `Expires ${formatShortDate(timestampDate(expiresAt))}`
              : "No expiry"}
        </span>
        <LastUsedLabel at={lastUsedAt} now={now} />
      </div>

      {/* Delete button */}
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
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const NO_ORGS: readonly Organization[] = [];

/**
 * Where a key works, for its row: every organization when it names none,
 * otherwise the one it names, by slug (or name) when the user's
 * organization list holds it. A stored key names its organization by id,
 * which is never shown.
 */
function describeKeyScope(
  apiKey: ApiKey,
  orgs: readonly Organization[],
): string {
  const ref = apiKey.spec?.boundOrg ?? "";
  if (!ref) return "All your organizations";
  const org = findOrgByRef(orgs, ref);
  const label = org?.metadata?.slug || org?.metadata?.name;
  return label ? `Only in ${label}` : "Limited to one organization";
}

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

