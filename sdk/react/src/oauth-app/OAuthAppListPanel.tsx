"use client";

import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { useOAuthAppList } from "./useOAuthAppList.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link OAuthAppListPanel}. */
export interface OAuthAppListPanelProps {
  /** Organization slug to list OAuth apps for. */
  readonly org: string;
  /**
   * Fired when the user wants to view/edit an OAuth app.
   * When provided, rows become interactive with a pencil icon button.
   * When absent, rows remain static (backward compatible).
   */
  readonly onEdit?: (app: OAuthApp) => void;
  /** Re-expose refetch so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Displays a list of {@link OAuthApp} resources owned by an
 * organization.
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
 * <OAuthAppListPanel
 *   org="acme"
 *   onEdit={(app) => setFlow({ phase: "editing", oauthApp: app })}
 *   onRefetchRef={(refetch) => { listRefetchRef.current = refetch; }}
 * />
 * ```
 */
export function OAuthAppListPanel({
  org,
  onEdit,
  onRefetchRef,
  className,
}: OAuthAppListPanelProps) {
  const { oauthApps, isLoading, error, refetch } = useOAuthAppList(org);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  if (isLoading) {
    return (
      <div
        className={cn("stg:space-y-2", className)}
        aria-busy="true"
        aria-label="Loading OAuth apps"
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

  if (oauthApps.length === 0) {
    return (
      <p
        className={cn(
          "stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs",
          className,
        )}
      >
        No OAuth apps configured yet.
      </p>
    );
  }

  return (
    <div
      className={cn("stg:space-y-2", className)}
      role="list"
      aria-label="OAuth apps"
    >
      {oauthApps.map((app) => (
        <OAuthAppRow
          key={app.metadata?.id ?? ""}
          oauthApp={app}
          onEdit={onEdit ? () => onEdit(app) : undefined}
        />
      ))}
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
    <div
      role="listitem"
      className="stg:flex stg:items-center stg:gap-3 stg:rounded-lg stg:border stg:border-border-muted stg:px-3 stg:py-2.5 stg:transition-colors stg:hover:border-border"
    >
      <OAuthIcon />

      <div className="stg:min-w-0 stg:flex-1">
        <span className="stg:block stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
          {provider}
        </span>
        {clientId && (
          <span className="stg:block stg:truncate stg:text-xs stg:font-mono stg:text-muted-foreground">
            {clientId}
          </span>
        )}
      </div>

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
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${provider}`}
          className={cn(
            "stg:shrink-0 stg:rounded stg:p-1",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:transition-colors",
          )}
        >
          <PencilIcon />
        </button>
      )}
    </div>
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
