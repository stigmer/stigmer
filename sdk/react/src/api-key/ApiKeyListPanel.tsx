"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ApiKey } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { findOrgByRef, useKnownOrgs } from "../organization/OrgProvider.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useApiKeyList } from "./useApiKeyList.js";
import { useDeleteApiKey } from "./useDeleteApiKey.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Button } from "../button/Button.js";
import { IconButton } from "../button/IconButton.js";
import { LastUsedLabel } from "../internal/LastUsedLabel.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { LoadMoreFooter } from "../internal/LoadMoreFooter.js";
import { List, ListRow } from "../internal/surface/List.js";

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
 * organization it is limited to, named by its slug when it is one of the
 * user's organizations or the one they have open (from an enclosing
 * `OrgProvider`).
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * // The page keeps the list's refetch, to call after it creates a key.
 * function ApiKeysPage() {
 *   const refetchList = useRef<() => void>(() => {});
 *   return <ApiKeyListPanel onRefetchRef={(refetch) => { refetchList.current = refetch; }} />;
 * }
 * ```
 */
export function ApiKeyListPanel({
  onRefetchRef,
  className,
  now,
}: ApiKeyListPanelProps) {
  const { apiKeys, isLoading, error, refetch, ...pager } = useApiKeyList();

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  return (
    <ApiKeyListView
      apiKeys={apiKeys}
      isLoading={isLoading}
      error={error}
      onDeleted={refetch}
      onRetry={refetch}
      emptyText="No API keys yet"
      emptyDescription="Make one for the CLI on a server, a CI job or a script. You see its value once, when it is made."
      className={className}
      now={now}
      pager={pager}
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
  /** Reads the list again after a failed read; the error offers Retry when given. */
  readonly onRetry?: () => void;
  /** The empty list's heading. */
  readonly emptyText: string;
  /** What to do about an empty list, under its heading. */
  readonly emptyDescription?: string;
  readonly className?: string;
  readonly now?: Date;
  /** The list's paging state, for its "Load more" footer. */
  readonly pager: KeyListPager;
}

/** The paging fields a key list hook returns beside its keys. */
export interface KeyListPager {
  readonly hasMore: boolean;
  readonly loadMore: () => void;
  readonly isLoadingMore: boolean;
  readonly loadMoreError: Error | null;
  readonly isRefetching: boolean;
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
  onRetry,
  emptyText,
  emptyDescription,
  className,
  now,
  pager,
}: ApiKeyListViewProps) {
  const orgs = useKnownOrgs() ?? NO_ORGS;
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  if (isLoading) {
    return <SettingsSkeleton label="Loading API keys" rows={3} className={className} />;
  }

  if (error) {
    return <ErrorMessage error={error} title="The API keys could not be read" retry={onRetry} className={className} />;
  }

  if (apiKeys.length === 0) {
    return (
      <EmptyState
        variant="first-use"
        title={emptyText}
        description={emptyDescription}
        className={cn("stg:rounded-lg stg:border stg:border-dashed stg:border-border", className)}
      />
    );
  }

  return (
    <div className={className}>
      <List aria-label="API keys">
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
      </List>
      <LoadMoreFooter hasMore={pager.hasMore} loadMore={pager.loadMore} isLoadingMore={pager.isLoadingMore} loadMoreError={pager.loadMoreError} />
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
      // The confirmation's sentence wraps, so it keeps its own markup on the
      // list's row padding rather than a ListRow's one truncated line.
      <li className="stg:flex stg:min-h-10 stg:items-center stg:justify-between stg:gap-3 stg:bg-destructive-subtle stg:px-3.5 stg:py-2.5">
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
      leading={<KeyIcon />}
      name={name}
      description={
        <>
          {fingerprint && <span className="stg:block stg:font-mono">…{fingerprint}</span>}
          <span className="stg:block stg:truncate">{scope}</span>
        </>
      }
      trailing={
        <>
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
          <IconButton
            label={`Delete ${name}`}
            size="xs"
            icon={<TrashIcon />}
            onClick={onConfirmDelete}
            className="stg:hover:text-destructive stg:hover:bg-destructive-subtle"
          />
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const NO_ORGS: readonly Organization[] = [];

/**
 * Where a key works, for its row: every organization when it names none,
 * otherwise the one it names, by slug (or name) when it is one of the
 * user's organizations or the one they have open. A stored key names its organization by id,
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

