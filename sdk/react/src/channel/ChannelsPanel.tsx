"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@stigmer/theme";
import { chatPath, getUserMessage } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/status_pb";
import { toast } from "../feedback/toast.js";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../internal/menu.js";
import { useChannelAppList } from "../channel-app/useChannelAppList.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { EditResourceYamlDialog } from "../manifest/EditResourceYamlDialog.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { ChatLinkDialog } from "../chat-link/ChatLinkDialog.js";
import { ChannelConversationsDialog } from "./ChannelConversationsDialog.js";
import { ChannelCredentialsDialog } from "./ChannelCredentialsDialog.js";
import { ChannelRunConfigDialog } from "./ChannelRunConfigDialog.js";
import { ChannelTemplatesDialog } from "./ChannelTemplatesDialog.js";
import { ChatLinkCard } from "./ChatLinkCard.js";
import { ConnectSlackDialog } from "./ConnectSlackDialog.js";
import { ConnectWhatsAppDialog } from "./ConnectWhatsAppDialog.js";
import { CHANNEL_TYPES } from "./channelTypes.js";
import {
  CHANNEL_PROVIDERS,
  channelInstallsAvailable,
  channelProviderOf,
  type ChannelProviderDescriptor,
} from "./providers.js";
import {
  channelPresentationOf,
  DEFAULT_CHANNEL_PRESENTATION,
} from "./providerPresentation.js";
import {
  useAddChannelOptions,
  type AddChannelOption,
} from "./useAddChannelOptions.js";
import { useChannelList } from "./useChannelList.js";
import { useDeleteChannel } from "./useDeleteChannel.js";
import { installStateOf, VendorChannelCard } from "./VendorChannelCard.js";

