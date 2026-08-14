"use client";

import { useCallback, useId, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { DialogShell } from "../internal/DialogShell.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { getErrorReason, type ResourceRef } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { Button } from "../button/Button.js";
import { useChannelAppList } from "../channel-app/useChannelAppList.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import {
  RegisterChannelAppAffordance,
  ServingAppSection,
} from "./connect/ServingAppSection.js";
import { ToolCredentialsSection } from "./connect/ToolCredentialsSection.js";
import { RefusalBox, VerbatimRefusal } from "./connect/VerbatimRefusal.js";
import { CheckIcon, CloseIcon, Spinner } from "./connect/icons.js";
import { useConnectSlackChannel, type SlackConnectPhase } from "./useConnectSlackChannel.js";
import { useCreateAgentChannel } from "./useCreateAgentChannel.js";
import { useOrgAgentChannelList } from "./useOrgAgentChannelList.js";
import { SlackMarkIcon } from "./SlackMarkIcon.js";

/** Props for {@link ConnectSlackDialog}. */
export interface ConnectSlackDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog requests an open-state change. */
  readonly onOpenChange: (open: boolean) => void;
  /** The agent the channel connects. */
  readonly agent: Agent;
  /**
   * An existing channel to (re)connect — a `pending_install` channel
   * whose install never completed, or a `revoked` one being re-installed.
   * When omitted, the dialog opens in **create mode**: a name step
   * creates a new channel, then runs the install flow on it.
   */
  readonly channel?: AgentChannel | null;
  /**
   * Called after the channel set changes (created, or install completed).
   * Hosts typically pass the channel list's `refetch`.
   */
  readonly onChannelsChanged?: () => void;
  /**
   * When `false`, renders as an in-flow open dialog instead of a
   * top-layer modal — no `showModal()`, no backdrop, no focus trap.
   * For embedding the dialog in a constrained surface (documentation
   * demos, visual tests). Interactive hosts keep the default.
   * @default true
   */
  readonly modal?: boolean;
  /**
   * Where the host manages Channel Apps (the console passes
   * `/settings/channel-apps`). When provided, the "Connect as" section
   * and install refusals render a "Register a channel app" link there.
   * SDK components never hardcode host routes — hosts inject the
   * destination (the `onConnectExternal` delegate convention). Absent,
   * the affordance degrades to plain guidance text.
   */
  readonly channelAppsHref?: string;
}

/**
 * The connect flow for a Slack channel: create the {@link AgentChannel}
 * (create mode), then run the "Add to Slack" OAuth install in a popup
 * and report progress phase by phase.
 *
 * Requires a deployment with platform Slack app credentials — on a
 * `local` (OSS) backend the flow is preempted with a cloud-feature
 * notice, matching the server's FAILED_PRECONDITION refusal. Install
 * refusals (unconfigured deployment, duplicate workspace, Enterprise
 * Grid) render the server's copy verbatim — the server owns that
 * vocabulary.
 *
 * Built on the native `<dialog>` element for focus trapping and escape
 * handling, matching the SDK's modal convention ({@link ShareAgentDialog}).
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * Most hosts mount it via {@link AgentChannelsPanel} (the Channels tab).
 * Render it directly only when you own the open-state.
 */
