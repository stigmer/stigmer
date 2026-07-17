"use client";

import { useCallback, useState } from "react";
import { KeyRound, MessageSquare, MoreHorizontal, Trash2 } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { toast } from "../feedback/toast.js";
import { ActionMenu } from "../action-menu/index.js";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { Switch } from "../switch/Switch.js";
import { useChannelAppList } from "../channel-app/useChannelAppList.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { ChannelConversationsDialog } from "./ChannelConversationsDialog.js";
import { ChannelCredentialsDialog } from "./ChannelCredentialsDialog.js";
import { ConnectSlackDialog } from "./ConnectSlackDialog.js";
import { ConnectWhatsAppDialog } from "./ConnectWhatsAppDialog.js";
import {
  CHANNEL_PROVIDERS,
  channelProviderOf,
  type ChannelProviderDescriptor,
} from "./providers.js";
import {
  channelPresentationOf,
  DEFAULT_CHANNEL_PRESENTATION,
} from "./providerPresentation.js";
import { useAgentChannelList } from "./useAgentChannelList.js";
import { useChannelToolReadiness } from "./useChannelToolReadiness.js";
import { useDeleteAgentChannel } from "./useDeleteAgentChannel.js";
import { agentChannelToInput, useSaveAgentChannel } from "./useSaveAgentChannel.js";

