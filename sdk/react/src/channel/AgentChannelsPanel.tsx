"use client";

import { useCallback, useState } from "react";
import { KeyRound, MoreHorizontal, Trash2 } from "lucide-react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { toast } from "../feedback/toast.js";
import { ActionMenu } from "../action-menu/index.js";
import { Button } from "../button/Button.js";
import { EmptyState } from "../empty-state/EmptyState.js";
import { Switch } from "../switch/Switch.js";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { ChannelCredentialsDialog } from "./ChannelCredentialsDialog.js";
import { ConnectSlackDialog } from "./ConnectSlackDialog.js";
import { SlackMarkIcon } from "./SlackMarkIcon.js";
import { useAgentChannelList } from "./useAgentChannelList.js";
import { useChannelToolReadiness } from "./useChannelToolReadiness.js";
import { useDeleteAgentChannel } from "./useDeleteAgentChannel.js";
import { agentChannelToInput, useSaveAgentChannel } from "./useSaveAgentChannel.js";

/** Props for {@link AgentChannelsPanel}. */
export interface AgentChannelsPanelProps {
  /** The agent whose channels are managed. */
  readonly agent: Agent;
  /**
   * When provided, connect actions delegate to the host instead of
   * running the in-app popup flow. For hosts whose webview cannot open
   * popups (the desktop app): the delegate typically opens the web
   * console in the system browser. Called with the channel being
   * (re)connected, or `null` for a brand-new connection.
   */
  readonly onConnectExternal?: (channel: AgentChannel | null) => void;
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
 * Connecting runs the {@link ConnectSlackDialog} popup flow. On a
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
  className,
}: AgentChannelsPanelProps) {
  const agentId = agent.metadata?.id ?? "";
  // Channels are same-org by invariant; scope the list to the agent's org.
  const { channels, isLoading, error, refetch } = useAgentChannelList(
    agentId,
    agent.metadata?.org ?? "",
  );

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

  // One dialog instance serves both flows: connecting the chosen channel,
  // or creating a new one and connecting it in the same session.
  const [connecting, setConnecting] = useState<
    | { readonly mode: "create" }
    | { readonly mode: "reconnect"; readonly channel: AgentChannel }
    | null
  >(null);

  // The channel whose tool-credential bindings are being edited.
  const [editingCredentials, setEditingCredentials] =
    useState<AgentChannel | null>(null);

  const handleConnect = useCallback(
    (channel: AgentChannel | null) => {
      if (onConnectExternal) {
        onConnectExternal(channel);
        return;
      }
      setConnecting(
        channel ? { mode: "reconnect", channel } : { mode: "create" },
      );
    },
    [onConnectExternal],
  );

  const handleDelete = useCallback(
    async (channel: AgentChannel) => {
      const name = channel.metadata?.name || channel.metadata?.slug || "this channel";
      const confirmed = await confirm({
        title: "Disconnect channel?",
        description:
          `"${name}" stops serving immediately and its stored Slack ` +
          "install (including credentials) is removed. Members of the " +
          "workspace can no longer reach the agent. To pause without " +
          "disconnecting, turn the channel off instead.",
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

  return (
    <div className={cn("space-y-3", className)}>
      {showCloudNotice && (
        <CloudFeatureNotice>
          Channel installs require Stigmer Cloud — connecting an agent to
          Slack uses the platform&apos;s hosted Slack app. Channel
          configuration still works here.
        </CloudFeatureNotice>
      )}

      {channels.length === 0 ? (
        <ChannelEmptyState
          canCreate={canCreate && (installsAvailable || !!onConnectExternal)}
          onConnectClick={() => handleConnect(null)}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-foreground">
              {channels.length} {channels.length === 1 ? "channel" : "channels"}
            </h3>
            {canCreate && (installsAvailable || !!onConnectExternal) && (
              <Button
                variant="outline"
                size="xs"
                icon={<SlackMarkIcon className="size-3" />}
                onClick={() => handleConnect(null)}
              >
                Connect to Slack
              </Button>
            )}
          </div>

          <div className="space-y-2">
            {channels.map((channel) => (
              <ChannelCard
                key={channel.metadata?.id}
                agent={agent}
                channel={channel}
                installsAvailable={installsAvailable || !!onConnectExternal}
                onConnectClick={() => handleConnect(channel)}
                onDeleteClick={() => void handleDelete(channel)}
                onEditCredentials={() => setEditingCredentials(channel)}
                refetch={refetch}
              />
            ))}
          </div>
        </>
      )}

      {connecting && (
        <ConnectSlackDialog
          open
          onOpenChange={(open) => {
            if (!open) setConnecting(null);
          }}
          agent={agent}
          channel={connecting.mode === "reconnect" ? connecting.channel : undefined}
          onChannelsChanged={refetch}
        />
      )}

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
  readonly installsAvailable: boolean;
  readonly onConnectClick: () => void;
  readonly onDeleteClick: () => void;
  readonly onEditCredentials: () => void;
  readonly refetch: () => void;
}

function ChannelCard({
  agent,
  channel,
  installsAvailable,
  onConnectClick,
  onDeleteClick,
  onEditCredentials,
  refetch,
}: ChannelCardProps) {
  const meta = channel.metadata;
  const id = meta?.id ?? "";
  const enabled = channel.spec?.enabled ?? false;
  const installState = installStateOf(channel);
  const slack =
    channel.status?.providerStatus?.case === "slack"
      ? channel.status.providerStatus.value
      : null;
  // The serving app (T04 item 2): set means the channel installs through
  // the org's own channel app; absent means the platform Stigmer app.
  // The ref's slug is the identifier the owner chose — enough to tell
  // two apps' channels apart without fetching the ChannelApp.
  const servingAppSlug = channel.spec?.appRef?.slug || null;

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

  const installedAt = slack?.installedAt
    ? timestampDate(slack.installedAt)
    : null;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <SlackMarkIcon className="size-5 shrink-0 text-foreground" />
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
              {describeChannel(installState, slack?.teamName, installedAt)}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground-faint">
              {servingAppSlug
                ? `Serving app: ${servingAppSlug} (your app)`
                : "Serving app: Stigmer"}
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
            installsAvailable &&
            installState !== AgentChannelInstallState.installed && (
              <Button variant="outline" size="xs" onClick={onConnectClick}>
                {installState === AgentChannelInstallState.revoked
                  ? "Reconnect"
                  : "Connect"}
              </Button>
            )}
          {(canEdit || canDelete) && (
            <ActionMenu>
              <ActionMenu.Trigger
                aria-label={`Actions for ${meta?.name || meta?.slug}`}
              >
                <MoreHorizontal className="size-4" />
              </ActionMenu.Trigger>
              <ActionMenu.Content>
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
          )}
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

function describeChannel(
  state: AgentChannelInstallState,
  teamName: string | undefined,
  installedAt: Date | null,
): string {
  switch (state) {
    case AgentChannelInstallState.installed:
      return [
        teamName ? `Workspace: ${teamName}` : "Workspace connected",
        installedAt ? `since ${formatDate(installedAt)}` : null,
      ]
        .filter(Boolean)
        .join(" \u00b7 ");
    case AgentChannelInstallState.revoked:
      return teamName
        ? `The Slack app was removed from ${teamName} — reconnect to resume.`
        : "The Slack app was removed from the workspace — reconnect to resume.";
    default:
      return "The Slack install hasn't been completed yet.";
  }
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Empty + loading states
// ---------------------------------------------------------------------------

function ChannelEmptyState({
  canCreate,
  onConnectClick,
}: {
  readonly canCreate: boolean;
  readonly onConnectClick: () => void;
}) {
  return (
    <EmptyState
      variant="first-use"
      icon={<SlackMarkIcon className="size-10" />}
      title="No channels yet"
      description={
        "Connect this agent to a Slack workspace and members chat with it " +
        "right where they work — direct messages and channel @mentions, " +
        "with policy and billing enforced by Stigmer."
      }
      action={
        canCreate
          ? {
              label: "Connect to Slack",
              onClick: onConnectClick,
              icon: <SlackMarkIcon className="size-3" />,
            }
          : undefined
      }
    />
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
