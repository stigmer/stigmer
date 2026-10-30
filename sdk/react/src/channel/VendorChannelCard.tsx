"use client";

// The card of one Slack or WhatsApp channel in an agent's Channels tab: the
// vendor's install state, the serving app, the on/off switch once installed
// (traffic flows only when installed and on), a Connect or Reconnect button
// while it is not, and the vendor channel's menu. It renders in the frame
// every channel card shares (ChannelCardFrame); its content and menu are
// the vendor's own.

import { useCallback } from "react";
import { FileCode2, KeyRound, LayoutTemplate, MessageSquare, MoreHorizontal, Share2, SlidersHorizontal, Trash2 } from "lucide-react";
import { cn } from "@stigmer/design-tokens";
import {
  deletedReferenceLabel,
  isDeletedReference,
} from "@stigmer/client";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import type { ChannelApp } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelInstallState } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { toast } from "../feedback/toast.js";
import { useManageAccess } from "../access/useManageAccess.js";
import { ActionMenu } from "../action-menu/index.js";
import { Button } from "../button/Button.js";
import { Switch } from "../switch/Switch.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { saveErrorMessage } from "@stigmer/react-core/internal";
import { ChannelCardFrame, ChannelStatePill } from "./ChannelCardFrame.js";
import { CHANNEL_PROVIDERS, channelProviderOf } from "./providers.js";
import {
  channelPresentationOf,
  DEFAULT_CHANNEL_PRESENTATION,
} from "./providerPresentation.js";
import { useChannelToolReadiness } from "./useChannelToolReadiness.js";
import { useSaveChannel } from "./useSaveChannel.js";

// ---------------------------------------------------------------------------
// Card — one vendor connection
// ---------------------------------------------------------------------------

/** Props for {@link VendorChannelCard}. */
export interface VendorChannelCardProps {
  readonly agent: Agent;
  readonly channel: Channel;
  readonly channelApps: readonly ChannelApp[];
  /** Whether the card's Connect/Reconnect affordance is actionable here. */
  readonly connectAvailable: boolean;
  readonly onConnectClick: () => void;
  readonly onDeleteClick: () => void;
  readonly onEditCredentials: () => void;
  readonly onViewConversations: () => void;
  readonly onViewTemplates: () => void;
  readonly onEditYaml: () => void;
  readonly onEditRunConfig: () => void;
  readonly refetch: () => void;
}

