"use client";

import { cn } from "@stigmer/design-tokens";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ChannelApp } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { channelProviderOf } from "../channel/providers.js";
import { useChannelAppList } from "./useChannelAppList.js";
import { SettingsSkeleton } from "../settings/SettingsSkeleton.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { IconButton } from "../button/IconButton.js";
import { List, ListRow } from "../internal/surface/List.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link ChannelAppListPanel}. */
export interface ChannelAppListPanelProps {
  /** Organization id to list channel apps for (a slug is also accepted). */
  readonly org: string;
  /**
   * Fired when the user wants to view/edit a channel app.
   * When provided, rows become interactive with a pencil icon button.
   */
  readonly onEdit?: (app: ChannelApp) => void;
  /** Re-expose refetch so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /**
   * Shown when the list is empty. Defaults to "No channel apps registered
   * yet." The list holds only the apps the caller may view (the
   * organization's admins, and anyone granted viewer on an app), so a host
   * that knows the caller may not manage channel apps should say who does
   * instead.
   */
  readonly emptyState?: string;
  /** What to do about the empty list, under {@link ChannelAppListPanelProps.emptyState}. */
  readonly emptyDescription?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Displays the {@link ChannelApp} resources of an organization that the
 * caller may view — the customer's own provider apps (Slack,
 * Meta/WhatsApp) that Slack and WhatsApp channels can install through.
 *
 * Each row shows the app name, provider, the provider's non-secret app
 * identifier, and creation date. Secret fields never appear (they
 * arrive redacted).
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * import type { ChannelApp } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
 *
 * function ChannelAppsPage() {
 *   const [editing, setEditing] = useState<ChannelApp | null>(null);
 *   if (editing) return <p>Editing {editing.metadata?.name}</p>;
 *   return <ChannelAppListPanel org="acme" onEdit={setEditing} />;
 * }
 * ```
 */
export function ChannelAppListPanel({
  org,
  onEdit,
  onRefetchRef,
  emptyState = "No channel apps registered yet.",
  emptyDescription = "Register your Slack or Meta app here, and every channel can install through it.",
  className,
}: ChannelAppListPanelProps) {
  const { channelApps, isLoading, error, refetch } = useChannelAppList(org);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  if (isLoading) {
    return <SettingsSkeleton label="Loading channel apps" rows={3} className={className} />;
  }

  if (error) {
    return <ErrorMessage error={error} title="The channel apps could not be read" retry={refetch} className={className} />;
  }

  if (channelApps.length === 0) {
    return (
      <EmptyState
        variant="first-use"
        title={emptyState}
        description={emptyDescription}
        className={cn("stg:rounded-lg stg:border stg:border-dashed stg:border-border", className)}
      />
    );
  }

  return (
    <List aria-label="Channel apps" className={className}>
      {channelApps.map((app) => (
        <ChannelAppRow
          key={app.metadata?.id ?? ""}
          channelApp={app}
          onEdit={onEdit ? () => onEdit(app) : undefined}
        />
      ))}
    </List>
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
    <ListRow
      name={name}
      nameAdornment={
        // Fall back to the raw oneof case for providers this UI
        // doesn't know yet — honest, and never an empty label.
        <span className="stg:text-2xs stg:font-normal stg:text-muted-foreground">
          {provider?.label ?? providerCase ?? ""}
        </span>
      }
      description={
        providerAppId || createdAt ? (
          <span className="stg:flex stg:items-baseline stg:gap-2">
            {providerAppId && (
              <span className="stg:truncate stg:font-mono">{providerAppId}</span>
            )}
            {createdAt && (
              <span className="stg:shrink-0">{timestampDate(createdAt).toLocaleDateString()}</span>
            )}
          </span>
        ) : undefined
      }
      trailing={
        onEdit ? <IconButton size="xs" label={`Edit ${name}`} icon={<PencilIcon />} onClick={onEdit} /> : undefined
      }
    />
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
