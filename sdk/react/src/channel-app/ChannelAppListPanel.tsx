"use client";

import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { useChannelAppList } from "./useChannelAppList.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link ChannelAppListPanel}. */
export interface ChannelAppListPanelProps {
  /** Organization slug to list channel apps for. */
  readonly org: string;
  /**
   * Fired when the user wants to view/edit a channel app.
   * When provided, rows become interactive with a pencil icon button.
   */
  readonly onEdit?: (app: ChannelApp) => void;
  /** Re-expose refetch so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Displays the {@link ChannelApp} resources owned by an organization —
 * the customer's own Slack apps that agent channels can install through.
 *
 * Each row shows the app name, provider, client ID (non-secret), and
 * creation date. Secret fields never appear (they arrive redacted).
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <ChannelAppListPanel
 *   org="acme"
 *   onEdit={(app) => setFlow({ phase: "editing", channelApp: app })}
 * />
 * ```
 */
export function ChannelAppListPanel({
  org,
  onEdit,
  onRefetchRef,
  className,
}: ChannelAppListPanelProps) {
  const { channelApps, isLoading, error, refetch } = useChannelAppList(org);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  if (isLoading) {
    return (
      <div
        className={cn("space-y-2", className)}
        aria-busy="true"
        aria-label="Loading channel apps"
      >
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="bg-muted-subtle h-14 animate-pulse rounded-lg" />
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

  if (channelApps.length === 0) {
    return (
      <p
        className={cn(
          "text-muted-foreground py-4 text-center text-xs",
          className,
        )}
      >
        No channel apps registered yet.
      </p>
    );
  }

  return (
    <div
      className={cn("space-y-2", className)}
      role="list"
      aria-label="Channel apps"
    >
      {channelApps.map((app) => (
        <ChannelAppRow
          key={app.metadata?.id ?? ""}
          channelApp={app}
          onEdit={onEdit ? () => onEdit(app) : undefined}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row (internal)
// ---------------------------------------------------------------------------

function ChannelAppRow({
  channelApp,
  onEdit,
}: {
  channelApp: ChannelApp;
  onEdit?: () => void;
}) {
  const name = channelApp.metadata?.name ?? "";
  const slack = channelApp.spec?.providerConfig?.case === "slack"
    ? channelApp.spec.providerConfig.value
    : undefined;
  const createdAt = channelApp.status?.audit?.specAudit?.createdAt;

  return (
    <div
      role="listitem"
      className={cn(
        "border-border bg-card flex items-center gap-3 rounded-lg border px-3 py-2.5",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-xs font-medium text-foreground">
            {name}
          </span>
          <span className="text-[0.65rem] text-muted-foreground">Slack</span>
        </div>
        <div className="flex items-baseline gap-2">
          {slack?.clientId && (
            <span className="truncate font-mono text-[0.65rem] text-muted-foreground">
              {slack.clientId}
            </span>
          )}
          {createdAt && (
            <span className="shrink-0 text-[0.65rem] text-muted-foreground">
              {timestampDate(createdAt).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${name}`}
          className={cn(
            "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
            "shrink-0 rounded-md p-1.5 transition-colors",
          )}
        >
          <PencilIcon />
        </button>
      )}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 2.5a1.4 1.4 0 0 1 2 2L5 13l-3 1 1-3 8.5-8.5z" />
    </svg>
  );
}