/** One Slack or WhatsApp channel's card. */
export function VendorChannelCard({
  agent,
  channel,
  channelApps,
  connectAvailable,
  onConnectClick,
  onDeleteClick,
  onEditCredentials,
  onViewConversations,
  onViewTemplates,
  onEditYaml,
  onEditRunConfig,
  refetch,
}: VendorChannelCardProps) {
  const meta = channel.metadata;
  const id = meta?.id ?? "";
  const enabled = channel.spec?.enabled ?? false;
  const installState = installStateOf(channel);
  // The serving app: set means the channel installs through
  // the org's own channel app; absent means the platform Stigmer app
  // (Slack only — WhatsApp always has one). The app's NAME is
  // the identity people address, so prefer it over the ref's slug when
  // the app is in the fetched list (it may not be — e.g. the app was
  // deleted after install).
  // An app deleted since comes back with no slug: it still names the
  // channel's serving app, read as "deleted channel app", never as the
  // platform app an absent reference means.
  const type = channel.spec?.type;
  const servingAppRef =
    type?.case === "slack" || type?.case === "whatsapp" ? type.value.appRef : undefined;
  const servingAppSlug = servingAppRef?.slug || null;
  const namedServingApp = servingAppSlug
    ? channelApps.find((app) => app.metadata?.slug === servingAppSlug)
        ?.metadata?.name || servingAppSlug
    : null;
  const servingAppName = isDeletedReference(servingAppRef)
    ? deletedReferenceLabel(ApiResourceKind.channel_app)
    : namedServingApp;

  // The spec's provider marker is set at create; unknown cases (a newer
  // server) fall back to the default provider mark rather than no icon,
  // and to the default presentation rather than no copy.
  const provider =
    channelProviderOf(channel.spec?.type?.case) ?? CHANNEL_PROVIDERS[0];
  const presentation =
    channelPresentationOf(channel.spec?.type?.case) ??
    DEFAULT_CHANNEL_PRESENTATION;

  const { update, isPending } = useSaveChannel();

  // Decide the card's actions here (not via nested permission wrappers) so
  // affordances are hidden entirely when the viewer can do nothing —
  // permissive in OSS, so local single-user sees all.
  const { allowed: canEdit } = useCheckPermission(
    { kind: "channel", id },
    "can_edit",
  );
  const { allowed: canDelete } = useCheckPermission(
    { kind: "channel", id },
    "can_delete",
  );

  // The channel's canonical access-management home: a participant grant covers
  // every conversation on the channel, so the affordance belongs on the channel
  // card. The conversation header's "Channel access" button is the
  // point-of-need shortcut to the same dialog. Self-gates on can_view_access —
  // `action` is null for viewers who may not see the access list.
  const access = useManageAccess({
    resource: id
      ? {
          kind: ApiResourceKind.channel,
          kindString: "channel",
          id,
          org: meta?.org ?? "",
          name: meta?.name || meta?.slug,
        }
      : null,
  });

  // On/off names `spec.enabled` alone: every other field keeps its
  // stored value.
  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      try {
        await update(channel, { enabled: next });
        toast.success(next ? "Channel turned on" : "Channel turned off");
        refetch();
      } catch (err) {
        toast.error(saveErrorMessage(err, "channel"));
      }
    },
    [update, channel, refetch],
  );

  const name = meta?.name || meta?.slug || "\u2014";

  return (
    <ChannelCardFrame
      Icon={provider.Icon}
      typeLabel={provider.label}
      name={name}
      state={<InstallStatePill state={installState} />}
      details={
        <>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
            {presentation.describeChannel(channel)}
          </p>
          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground-faint">
            {presentation.servingLine(servingAppName)}
          </p>
        </>
      }
      controls={
        <>
          {canEdit && installState === ChannelInstallState.installed && (
            <Switch
              checked={enabled}
              onCheckedChange={(next) => void handleToggleEnabled(next)}
              disabled={isPending}
              aria-label={`Turn ${meta?.name || meta?.slug || "channel"} ${enabled ? "off" : "on"}`}
            />
          )}
          {canEdit &&
            connectAvailable &&
            installState !== ChannelInstallState.installed && (
              <Button variant="outline" size="xs" onClick={onConnectClick}>
                {installState === ChannelInstallState.revoked
                  ? "Reconnect"
                  : "Connect"}
              </Button>
            )}
          {/* The menu always renders: everyone who can see the card holds
              can_view on the channel (the FGA-filtered list), which is
              exactly the bar for viewing its conversations. */}
          <ActionMenu>
            <ActionMenu.Trigger
              aria-label={`Actions for ${meta?.name || meta?.slug}`}
            >
              <MoreHorizontal className="stg:size-4" />
            </ActionMenu.Trigger>
            <ActionMenu.Content>
              <ActionMenu.Item
                icon={<MessageSquare />}
                onSelect={onViewConversations}
                /* "Sessions", deliberately not "Conversations": this
                   dialog is the session-level forensics view (which
                   sessions served a conversation). The word
                   Conversations belongs to the top-level customer
                   surface. */
                data-cursor-target="channel-conversations"
              >
                Sessions
              </ActionMenu.Item>
              {access.action && (
                <ActionMenu.Item icon={<Share2 />} onSelect={access.open}>
                  Manage access
                </ActionMenu.Item>
              )}
              {/* Gated on the bar the server enforces for listTemplates
                  (ChannelMessagingReach: can_edit), and on the provider
                  declaring a template registry at all — hidden, not
                  disabled, for providers with no template concept. */}
              {canEdit && provider.supportsMessageTemplates && (
                <ActionMenu.Item
                  icon={<LayoutTemplate />}
                  onSelect={onViewTemplates}
                  data-cursor-target="channel-templates"
                >
                  Templates
                </ActionMenu.Item>
              )}
              {canEdit && (
                <ActionMenu.Item
                  icon={<SlidersHorizontal />}
                  onSelect={onEditRunConfig}
                  data-cursor-target="channel-run-config"
                >
                  Run settings
                </ActionMenu.Item>
              )}
              {canEdit && (
                <ActionMenu.Item
                  icon={<KeyRound />}
                  onSelect={onEditCredentials}
                >
                  Tool credentials
                </ActionMenu.Item>
              )}
              {canEdit && (
                <ActionMenu.Item
                  icon={<FileCode2 />}
                  onSelect={onEditYaml}
                >
                  Edit YAML
                </ActionMenu.Item>
              )}
              {canDelete && (
                <ActionMenu.Item
                  icon={<Trash2 />}
                  variant="destructive"
                  onSelect={onDeleteClick}
                >
                  Disconnect
                </ActionMenu.Item>
              )}
            </ActionMenu.Content>
          </ActionMenu>
        </>
      }
    >
      <CardReadinessWarning
        agent={agent}
        channel={channel}
        canEdit={canEdit}
        onEditCredentials={onEditCredentials}
      />
      {access.dialog}
    </ChannelCardFrame>
  );
}