/** Props for {@link ChannelsPanel}. */
export interface ChannelsPanelProps {
  /** The agent whose channels are managed. */
  readonly agent: Agent;
  /**
   * Builds the absolute public chat URL for a chat link from its channel
   * id (`metadata.id`, the one identity a link carries). The host owns
   * URL construction: its configured public origin may differ from the
   * rendering origin (e.g. the desktop app). When omitted, links fall back
   * to the relative `/chat/<channel id>`.
   */
  readonly buildChatLinkUrl?: (channelId: string) => string;
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
  readonly onConnectExternal?: (channel: Channel | null) => void;
  /**
   * Where the host manages Channel Apps (the console passes
   * `/settings/channel-apps`). Threaded to the connect dialog's
   * "Register a channel app" affordance; absent, the affordance
   * degrades to plain guidance text.
   */
  readonly channelAppsHref?: string;
  /**
   * Maps a session id to the host's session route (the console passes
   * `` (id) => `/sessions/${id}` ``). Threaded to each vendor card's
   * Sessions dialog so rows link to the read-only transcript; absent, the
   * rows render without links (the SDK never assumes a routing scheme).
   */
  readonly sessionHref?: (sessionId: string) => string;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Every channel of an agent in one list — its chat links, Slack
 * workspaces and WhatsApp numbers — rendered as the agent detail view's
 * Channels tab.
 *
 * One card per channel, in the frame every type shares: the type's mark
 * and label, the channel's name, its state, its on/off switch where it can
 * serve, and its menu. A chat link ({@link ChatLinkCard}) shows its link,
 * audience and Active/Paused; a Slack or WhatsApp channel
 * ({@link VendorChannelCard}) shows its install state and serving app, and
 * serves only when installed and on.
 *
 * Adding runs through one affordance for every type
 * ({@link useAddChannelOptions}): with channels listed, one "Add channel"
 * menu; on an empty tab, one visible button per type, where a newcomer
 * chooses. A chat link opens the chat-link dialog ({@link ChatLinkDialog});
 * Slack and WhatsApp open their connect dialogs. Vendor installs need
 * Stigmer Cloud ({@link channelInstallsAvailable}); elsewhere those options
 * say so, and a notice explains only when the list holds a vendor channel
 * this edition cannot connect. Channels always live in the agent's own
 * org, so no org selector is needed.
 *
 * Self-contained: owns its dialogs, its confirmation prompts, and its
 * refetch-after-mutation — hosts render it with the agent plus their
 * routing seams.
 *
 * This is an SDK component — embeddable by platform builders.
 */
export function ChannelsPanel({
  agent,
  buildChatLinkUrl,
  onConnectExternal,
  channelAppsHref,
  sessionHref,
  className,
}: ChannelsPanelProps) {
  const agentId = agent.metadata?.id ?? "";
  // Channels are same-org by invariant; scope the list to the agent's org.
  const { channels, isLoading, error, refetch } = useChannelList(
    agentId,
    agent.metadata?.org ?? "",
  );

  // One fetch for all vendor cards: a channel's spec.app_ref carries only
  // the slug, but the app's name is the bot name members @mention — the
  // label worth showing.
  const { channelApps } = useChannelAppList(agent.metadata?.org || null);

  // The add bar, per type: the server's create bar, the edition, and the
  // host's hand-off for redirect-style installs.
  const { canAdd, options: addOptions } = useAddChannelOptions(agent, {
    onConnectExternal,
  });
  const installsAvailable = channelInstallsAvailable(useDeploymentMode());

  const { deleteChannel } = useDeleteChannel();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();

  // One chat-link dialog mount serves both flows: creating a new link, or
  // editing the chosen one.
  const [chatLinkEditor, setChatLinkEditor] = useState<
    | { readonly mode: "create" }
    | { readonly mode: "edit"; readonly channel: Channel }
    | null
  >(null);

  // One connect dialog mount serves both vendor flows: connecting the
  // chosen channel, or creating a new one and connecting it in the same
  // session. The provider picks which dialog renders.
  const [connecting, setConnecting] = useState<
    | { readonly mode: "create"; readonly provider: ChannelProviderDescriptor }
    | { readonly mode: "reconnect"; readonly channel: Channel }
    | null
  >(null);

  // The channel whose tool-credential bindings are being edited.
  const [editingCredentials, setEditingCredentials] =
    useState<Channel | null>(null);

  // The channel whose conversations are being viewed (read-only
  // channel-session observability for the channel's viewers).
  const [viewingConversations, setViewingConversations] =
    useState<Channel | null>(null);

  // The channel whose provider message templates are being viewed (the
  // business-messaging diagnosis surface).
  const [viewingTemplates, setViewingTemplates] =
    useState<Channel | null>(null);

  // The channel being edited as YAML (the kind-agnostic manifest flow).
  const [editingYaml, setEditingYaml] = useState<Channel | null>(null);
  const [editingRunConfig, setEditingRunConfig] = useState<Channel | null>(null);

  const handleConnect = useCallback(
    (channel: Channel | null, provider: ChannelProviderDescriptor) => {
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

  const handleAdd = useCallback(
    (option: AddChannelOption) => {
      const provider = option.type.provider;
      if (provider === null) {
        setChatLinkEditor({ mode: "create" });
        return;
      }
      handleConnect(null, provider);
    },
    [handleConnect],
  );

  const handleDelete = useCallback(
    async (channel: Channel) => {
      const name = channel.metadata?.name || channel.metadata?.slug || "this channel";
      const isChatLink = channel.spec?.type?.case === "web";
      const confirmed = await confirm(
        isChatLink
          ? {
              title: "Delete chat link?",
              description:
                `The link ${chatPath(channel.metadata?.id ?? "")} stops working ` +
                "immediately — including for visitors mid-conversation — and its " +
                "configuration (origins, messages, credential bindings) is gone. " +
                "To stop serving while keeping the configuration, turn it off instead.",
              confirmLabel: "Delete",
              variant: "destructive",
            }
          : {
              title: "Disconnect channel?",
              description: (
                channelPresentationOf(channel.spec?.type?.case) ??
                DEFAULT_CHANNEL_PRESENTATION
              ).disconnectDescription(name),
              confirmLabel: "Disconnect",
              variant: "destructive",
            },
      );
      if (!confirmed) return;
      try {
        await deleteChannel(channel.metadata?.id ?? "");
        toast.success(isChatLink ? "Chat link deleted" : "Channel disconnected");
        refetch();
      } catch (err) {
        toast.error(getUserMessage(err));
      }
    },
    [confirm, deleteChannel, refetch],
  );

  // Whether a vendor card's Connect/Reconnect is actionable here: installs
  // need the hosted runtime, but redirect-style providers can still hand
  // off to the host (the desktop → system-browser path).
  const connectAvailableFor = useCallback(
    (provider: ChannelProviderDescriptor) =>
      installsAvailable ||
      (provider.installStyle === "redirect" && !!onConnectExternal),
    [installsAvailable, onConnectExternal],
  );

  // The notice explains only what the list shows: a vendor channel this
  // edition cannot connect. A tab of chat links carries no banner about
  // features it isn't using.
  const showCloudNotice = useMemo(
    () =>
      channels.some((c) => {
        const typeCase = c.spec?.type?.case;
        if (typeCase === "web") return false;
        const provider = channelProviderOf(typeCase) ?? CHANNEL_PROVIDERS[0];
        return (
          installStateOf(c) !== ChannelInstallState.installed &&
          !connectAvailableFor(provider)
        );
      }),
    [channels, connectAvailableFor],
  );

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="stg:py-8 stg:text-center stg:text-sm stg:text-destructive">
        Failed to load channels
      </div>
    );
  }

  // The provider of the in-flight connect flow: chosen by the user in
  // create mode, the channel's own on a reconnect. Unknown cases (a
  // newer server) fall back to the default provider, matching the card.
  const connectingProvider =
    connecting === null
      ? null
      : connecting.mode === "create"
        ? connecting.provider
        : channelProviderOf(connecting.channel.spec?.type?.case) ??
          CHANNEL_PROVIDERS[0];

  return (
    <div className={cn("stg:space-y-3", className)}>
      {showCloudNotice && (
        <CloudFeatureNotice>
          Channel installs require Stigmer Cloud — connecting an agent to
          Slack or WhatsApp runs through the platform&apos;s hosted webhook
          infrastructure. Channel configuration still works here.
        </CloudFeatureNotice>
      )}

      {channels.length === 0 ? (
        <ChannelEmptyState
          options={canAdd ? addOptions : []}
          onAddClick={handleAdd}
        />
      ) : (
        <>
          <div className="stg:flex stg:items-center stg:justify-between stg:gap-2">
            <h3 className="stg:text-sm stg:font-medium stg:text-foreground">
              {channels.length} {channels.length === 1 ? "channel" : "channels"}
            </h3>
            {canAdd && <AddChannelMenu options={addOptions} onAddClick={handleAdd} />}
          </div>

          <div className="stg:space-y-2">
            {channels.map((channel) => {
              if (channel.spec?.type?.case === "web") {
                return (
                  <ChatLinkCard
                    key={channel.metadata?.id}
                    channel={channel}
                    buildChatLinkUrl={buildChatLinkUrl}
                    onEditClick={() => setChatLinkEditor({ mode: "edit", channel })}
                    onDeleteClick={() => void handleDelete(channel)}
                    refetch={refetch}
                  />
                );
              }
              // A type this UI does not know yet (a newer server) renders
              // on the default provider's card rather than not at all.
              const cardProvider =
                channelProviderOf(channel.spec?.type?.case) ??
                CHANNEL_PROVIDERS[0];
              return (
                <VendorChannelCard
                  key={channel.metadata?.id}
                  agent={agent}
                  channel={channel}
                  channelApps={channelApps}
                  connectAvailable={connectAvailableFor(cardProvider)}
                  onConnectClick={() => handleConnect(channel, cardProvider)}
                  onDeleteClick={() => void handleDelete(channel)}
                  onEditCredentials={() => setEditingCredentials(channel)}
                  onViewConversations={() => setViewingConversations(channel)}
                  onViewTemplates={() => setViewingTemplates(channel)}
                  onEditYaml={() => setEditingYaml(channel)}
                  onEditRunConfig={() => setEditingRunConfig(channel)}
                  refetch={refetch}
                />
              );
            })}
          </div>
        </>
      )}

      {chatLinkEditor && (
        <ChatLinkDialog
          open
          onOpenChange={(open) => {
            if (!open) setChatLinkEditor(null);
          }}
          agent={agent}
          channel={chatLinkEditor.mode === "edit" ? chatLinkEditor.channel : undefined}
          buildChatLinkUrl={buildChatLinkUrl}
          onChannelsChanged={refetch}
        />
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

      {viewingTemplates && (
        <ChannelTemplatesDialog
          open
          onOpenChange={(open) => {
            if (!open) setViewingTemplates(null);
          }}
          channel={viewingTemplates}
          // The dialog's not-proactive teaching state routes to the
          // panel's own YAML editor — the one place the grant can be
          // set today.
          onEditYaml={() => {
            const channel = viewingTemplates;
            setViewingTemplates(null);
            setEditingYaml(channel);
          }}
        />
      )}

      {editingYaml && (
        <EditResourceYamlDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingYaml(null);
          }}
          resource={editingYaml}
          onApplied={refetch}
        />
      )}

      {editingRunConfig && (
        <ChannelRunConfigDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditingRunConfig(null);
          }}
          channel={editingRunConfig}
          onSaved={refetch}
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
// Adding a channel
// ---------------------------------------------------------------------------

/**
 * The heading's "Add channel" menu: one item per type, each with the
 * stable cursor target its empty-state button carries. A type this viewer
 * cannot add here stays listed, disabled, with the reason beneath it, so
 * the menu says what exists and why it is out of reach.
 */
function AddChannelMenu({
  options,
  onAddClick,
}: {
  readonly options: readonly AddChannelOption[];
  readonly onAddClick: (option: AddChannelOption) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            icon={<Plus className="stg:size-3" />}
            data-cursor-target="add-channel"
          />
        }
      >
        Add channel
        <ChevronDown className="stg:size-3" aria-hidden="true" />
      </MenuTrigger>
      <MenuContent align="end" className="stg:w-auto stg:min-w-56">
        {options.map((option) => (
          <MenuItem
            key={option.type.id}
            disabled={!option.available}
            onClick={() => onAddClick(option)}
            data-cursor-target={option.type.addCursorTarget}
            className="stg:items-start"
          >
            <option.type.Icon className="stg:mt-0.5 stg:size-4" />
            <span className="stg:flex stg:flex-col">
              <span>{option.type.label}</span>
              {option.reason && (
                <span className="stg:text-xs stg:text-muted-foreground">
                  {option.reason}
                </span>
              )}
            </span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

// ---------------------------------------------------------------------------
// Empty + loading states
// ---------------------------------------------------------------------------

function ChannelEmptyState({
  options,
  onAddClick,
}: {
  /** Every type with its availability; empty when the viewer may add none. */
  readonly options: readonly AddChannelOption[];
  readonly onAddClick: (option: AddChannelOption) => void;
}) {
  const available = options.filter((o) => o.available);
  // Unavailable types are named in one sentence per reason, never as
  // disabled buttons: a newcomer reads what exists and what it needs.
  const unavailableNotes = [
    ...new Set(options.filter((o) => !o.available).map((o) => o.reason)),
  ].map((reason) => {
    const labels = options
      .filter((o) => !o.available && o.reason === reason)
      .map((o) => o.type.label);
    // "Needs Stigmer Cloud" reads as "Slack and WhatsApp need Stigmer Cloud."
    const verb = labels.length > 1 ? "need " : "needs ";
    return `${labels.join(" and ")} ${(reason ?? "").replace(/^Needs /, verb)}.`;
  });
  return (
    <EmptyState
      variant="first-use"
      icon={
        <span className="stg:flex stg:items-center stg:gap-2">
          {CHANNEL_TYPES.map((t) => (
            <t.Icon key={t.id} className="stg:size-10" />
          ))}
        </span>
      }
      title="No channels yet"
      description={
        "Give this agent a chat link to send or embed, or connect it to " +
        "Slack or WhatsApp so people chat with it right where they work — " +
        "with policy, rate limits, and billing enforced by Stigmer."
      }
    >
      {/* Rendered via the children slot (not `action`) so each button can
          carry its docs-demo cursor target, which EmptyState's action
          config does not thread through. One visible button per type: an
          empty tab is where a newcomer chooses. */}
      {available.length > 0 && (
        <span className="stg:flex stg:flex-wrap stg:items-center stg:justify-center stg:gap-2">
          {available.map((o) => (
            <Button
              key={o.type.id}
              variant="primary"
              icon={<o.type.Icon className="stg:size-3" />}
              onClick={() => onAddClick(o)}
              data-cursor-target={o.type.addCursorTarget}
            >
              {o.type.addLabel}
            </Button>
          ))}
        </span>
      )}
      {unavailableNotes.length > 0 && available.length > 0 && (
        <span className="stg:mt-2 stg:block stg:text-xs stg:text-muted-foreground">
          {unavailableNotes.join(" ")}
        </span>
      )}
    </EmptyState>
  );
}

function LoadingSkeleton() {
  return (
    <div className="stg:space-y-2 stg:py-4">
      {[1, 2].map((i) => (
        <div key={i} className="stg:h-20 stg:animate-pulse stg:rounded-lg stg:bg-muted-faint" />
      ))}
    </div>
  );
}
