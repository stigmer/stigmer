"use client";

import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { OAuthApp } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { useOAuthAppList } from "./useOAuthAppList";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link OAuthAppListPanel}. */
export interface OAuthAppListPanelProps {
  /** Organization slug to list OAuth apps for. */
  readonly org: string;
  /** Re-expose refetch so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Displays a read-only list of {@link OAuthApp} resources owned by an
 * organization.
 *
 * Each row shows the provider name, client ID (non-secret), and
 * creation date. These are the BYOA OAuth apps created through the
 * "Bring your own app" flow on MCP server detail pages.
 *
 * This is a visibility surface — creation and management of OAuth apps
 * happens in-context on MCP server detail pages.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <OAuthAppListPanel org="acme" />
 * ```
 */
export function OAuthAppListPanel({
  org,
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
        className={cn("space-y-2", className)}
        aria-busy="true"
        aria-label="Loading OAuth apps"
      >
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="bg-muted/40 h-14 animate-pulse rounded-lg"
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

  if (oauthApps.length === 0) {
    return (
      <p
        className={cn(
          "text-muted-foreground py-4 text-center text-xs",
          className,
        )}
      >
        No OAuth apps configured. You can bring your own OAuth app from any
        MCP server&apos;s detail page.
      </p>
    );
  }

  return (
    <div
      className={cn("space-y-2", className)}
      role="list"
      aria-label="OAuth apps"
    >
      {oauthApps.map((app) => (
        <OAuthAppRow key={app.metadata?.id ?? ""} oauthApp={app} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OAuthAppRow (internal)
// ---------------------------------------------------------------------------

function OAuthAppRow({ oauthApp }: { oauthApp: OAuthApp }) {
  const provider = oauthApp.spec?.provider || "OAuth App";
  const clientId = oauthApp.spec?.clientId;
  const createdAt = oauthApp.status?.audit?.specAudit?.createdAt;

  return (
    <div
      role="listitem"
      className="flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5 transition-colors hover:border-border"
    >
      <OAuthIcon />

      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {provider}
        </span>
        {clientId && (
          <span className="block truncate text-xs font-mono text-muted-foreground">
            {clientId}
          </span>
        )}
      </div>

      <div className="hidden shrink-0 items-center gap-4 text-xs text-muted-foreground sm:flex">
        {createdAt && (
          <span title={`Created ${timestampDate(createdAt).toISOString()}`}>
            {formatShortDate(timestampDate(createdAt))}
          </span>
        )}
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
      className="shrink-0 text-muted-foreground"
    >
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M8 7v2" />
      <circle cx="8" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