/** Props for {@link AgentChannelsPanel}. */
export interface AgentChannelsPanelProps {
  /** The agent whose channels are managed. */
  readonly agent: Agent;
  /**
   * When provided, connect actions for redirect-style providers (Slack)
   * delegate to the host instead of running the in-app popup flow. For
   * hosts whose webview cannot open popups (the desktop app): the
   * delegate typically opens the web console in the system browser.
   * Called with the channel being (re)connected, or `null` for a
   * brand-new connection. Direct-install providers (WhatsApp) always
   * connect in-app — their flow is a plain API call with nothing for a
   * popup to do — so they never invoke the delegate.
   */
  readonly onConnectExternal?: (channel: AgentChannel | null) => void;
  /**
   * Where the host manages Channel Apps (the console passes
   * `/settings/channel-apps`). Threaded to the connect dialog's
   * "Register a channel app" affordance; absent, the affordance
   * degrades to plain guidance text.
   */
  readonly channelAppsHref?: string;
  /**
   * Maps a session id to the host's session route (the console passes
   * `` (id) => `/sessions/${id}` ``). Threaded to each card's
   * Conversations dialog so rows link to the read-only transcript;
   * absent, the rows render without links (DD-004 — the SDK never
   * assumes a routing scheme).
   */
  readonly sessionHref?: (sessionId: string) => string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Management surface for an agent's {@link AgentChannel} connections —
 * rendered in the agent detail view's Channels tab.
 *
 * One card per channel showing the two serving axes side by side: the
 * observed provider install state (`pending_install` / `installed` /
 * `revoked`) and the owner's serving switch (`spec.enabled`). Traffic
 * flows only when installed AND enabled. Channels always live in the
 * agent's own org (no cross-org arm, unlike shares), so no org selector
 * is needed.
 *
 * Connecting runs the provider's own dialog — {@link ConnectSlackDialog}
 * (OAuth popup) or {@link ConnectWhatsAppDialog} (direct install). On a
 * `local` (OSS) backend, channel CRUD works but installs are cloud-only —
 * connect affordances are replaced by a cloud-feature notice, matching
 * the server's FAILED_PRECONDITION posture.
 *
 * Self-contained: owns its dialog, its confirmation prompts, and its
 * refetch-after-mutation — hosts render it with just the agent (plus the
 * external-connect delegate where popups are unavailable).
 *
 * This is an SDK component (DD-001) — embeddable by platform builders.
 */
export function AgentChannelsPanel({
  agent,
  onConnectExternal,
  channelAppsHref,
  sessionHref,
  className,
}: AgentChannelsPanelProps) {
  const agentId = agent.metadata?.id ?? "";
  // Channels are same-org by invariant; scope the list to the agent's org.
  const { channels, isLoading, error, refetch } = useAgentChannelList(
    agentId,
    agent.metadata?.org ?? "",
  );

  // One fetch for all cards: a channel's spec.app_ref carries only the
  // slug, but the app's name is the bot name members @mention — the
  // label worth showing.
  const { channelApps } = useChannelAppList(agent.metadata?.org || null);

  // Mirrors the server's create bar (agent can_edit — the permission the
  // create/apply handlers enforce on the referenced agent) so the connect
  // affordance never appears to a viewer whose create would be refused.
  const { allowed: canCreate } = useCheckPermission(
    agentId ? { kind: "agent", id: agentId } : null,
    "can_edit",
  );

  // Installs are cloud-only; CRUD is not. In local mode the cards render
  // and toggles work, but connect affordances give way to the notice.
  const installsAvailable = useDeploymentMode() === "cloud";

  const { deleteChannel } = useDeleteAgentChannel();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();

  // One dialog mount serves both flows per provider: connecting the
  // chosen channel, or creating a new one and connecting it in the same
  // session. The provider picks which dialog renders.
  const [connecting, setConnecting] = useState<
    | { readonly mode: "create"; readonly provider: ChannelProviderDescriptor }
    | { readonly mode: "reconnect"; readonly channel: AgentChannel }
    | null
  >(null);

  // The channel whose tool-credential bindings are being edited.
  const [editingCredentials, setEditingCredentials] =
    useState<AgentChannel | null>(null);

  // The channel whose conversations are being viewed (DD-012: read-only
  // channel-session observability for the channel's viewers).
  const [viewingConversations, setViewingConversations] =
    useState<AgentChannel | null>(null);

  const handleConnect = useCallback(
    (channel: AgentChannel | null, provider: ChannelProviderDescriptor) => {
      // Only redirect-style installs need the host hand-off (they open a
      // popup the desktop webview cannot); direct installs are a plain
      // API call and run in-app everywhere.
      if (provider.installStyle === "redirect" && onConnectExternal) {
        onConnectExternal(channel);
        return;
      }
      setConnecting(
        channel ? { mode: "reconnect", channel } : { mode: "create", provider },
      );
    },
    [onConnectExternal],
  );

  const handleDelete = useCallback(
    async (channel: AgentChannel) => {
      const name = channel.metadata?.name || channel.metadata?.slug || "this channel";
      const presentation =
        channelPresentationOf(channel.spec?.providerConfig?.case) ??
        DEFAULT_CHANNEL_PRESENTATION;
      const confirmed = await confirm({
        title: "Disconnect channel?",
        description: presentation.disconnectDescription(name),
        confirmLabel: "Disconnect",
        variant: "destructive",
      });
      if (!confirmed) return;
      try {
        await deleteChannel(channel.metadata?.id ?? "");
        toast.success("Channel disconnected");
        refetch();
      } catch (err) {
        toast.error(getUserMessage(err));
      }
    },
    [confirm, deleteChannel, refetch],
  );

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-destructive">
        Failed to load channels
      </div>
    );
  }

  const showCloudNotice =
    !installsAvailable &&
    (channels.length === 0 ||
      channels.some(
        (c) => installStateOf(c) !== AgentChannelInstallState.installed,
      ));

  // Whether a provider's connect affordance is actionable here: installs
  // are cloud-only, but redirect-style providers can still hand off to
  // the host (the desktop → system-browser path). Direct-style providers
  // have no hand-off — in local mode their affordance yields to the
  // cloud notice.
  const canConnectVia = (p: ChannelProviderDescriptor) =>
    canCreate &&
    (installsAvailable || (p.installStyle === "redirect" && !!onConnectExternal));
  const connectableProviders = CHANNEL_PROVIDERS.filter(canConnectVia);

  // The provider of the in-flight connect flow: chosen by the user in
  // create mode, the channel's own on a reconnect. Unknown cases (a
  // newer server) fall back to the default provider, matching the card.
  const connectingProvider =
    connecting === null
      ? null
      : connecting.mode === "create"
        ? connecting.provider
        : channelProviderOf(connecting.channel.spec?.providerConfig?.case) ??
          CHANNEL_PROVIDERS[0];

  return (
    <div className={cn("space-y-3", className)}>
      {showCloudNotice && (
        <CloudFeatureNotice>
          Channel installs require Stigmer Cloud — connecting an agent to
          Slack or WhatsApp runs through the platform&apos;s hosted webhook
          infrastructure. Channel configuration still works here.
        </CloudFeatureNotice>
      )}

      {channels.length === 0 ? (
        <ChannelEmptyState
          providers={connectableProviders}
          onConnectClick={(p) => handleConnect(null, p)}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-foreground">
              {channels.length} {channels.length === 1 ? "channel" : "channels"}
            </h3>
            {/* One visible button per provider — deliberately not a
                dropdown: two options are clearer side by side, and each
                keeps its own stable cursor target (see providers.ts). */}
            {connectableProviders.length > 0 && (
              <div className="flex shrink-0 items-center gap-2">
                {connectableProviders.map((p) => (
                  <Button
                    key={p.id}
                    variant="outline"
                    size="xs"
                    icon={<p.Icon className="size-3" />}
                    onClick={() => handleConnect(null, p)}
                    data-cursor-target={`connect-${p.id}`}
                  >
                    Connect to {p.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {channels.map((channel) => {
              const cardProvider =
                channelProviderOf(channel.spec?.providerConfig?.case) ??
                CHANNEL_PROVIDERS[0];
              return (
                <ChannelCard
                  key={channel.metadata?.id}
                  agent={agent}
                  channel={channel}
                  channelApps={channelApps}
                  connectAvailable={
                    installsAvailable ||
                    (cardProvider.installStyle === "redirect" &&
                      !!onConnectExternal)
                  }
                  onConnectClick={() => handleConnect(channel, cardProvider)}
                  onDeleteClick={() => void handleDelete(channel)}
                  onEditCredentials={() => setEditingCredentials(channel)}
                  onViewConversations={() => setViewingConversations(channel)}
                  refetch={refetch}
                />
              );
            })}
          </div>
        </>
      )}

      {connecting && connectingProvider?.id === "whatsapp" ? (
        <ConnectWhatsAppDialog
          open
          onOpenChange={(open) => {
            if (!open) setConnecting(null);
          }}
          agent={agent}
          channel={connecting.mode === "reconnect" ? connecting.channel : undefined}
          onChannelsChanged={refetch}
          channelAppsHref={channelAppsHref}
        />
      ) : connecting ? (
        <ConnectSlackDialog
          open
          onOpenChange={(open) => {
            if (!open) setConnecting(null);
          }}
          agent={agent}
          channel={connecting.mode === "reconnect" ? connecting.channel : undefined}
          onChannelsChanged={refetch}
          channelAppsHref={channelAppsHref}
        />
      ) : null}

      {editingCredentials && (
        <ChannelCredentialsDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingCredentials(null);
          }}
          agent={agent}
          channel={editingCredentials}
          onSaved={refetch}
        />
      )}

      {viewingConversations && (
        <ChannelConversationsDialog
          open
          onOpenChange={(open) => {
            if (!open) setViewingConversations(null);
          }}
          channel={viewingConversations}
          sessionHref={sessionHref}
        />
      )}

      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card — one provider connection
// ---------------------------------------------------------------------------

interface ChannelCardProps {
  readonly agent: Agent;
  readonly channel: AgentChannel;
  readonly channelApps: readonly ChannelApp[];
  /** Whether the card's Connect/Reconnect affordance is actionable here. */
  readonly connectAvailable: boolean;
  readonly onConnectClick: () => void;
  readonly onDeleteClick: () => void;
  readonly onEditCredentials: () => void;
  readonly onViewConversations: () => void;
  readonly refetch: () => void;
}

function ChannelCard({
  agent,
  channel,
  channelApps,
  connectAvailable,
  onConnectClick,
  onDeleteClick,
  onEditCredentials,
  onViewConversations,
  refetch,
}: ChannelCardProps) {
  const meta = channel.metadata;
  const id = meta?.id ?? "";
  const enabled = channel.spec?.enabled ?? false;
  const installState = installStateOf(channel);
  // The serving app (T04 item 2): set means the channel installs through
  // the org's own channel app; absent means the platform Stigmer app
  // (Slack only — WhatsApp always has one, DD-WA-2). The app's NAME is
  // the identity people address, so prefer it over the ref's slug when
  // the app is in the fetched list (it may not be — e.g. the app was
  // deleted after install).
  const servingAppSlug = channel.spec?.appRef?.slug || null;
  const servingAppName = servingAppSlug
    ? channelApps.find((app) => app.metadata?.slug === servingAppSlug)
        ?.metadata?.name || servingAppSlug
    : null;

  // The spec's provider marker is set at create; unknown cases (a newer
  // server) fall back to the default provider mark rather than no icon,
  // and to the default presentation rather than no copy.
  const provider =
    channelProviderOf(channel.spec?.providerConfig?.case) ?? CHANNEL_PROVIDERS[0];
  const presentation =
    channelPresentationOf(channel.spec?.providerConfig?.case) ??
    DEFAULT_CHANNEL_PRESENTATION;

  const { save, isPending } = useSaveAgentChannel();

  // Decide the card's actions here (not via nested permission wrappers) so
  // affordances are hidden entirely when the viewer can do nothing —
  // permissive in OSS, so local single-user sees all.
  const { allowed: canEdit } = useCheckPermission(
    { kind: "agent_channel", id },
    "can_edit",
  );
  const { allowed: canDelete } = useCheckPermission(
    { kind: "agent_channel", id },
    "can_delete",
  );

  // On/off is a full-input save with only `enabled` flipped —
  // agentChannelToInput guarantees the toggle can never wipe the agent
  // reference or the provider marker (the fails-closed posture shares use).
  const handleToggleEnabled = useCallback(
    async (next: boolean) => {
      try {
        await save({ ...agentChannelToInput(channel), enabled: next });
        toast.success(next ? "Channel turned on" : "Channel turned off");
        refetch();
      } catch (err) {
        toast.error(getUserMessage(err));
      }
    },
    [save, channel, refetch],
  );

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <provider.Icon className="size-5 shrink-0 text-foreground" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="truncate text-sm font-medium text-foreground"
                title={meta?.name || meta?.slug || undefined}
              >
                {meta?.name || meta?.slug || "\u2014"}
              </span>
              <InstallStatePill state={installState} />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {presentation.describeChannel(channel)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground-faint">
              {presentation.servingLine(servingAppName)}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {canEdit && installState === AgentChannelInstallState.installed && (
            <Switch
              checked={enabled}
              onCheckedChange={(next) => void handleToggleEnabled(next)}
              disabled={isPending}
              aria-label={`Turn ${meta?.name || meta?.slug || "channel"} ${enabled ? "off" : "on"}`}
            />
          )}
          {canEdit &&
            connectAvailable &&
            installState !== AgentChannelInstallState.installed && (
              <Button variant="outline" size="xs" onClick={onConnectClick}>
                {installState === AgentChannelInstallState.revoked
                  ? "Reconnect"
                  : "Connect"}
              </Button>
            )}
          {/* The menu always renders: everyone who can see the card holds
              can_view on the channel (the FGA-filtered list), which is
              exactly the bar for viewing its conversations (DD-012). */}
          <ActionMenu>
            <ActionMenu.Trigger
              aria-label={`Actions for ${meta?.name || meta?.slug}`}
            >
              <MoreHorizontal className="size-4" />
            </ActionMenu.Trigger>
            <ActionMenu.Content>
              <ActionMenu.Item
                icon={<MessageSquare />}
                onSelect={onViewConversations}
                data-cursor-target="channel-conversations"
              >
                Conversations
              </ActionMenu.Item>
              {canEdit && (
                <ActionMenu.Item
                  icon={<KeyRound />}
                  onSelect={onEditCredentials}
                >
                  Tool credentials
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
        </div>
      </div>

      <CardReadinessWarning
        agent={agent}
        channel={channel}
        canEdit={canEdit}
        onEditCredentials={onEditCredentials}
      />
    </div>
  );
}

/**
 * Serving-readiness warning for tool-using agents: channel executions
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
  readonly channel: AgentChannel;
  readonly canEdit: boolean;
  readonly onEditCredentials: () => void;
}) {
  const serving =
    (channel.spec?.enabled ?? false) &&
    installStateOf(channel) === AgentChannelInstallState.installed;
  const readiness = useChannelToolReadiness(
    agent,
    serving,
    channel.spec?.environmentRefs ?? [],
  );

  if (readiness.status !== "needs-credentials" && readiness.status !== "blocked") {
    return null;
  }

  const message =
    readiness.status === "needs-credentials"
      ? "This agent uses tools, but no credentials are bound to this channel — workspace messages that need a tool will be refused."
      : `Bound environment${readiness.privateEnvironments.length > 1 ? "s" : ""} ${readiness.privateEnvironments.join(", ")} ${readiness.privateEnvironments.length > 1 ? "are" : "is"} private — share ${readiness.privateEnvironments.length > 1 ? "them" : "it"} with your organization so workspace messages can use the credentials.`;

  return (
    <p className="mt-2 text-xs text-warning" role="status">
      {message}
      {canEdit && (
        <>
          {" "}
          <button
            type="button"
            onClick={onEditCredentials}
            className={cn(
              "font-medium underline underline-offset-2",
              "hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
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

function installStateOf(channel: AgentChannel): AgentChannelInstallState {
  return (
    channel.status?.installState ??
    AgentChannelInstallState.agent_channel_install_state_unspecified
  );
}

function InstallStatePill({ state }: { readonly state: AgentChannelInstallState }) {
  const { label, tone } = (() => {
    switch (state) {
      case AgentChannelInstallState.installed:
        return { label: "Installed", tone: "text-success" };
      case AgentChannelInstallState.revoked:
        return { label: "Revoked", tone: "text-destructive" };
      default:
        return { label: "Pending install", tone: "text-muted-foreground" };
    }
  })();

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 text-xs",
        tone,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Empty + loading states
// ---------------------------------------------------------------------------

function ChannelEmptyState({
  providers,
  onConnectClick,
}: {
  /** The providers the viewer can connect through, in display order. */
  readonly providers: readonly ChannelProviderDescriptor[];
  readonly onConnectClick: (provider: ChannelProviderDescriptor) => void;
}) {
  const providerLabels = CHANNEL_PROVIDERS.map((p) => p.label).join(" or ");
  return (
    <EmptyState
      variant="first-use"
      icon={
        <span className="flex items-center gap-2">
          {CHANNEL_PROVIDERS.map((p) => (
            <p.Icon key={p.id} className="size-10" />
          ))}
        </span>
      }
      title="No channels yet"
      description={
        `Connect this agent to ${providerLabels} and people chat with it ` +
        "right where they work — with policy, rate limits, and billing " +
        "enforced by Stigmer."
      }
    >
      {/* Rendered via the children slot (not `action`) so each button can
          carry its docs-demo cursor target, which EmptyState's action
          config does not thread through. One visible button per provider
          — see providers.ts for why this is not a dropdown. */}
      {providers.length > 0 && (
        <span className="flex items-center gap-2">
          {providers.map((p) => (
            <Button
              key={p.id}
              variant="primary"
              icon={<p.Icon className="size-3" />}
              onClick={() => onConnectClick(p)}
              data-cursor-target={`connect-${p.id}`}
            >
              Connect to {p.label}
            </Button>
          ))}
        </span>
      )}
    </EmptyState>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 py-4">
      {[1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-muted-faint" />
      ))}
    </div>
  );
}
