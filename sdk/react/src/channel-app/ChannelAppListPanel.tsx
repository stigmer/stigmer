"use client";

import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { channelProviderOf } from "../channel/providers.js";
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
 * the customer's own provider apps (Slack, Meta/WhatsApp) that agent
 * channels can install through.
 *
 * Each row shows the app name, provider, the provider's non-secret app
 * identifier, and creation date. Secret fields never appear (they
 * arrive redacted).
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
        className={cn("stg:space-y-2", className)}
        aria-busy="true"
        aria-label="Loading channel apps"
      >
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="stg:bg-muted-subtle stg:h-14 stg:animate-pulse stg:rounded-lg" />
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

  if (channelApps.length === 0) {
    return (
      <p
        className={cn(
          "stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs",
          className,
        )}
      >
        No channel apps registered yet.
      </p>
    );
  }

  return (
    <div
      className={cn("stg:space-y-2", className)}
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
  const providerCase = channelApp.spec?.providerConfig?.case;
  const provider = channelProviderOf(providerCase);
  // The provider's non-secret app identifier — the one value that ties
  // the row to the app on the provider's dashboard.
  const providerAppId =
    channelApp.spec?.providerConfig?.case === "slack"
      ? channelApp.spec.providerConfig.value.clientId
      : channelApp.spec?.providerConfig?.case === "whatsapp"
        ? channelApp.spec.providerConfig.value.appId
        : undefined;
  const createdAt = channelApp.status?.audit?.specAudit?.createdAt;

  return (
    <div
      role="listitem"
      className={cn(
        "stg:border-border stg:bg-card stg:flex stg:items-center stg:gap-3 stg:rounded-lg stg:border stg:px-3 stg:py-2.5",
      )}
    >
      <div className="stg:min-w-0 stg:flex-1">
        <div className="stg:flex stg:items-baseline stg:gap-2">
          <span className="stg:truncate stg:text-xs stg:font-medium stg:text-foreground">
            {name}
          </span>
          {/* Fall back to the raw oneof case for providers this UI
              doesn't know yet — honest, and never an empty label. */}
          <span className="stg:text-[0.65rem] stg:text-muted-foreground">
            {provider?.label ?? providerCase ?? ""}
          </span>
        </div>
        <div className="stg:flex stg:items-baseline stg:gap-2">
          {providerAppId && (
            <span className="stg:truncate stg:font-mono stg:text-[0.65rem] stg:text-muted-foreground">
              {providerAppId}
            </span>
          )}
          {createdAt && (
            <span className="stg:shrink-0 stg:text-[0.65rem] stg:text-muted-foreground">
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
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:shrink-0 stg:rounded-md stg:p-1.5 stg:transition-colors",
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