/**
 * Serving-readiness warning for tool-using agents: channel runs
 * receive credentials only from the channel's own bindings, so an
 * installed, enabled channel with none (or with a private binding) will
 * refuse the first workspace message that needs a tool. The card is
 * where an owner — including one who connected before credential
 * binding existed — discovers the gap, instead of hearing about it from
 * a confused workspace member.
 */
function CardReadinessWarning({
  agent,
  channel,
  canEdit,
  onEditCredentials,
}: {
  readonly agent: Agent;
  readonly channel: Channel;
  readonly canEdit: boolean;
  readonly onEditCredentials: () => void;
}) {
  const serving =
    (channel.spec?.enabled ?? false) &&
    installStateOf(channel) === ChannelInstallState.installed;
  const readiness = useChannelToolReadiness(
    agent,
    serving,
    channel.spec?.vaults ?? [],
  );

  if (readiness.status !== "needs-credentials" && readiness.status !== "blocked") {
    return null;
  }

  const message =
    readiness.status === "needs-credentials"
      ? "This agent uses tools, but this channel names no vault — workspace messages that need a tool will be refused."
      : `Vault${readiness.unusableVaults.length > 1 ? "s" : ""} ${readiness.unusableVaults.join(", ")} ${readiness.unusableVaults.length > 1 ? "are" : "is"} not a shared vault you can read — name a shared vault so workspace messages can use its keys.`;

  return (
    <p className="stg:mt-2 stg:text-xs stg:text-status-degraded" role="status">
      {message}
      {canEdit && (
        <>
          {" "}
          <button
            type="button"
            onClick={onEditCredentials}
            className={cn(
              "stg:font-medium stg:underline stg:underline-offset-2",
              "stg:hover:text-foreground",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring stg:rounded",
            )}
          >
            Bind credentials
          </button>
        </>
      )}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Install-state rendering
// ---------------------------------------------------------------------------

/** A channel's observed install state, unspecified when the server set none. */
export function installStateOf(channel: Channel): ChannelInstallState {
  return (
    channel.status?.installState ??
    ChannelInstallState.channel_install_state_unspecified
  );
}

function InstallStatePill({ state }: { readonly state: ChannelInstallState }) {
  switch (state) {
    case ChannelInstallState.installed:
      return <ChannelStatePill label="Installed" tone="success" />;
    case ChannelInstallState.revoked:
      return <ChannelStatePill label="Revoked" tone="destructive" />;
    default:
      return <ChannelStatePill label="Pending install" tone="muted" />;
  }
}