export function ConnectSlackDialog({
  open,
  onOpenChange,
  agent,
  channel,
  onChannelsChanged,
  modal = true,
  channelAppsHref,
}: ConnectSlackDialogProps) {
  // Instance-scoped title id (oss#593): a reusable component must not
  // hardcode DOM ids — hosts legitimately mount this dialog more than once
  // per page (e.g. zone-cached detail pages), and duplicate ids break the
  // aria-labelledby association for every copy after the first.
  const titleId = useId();

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      modal={modal}
      width="md"
      aria-labelledby={titleId}
    >
      {/* Body mounts only while open so its flow state resets per
          session — reopening the dialog never resumes a stale flow. */}
      {open && (
        <ConnectSlackDialogBody
          agent={agent}
          channel={channel ?? null}
          onChannelsChanged={onChannelsChanged}
          onClose={handleClose}
          titleId={titleId}
          channelAppsHref={channelAppsHref}
        />
      )}
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// Dialog body — create step (optional) + install flow
// ---------------------------------------------------------------------------

interface ConnectSlackDialogBodyProps {
  readonly agent: Agent;
  readonly channel: AgentChannel | null;
  readonly onChannelsChanged?: () => void;
  readonly onClose: () => void;
  readonly channelAppsHref?: string;
  /** Heading id minted by the outer dialog for its aria-labelledby. */
  readonly titleId: string;
}

function ConnectSlackDialogBody({
  agent,
  channel,
  onChannelsChanged,
  onClose,
  channelAppsHref,
  titleId,
}: ConnectSlackDialogBodyProps) {
  const deploymentMode = useDeploymentMode();
  const agentName = agent.metadata?.name || agent.metadata?.slug || "this agent";
  const org = agent.metadata?.org ?? "";

  const { createChannel, isPending: isCreating } = useCreateAgentChannel();
  const slack = useConnectSlackChannel();

  const [name, setName] = useState(() =>
    channel ? (channel.metadata?.name ?? "") : `${agentName} Slack`,
  );
  // Tool credentials bound at connect time (create mode only — a
  // reconnect keeps the channel's existing bindings untouched; edits go
  // through the channel card's credentials dialog).
  const [environmentRefs, setEnvironmentRefs] = useState<ResourceRef[]>([]);
  // The serving app (create mode only): null = the platform Stigmer app;
  // a ref = one of the org's own channel apps (BYO — the bot carries that
  // app's name, and each app is its own bot identity). A reconnect keeps
  // the channel's existing binding — an installed channel's app_ref is
  // frozen server-side.
  const [appRef, setAppRef] = useState<ResourceRef | null>(null);
  const [installed, setInstalled] = useState<AgentChannel | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // The org's channel apps, fetched once here so the serving-app picker,
  // the addressing copy, and the advisory all read one consistent list.
  const { channelApps } = useChannelAppList(org || null);
  const slackApps = useMemo(
    () => channelApps.filter((app) => app.spec?.providerConfig?.case === "slack"),
    [channelApps],
  );

  // The app the install will (or did) go through: the picker's choice in
  // create mode, the frozen spec.app_ref on a reconnect. null = platform.
  const effectiveAppRef = channel
    ? channel.spec?.appRef?.slug
      ? { org: channel.spec.appRef.org || org, slug: channel.spec.appRef.slug }
      : null
    : appRef;
  const selectedApp = effectiveAppRef
    ? slackApps.find((app) => app.metadata?.slug === effectiveAppRef.slug) ?? null
    : null;
  // What members type after "@" in Slack. App-level, not agent-level: the
  // platform app's bot is "Stigmer"; a BYO app's bot carries the name its
  // manifest declared — which the registration form seeded from the
  // ChannelApp's own name.
  const botName = effectiveAppRef
    ? selectedApp?.metadata?.name || effectiveAppRef.slug
    : "Stigmer";

  // Workspaces the selected serving app already occupies, matched on the
  // same key the database enforces uniqueness on: (team, channel app).
  // Advisory only — the list is permission-bounded, and other orgs'
  // holds are invisible; completeInstall stays the arbiter.
  const advisoryActive = deploymentMode === "cloud" && !channel && !installed;
  const { channels: orgChannels } = useOrgAgentChannelList(
    advisoryActive && org ? org : null,
  );
  const alreadyServed = useMemo(() => {
    // Platform app installs stamp an empty channel_app_id.
    const selectedAppId = effectiveAppRef ? selectedApp?.metadata?.id : "";
    if (selectedAppId === undefined) return [];
    return orgChannels.filter(
      (c) =>
        c.status?.installState === AgentChannelInstallState.installed &&
        c.status?.providerStatus?.case === "slack" &&
        c.status.providerStatus.value.channelAppId === selectedAppId,
    );
  }, [orgChannels, effectiveAppRef, selectedApp]);

  // One click drives the whole journey: (create →) initiate → popup →
  // complete. It must stay a single synchronous entry point — the popup
  // opens inside connect(), and browsers only allow that from a
  // user-gesture call stack.
  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      let target = channel;
      if (!target) {
        target = await createChannel({
          name: name.trim() || `${agentName} Slack`,
          org,
          agentRef: {
            org,
            slug: agent.metadata?.slug ?? "",
          },
          enabled: true,
          slack: {},
          ...(appRef ? { appRef } : {}),
          ...(environmentRefs.length > 0 ? { environmentRefs } : {}),
        });
        // The channel now exists even if the install below fails or is
        // abandoned — surface it in the list either way.
        onChannelsChanged?.();
      }

      const result = await slack.connect(target.metadata?.id ?? "");
      setInstalled(result);
      onChannelsChanged?.();
    } catch (err) {
      // Cancellation is a user decision, not a failure — the hook keeps
      // error null for it; everything else renders below.
      setError(slack.error ?? (err instanceof Error ? err : new Error(String(err))));
    }
  }, [agent, agentName, appRef, channel, createChannel, environmentRefs, name, org, onChannelsChanged, slack]);

  const handleCancel = useCallback(() => {
    slack.clearError();
    setError(null);
  }, [slack]);

  const busy = isCreating || slack.isInProgress;

  return (
    <div className="stg:flex stg:flex-col">
      {/* Header */}
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3 stg:border-b stg:border-border stg:px-5 stg:py-4">
        <div className="stg:flex stg:items-center stg:gap-2.5">
          <SlackMarkIcon className="stg:size-5 stg:text-foreground" />
          <h2 id={titleId} className="stg:text-sm stg:font-semibold stg:text-foreground">
            {channel ? "Reconnect to Slack" : "Connect to Slack"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className={cn(
            "stg:rounded stg:p-1 stg:text-muted-foreground",
            "stg:hover:bg-accent-hover stg:hover:text-foreground",
            "stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-ring",
          )}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="stg:space-y-4 stg:px-5 stg:py-4">
        {deploymentMode === "local" ? (
          // Preempt the doomed flow: the OSS backend answers every install
          // with FAILED_PRECONDITION, so don't open a popup destined to fail.
          <CloudFeatureNotice>
            Channel installs require Stigmer Cloud. The local backend
            manages channel configuration, but connecting to Slack uses the
            platform&apos;s hosted Slack app.
          </CloudFeatureNotice>
        ) : installed ? (
          <InstalledSummary
            channel={installed}
            agentName={agentName}
            botName={botName}
          />
        ) : busy ? (
          <FlowProgress phase={slack.phase} onCancel={handleCancel} />
        ) : (
          <>
            {!channel && (
              <label className="stg:block">
                <span className="stg:mb-1.5 stg:block stg:text-xs stg:font-medium stg:text-foreground">
                  Channel name
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  className={cn(
                    "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-3 stg:py-1.5",
                    "stg:text-sm stg:text-foreground stg:placeholder:text-muted-foreground",
                    "stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-ring",
                  )}
                />
                <span className="stg:mt-1 stg:block stg:text-xs stg:text-muted-foreground">
                  Names the connection in Stigmer — pick something that
                  identifies the workspace if you connect more than one.
                </span>
              </label>
            )}

            {!channel && (
              <ServingAppSection
                org={org}
                apps={slackApps}
                value={appRef}
                onChange={setAppRef}
                disabled={busy}
                channelAppsHref={channelAppsHref}
                idPrefix="stgm-slack-app"
                platformOption={{
                  label: "Stigmer app",
                  hint: "Fastest — no setup, the bot is named Stigmer",
                }}
                appHint="Your app — your bot name and icon"
                emptyBody={
                  <p className="stg:text-xs stg:text-muted-foreground">
                    The platform{" "}
                    <span className="stg:font-medium stg:text-foreground">Stigmer</span>{" "}
                    app — no setup needed. Want the bot to carry your own name
                    and icon, or several agents in one workspace?{" "}
                    <RegisterChannelAppAffordance channelAppsHref={channelAppsHref}>
                      Register a channel app
                    </RegisterChannelAppAffordance>
                    .
                  </p>
                }
              />
            )}

            {alreadyServed.length > 0 && (
              <AlreadyServedNote botName={botName} channels={alreadyServed} />
            )}

            {!channel && (
              <ToolCredentialsSection
                agent={agent}
                org={org}
                value={environmentRefs}
                onChange={setEnvironmentRefs}
                disabled={busy}
              />
            )}

            <p className="stg:text-sm stg:text-muted-foreground">
              When you continue, Slack asks which workspace to add the bot
              to — pick the one where your team should chat with this agent.
            </p>
            <p className="stg:text-sm stg:text-muted-foreground">
              Members reach the agent by opening a direct message with{" "}
              <span className="stg:font-medium stg:text-foreground">{botName}</span>,
              or typing @ in a channel and picking{" "}
              <span className="stg:font-medium stg:text-foreground">{botName}</span>{" "}
              from the list — it answers as{" "}
              <span className="stg:font-medium stg:text-foreground">{agentName}</span>.
            </p>
            <p className="stg:text-xs stg:text-muted-foreground">
              Conversations from Slack are billed to{" "}
              <span className="stg:font-medium">{org}</span>. A workspace can
              host one agent per Slack app.
            </p>

            {error && (
              <InstallRefusal error={error} channelAppsHref={channelAppsHref} />
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="stg:flex stg:justify-end stg:gap-2 stg:border-t stg:border-border stg:px-5 stg:py-3">
        {installed || deploymentMode === "local" ? (
          <Button variant="outline" size="sm" onClick={onClose}>
            {installed ? "Done" : "Close"}
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleConnect()}
              disabled={busy}
              icon={<SlackMarkIcon className="stg:size-3.5" />}
              data-cursor-target="dialog-connect-slack"
            >
              {error ? "Try again" : channel ? "Reconnect to Slack" : "Connect to Slack"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Install refusal — guided for the duplicate-workspace reason
// ---------------------------------------------------------------------------

/**
 * The reason code the server attaches (google.rpc.ErrorInfo, domain
 * stigmer.ai) to a duplicate-workspace completeInstall refusal — see the
 * completeInstall rpc comment for the vocabulary.
 */
const REASON_WORKSPACE_ALREADY_CONNECTED = "SLACK_WORKSPACE_ALREADY_CONNECTED";

/**
 * Install-refusal rendering. The duplicate-workspace refusal is the one
 * a user can act on from here, so it gets a guided treatment — names the
 * occupied workspace (from the ErrorInfo metadata) and offers the
 * register-a-channel-app path. Every other refusal (and any error from a
 * server not attaching reasons) renders the server's copy verbatim — the
 * server owns that vocabulary.
 */
function InstallRefusal({
  error,
  channelAppsHref,
}: {
  readonly error: Error;
  readonly channelAppsHref?: string;
}) {
  const reason = getErrorReason(error);
  if (reason?.reason !== REASON_WORKSPACE_ALREADY_CONNECTED) {
    return <VerbatimRefusal error={error} />;
  }

  const team = reason.metadata.team_name || "This workspace";
  return (
    <RefusalBox>
      <p>
        <span className="stg:font-medium">{team}</span> already hosts an agent
        through this app — a workspace hosts one agent per Slack app.
      </p>
      <p>
        To reach it with this agent, disconnect the existing channel, or{" "}
        <RegisterChannelAppAffordance channelAppsHref={channelAppsHref}>
          register a channel app
        </RegisterChannelAppAffordance>{" "}
        and connect through that instead.
      </p>
    </RefusalBox>
  );
}

/**
 * Pre-OAuth advisory: the selected serving app already occupies these
 * workspaces, matched on the exact key the database enforces —
 * (workspace, serving app). Shown before the user spends a Slack OAuth
 * round-trip discovering it. Best-effort by design: the list is bounded
 * by the caller's visibility and cannot see other orgs' holds, so the
 * copy warns rather than forbids.
 */
function AlreadyServedNote({
  botName,
  channels,
}: {
  readonly botName: string;
  readonly channels: readonly AgentChannel[];
}) {
  return (
    <div role="status" className="stg:space-y-0.5 stg:text-xs stg:text-warning">
      {channels.map((c) => {
        const slack =
          c.status?.providerStatus?.case === "slack"
            ? c.status.providerStatus.value
            : null;
        const team = slack?.teamName || slack?.teamId || "a workspace";
        const agent = c.spec?.agentRef?.slug || "another agent";
        return (
          <p key={c.metadata?.id ?? team}>
            <span className="stg:font-medium">{botName}</span> already serves{" "}
            <span className="stg:font-medium">{team}</span> via {agent} — a
            workspace hosts one agent per app, so connect through a
            different channel app to reach it.
          </p>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow progress — one row per phase, the active one live
// ---------------------------------------------------------------------------

const FLOW_STEPS: readonly { readonly phase: SlackConnectPhase; readonly label: string }[] = [
  { phase: "initiating", label: "Contacting Slack" },
  { phase: "awaiting-callback", label: "Waiting for your approval in the Slack window" },
  { phase: "completing", label: "Finalizing the connection" },
];

function FlowProgress({
  phase,
  onCancel,
}: {
  readonly phase: SlackConnectPhase;
  readonly onCancel: () => void;
}) {
  const activeIndex = FLOW_STEPS.findIndex((s) => s.phase === phase);

  return (
    <div className="stg:space-y-3" aria-live="polite">
      <ul className={cn(UNSTYLED_LIST, "stg:space-y-2")}>
        {FLOW_STEPS.map((step, i) => {
          const isActive = i === activeIndex;
          const isDone = activeIndex > i;
          return (
            <li
              key={step.phase}
              className={cn(
                "stg:flex stg:items-center stg:gap-2 stg:text-sm",
                isActive
                  ? "stg:text-foreground"
                  : isDone
                    ? "stg:text-muted-foreground"
                    : "stg:text-muted-foreground-subtle",
              )}
            >
              {isDone ? (
                <CheckIcon className="stg:size-3.5 stg:shrink-0 stg:text-success" />
              ) : isActive ? (
                <Spinner className="stg:size-3.5 stg:shrink-0" />
              ) : (
                <span className="stg:size-3.5 stg:shrink-0 stg:rounded-full stg:border stg:border-border" aria-hidden="true" />
              )}
              {step.label}
            </li>
          );
        })}
      </ul>
      <Button variant="ghost" size="xs" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installed summary — the success state with the observed Slack facts
// ---------------------------------------------------------------------------

function InstalledSummary({
  channel,
  agentName,
  botName,
}: {
  readonly channel: AgentChannel;
  readonly agentName: string;
  readonly botName: string;
}) {
  const slack = channel.status?.providerStatus?.case === "slack"
    ? channel.status.providerStatus.value
    : null;

  return (
    <div className="stg:space-y-2" role="status">
      <div className="stg:flex stg:items-center stg:gap-2 stg:text-sm stg:font-medium stg:text-foreground">
        <CheckIcon className="stg:size-4 stg:text-success" />
        Connected{slack?.teamName ? ` to ${slack.teamName}` : ""}
      </div>
      <p className="stg:text-sm stg:text-muted-foreground">
        In Slack, open a direct message with{" "}
        <span className="stg:font-medium stg:text-foreground">{botName}</span> — or
        type @ in any channel and pick{" "}
        <span className="stg:font-medium stg:text-foreground">{botName}</span> from
        the list — then ask your question. Answers come from{" "}
        <span className="stg:font-medium stg:text-foreground">{agentName}</span>.
      </p>
    </div>
  );
}

