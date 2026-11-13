"use client";

import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { OAuthApp } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useOAuthAppList } from "./useOAuthAppList.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import type { EmptyStateAction } from "../empty-state/types.js";
import { LoadMoreFooter } from "../internal/LoadMoreFooter.js";
import { IconButton } from "../button/IconButton.js";
import { List, ListRow } from "../internal/surface/List.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link OAuthAppListPanel}. */
export interface OAuthAppListPanelProps {
  /** Organization id to list OAuth apps for (a slug is also accepted). */
  readonly org: string;
  /**
   * Fired when the user wants to view/edit an OAuth app.
   * When provided, rows become interactive with a pencil icon button.
   * When absent, rows remain static (backward compatible).
   */
  readonly onEdit?: (app: OAuthApp) => void;
  /** Re-expose refetch so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /**
   * Shown when the list is empty. Defaults to "No OAuth apps configured
   * yet." The list holds only the apps the caller may view (the
   * organization's admins, and anyone granted viewer on an app), so a host
   * that knows the caller may not manage OAuth apps should say who does
   * instead.
   */
  readonly emptyState?: string;
  /** What to do about the empty list, under {@link OAuthAppListPanelProps.emptyState}. */
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
 * Displays the {@link OAuthApp} resources of an organization that the
 * caller may view.
 *
 * Each row shows the provider name, client ID (non-secret), and
 * creation date. When `onEdit` is provided, rows include a pencil
 * icon that fires the callback with the selected app — enabling
 * navigation to a detail/edit view.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <OAuthAppListPanel org="acme" />
 * ```
 *
 * @example
 * ```tsx
 * import type { OAuthApp } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
 *
 * function OAuthApps({ onEdit }: { onEdit: (app: OAuthApp) => void }) {
 *   return <OAuthAppListPanel org="acme" onEdit={onEdit} />;
 * }
 * ```
 */
export function OAuthAppListPanel({
  org,
  onEdit,
  onRefetchRef,
  emptyState = "No OAuth apps configured yet.",
  emptyDescription = "Add your own login app, and sign-ins at the addresses it lists use it.",
  emptyAction,
  className,
}: OAuthAppListPanelProps) {
  const { oauthApps, isLoading, error, refetch, hasMore, loadMore, isLoadingMore, loadMoreError } =
    useOAuthAppList(org);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  if (isLoading) {
    return <SettingsSkeleton label="Loading OAuth apps" rows={3} className={className} />;
  }

  if (error) {
    return <ErrorMessage error={error} title="Couldn't load the OAuth apps." retry={refetch} className={className} />;
  }

  if (oauthApps.length === 0) {
    return (
      <EmptyState
        variant="first-use"
        title={emptyState}
        description={emptyDescription}
        action={emptyAction}        className={className}
      />
    );
  }

  return (
    <div className={className}>
      <List aria-label="OAuth apps">
        {oauthApps.map((app) => (
          <OAuthAppRow
            key={app.metadata?.id ?? ""}
            oauthApp={app}
            onEdit={onEdit ? () => onEdit(app) : undefined}
          />
        ))}
      </List>
      <LoadMoreFooter hasMore={hasMore} loadMore={loadMore} isLoadingMore={isLoadingMore} loadMoreError={loadMoreError} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// OAuthAppRow (internal)
// ---------------------------------------------------------------------------

function OAuthAppRow({
  oauthApp,
  onEdit,
}: {
  oauthApp: OAuthApp;
  onEdit?: () => void;
}) {
  const provider = oauthApp.spec?.provider || "OAuth App";
  const clientId = oauthApp.spec?.clientId;
  const createdAt = oauthApp.status?.audit?.specAudit?.createdAt;

  return (
    <ListRow
      leading={<OAuthIcon />}
      name={provider}
      description={clientId ? <span className="stg:font-mono">{clientId}</span> : undefined}
      trailing={
        <>
          <div className="stg:hidden stg:shrink-0 stg:items-center stg:gap-4 stg:text-xs stg:text-muted-foreground stg:sm:flex">
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

          {onEdit && (
            <IconButton size="xs" label={`Edit ${provider}`} icon={<PencilIcon />} onClick={onEdit} />
          )}
        </>
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Icons (edit action)
// ---------------------------------------------------------------------------

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

function OAuthIcon() {
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
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M8 7v2" />
      <circle cx="8" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
