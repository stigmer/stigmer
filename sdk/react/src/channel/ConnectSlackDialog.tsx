"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@stigmer/theme";
import { getErrorReason, getUserMessage, type ResourceRef } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { Button } from "../button/Button.js";
import { useChannelAppList } from "../channel-app/useChannelAppList.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { ChannelToolCredentials } from "./ChannelToolCredentials.js";
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
  const dialogRef = useRef<HTMLDialogElement>(null);

  const handleClose = useCallback(() => {
    dialogRef.current?.close();
    onOpenChange(false);
  }, [onOpenChange]);

  // Sync native dialog open state (matches the SDK dialog convention).
  // Non-modal hosts pass `open` as a plain attribute instead — the dialog
  // renders in-flow with no top layer to manage.
  const prevOpenRef = useRef(false);
  if (modal && open !== prevOpenRef.current) {
    prevOpenRef.current = open;
    if (open) {
      requestAnimationFrame(() => {
        if (dialogRef.current && !dialogRef.current.open) {
          dialogRef.current.showModal();
        }
      });
    } else if (dialogRef.current?.open) {
      dialogRef.current.close();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      open={modal ? undefined : open}
      onClose={handleClose}
      className={cn(
        "w-full max-w-md rounded-xl border border-border bg-popover p-0 shadow-xl",
        modal ? "fixed inset-0 m-auto backdrop:bg-black/50" : "relative",
      )}
      aria-labelledby="connect-slack-title"
    >
      {/* Body mounts only while open so its flow state resets per
          session — reopening the dialog never resumes a stale flow. */}
      {open && (
        <ConnectSlackDialogBody
          agent={agent}
          channel={channel ?? null}
          onChannelsChanged={onChannelsChanged}
          onClose={handleClose}
          channelAppsHref={channelAppsHref}
        />
      )}
    </dialog>
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
}

function ConnectSlackDialogBody({
  agent,
  channel,
  onChannelsChanged,
  onClose,
  channelAppsHref,
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
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex items-center gap-2.5">
          <SlackMarkIcon className="size-5 text-foreground" />
          <h2 id="connect-slack-title" className="text-sm font-semibold text-foreground">
            {channel ? "Reconnect to Slack" : "Connect to Slack"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className={cn(
            "rounded p-1 text-muted-foreground",
            "hover:bg-accent-hover hover:text-foreground",
            "focus:outline-none focus:ring-1 focus:ring-ring",
          )}
        >
          <CloseIcon />
        </button>
      </div>

      <div className="space-y-4 px-5 py-4">
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
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-foreground">
                  Channel name
                </span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  className={cn(
                    "w-full rounded-md border border-input bg-background px-3 py-1.5",
                    "text-sm text-foreground placeholder:text-muted-foreground",
                    "focus:outline-none focus:ring-1 focus:ring-ring",
                  )}
                />
                <span className="mt-1 block text-xs text-muted-foreground">
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

            <p className="text-sm text-muted-foreground">
              When you continue, Slack asks which workspace to add the bot
              to — pick the one where your team should chat with this agent.
            </p>
            <p className="text-sm text-muted-foreground">
              Members reach the agent by opening a direct message with{" "}
              <span className="font-medium text-foreground">{botName}</span>,
              or typing @ in a channel and picking{" "}
              <span className="font-medium text-foreground">{botName}</span>{" "}
              from the list — it answers as{" "}
              <span className="font-medium text-foreground">{agentName}</span>.
            </p>
            <p className="text-xs text-muted-foreground">
              Conversations from Slack are billed to{" "}
              <span className="font-medium">{org}</span>. A workspace can
              host one agent per Slack app.
            </p>

            {error && (
              <InstallRefusal error={error} channelAppsHref={channelAppsHref} />
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
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
              icon={<SlackMarkIcon className="size-3.5" />}
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
// Serving app — the platform Stigmer app vs one of the org's own apps
// ---------------------------------------------------------------------------

/**
 * "Connect as whom" for create mode (T04 item 2): the platform's shared
 * Stigmer app (zero setup, bot named "Stigmer") or one of the org's own
 * channel apps (the bot carries that app's brand, and because each app is
 * its own bot identity, multiple agents can serve one workspace).
 *
 * Always rendered so the choice — and the path to registering an app —
 * is discoverable before the first BYO app exists. With no registered
 * apps it states the default plainly instead of a one-option radio group
 * (which would be noise); with apps it offers the picker. Both shapes
 * carry the register affordance: a link when the host provided
 * `channelAppsHref`, plain guidance text otherwise.
 */
function ServingAppSection({
  org,
  apps,
  value,
  onChange,
  disabled,
  channelAppsHref,
}: {
  readonly org: string;
  readonly apps: readonly ChannelApp[];
  readonly value: ResourceRef | null;
  readonly onChange: (ref: ResourceRef | null) => void;
  readonly disabled: boolean;
  readonly channelAppsHref?: string;
}) {
  if (apps.length === 0) {
    return (
      <section aria-label="Connect as">
        <h3 className="mb-1.5 text-xs font-medium text-foreground">
          Connect as
        </h3>
        <p className="text-xs text-muted-foreground">
          The platform{" "}
          <span className="font-medium text-foreground">Stigmer</span> app —
          no setup needed. Want the bot to carry your own name and icon, or
          several agents in one workspace?{" "}
          <RegisterChannelAppAffordance channelAppsHref={channelAppsHref}>
            Register a channel app
          </RegisterChannelAppAffordance>
          .
        </p>
      </section>
    );
  }

  return (
    <fieldset>
      <legend className="mb-1.5 block text-xs font-medium text-foreground">
        Connect as
      </legend>
      <div role="radiogroup" className="space-y-1.5">
        <ServingAppOption
          id="stgm-slack-app-platform"
          label="Stigmer app"
          hint="Fastest — no setup, the bot is named Stigmer"
          checked={value === null}
          onSelect={() => onChange(null)}
          disabled={disabled}
        />
        {apps.map((app) => {
          const slug = app.metadata?.slug ?? "";
          const checked = value?.slug === slug;
          return (
            <ServingAppOption
              key={app.metadata?.id ?? slug}
              id={`stgm-slack-app-${slug}`}
              label={app.metadata?.name ?? slug}
              hint="Your app — your bot name and icon"
              checked={checked}
              onSelect={() => onChange({ org, slug })}
              disabled={disabled}
            />
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        <RegisterChannelAppAffordance channelAppsHref={channelAppsHref}>
          Register a channel app
        </RegisterChannelAppAffordance>
        .
      </p>
    </fieldset>
  );
}

/**
 * The path from the connect flow to Channel App registration. A link
 * when the host told us where registration lives; otherwise the label
 * plus the console location, so embedded hosts without the route still
 * leave the user oriented. Children are the label ("Register a channel
 * app" / "register a channel app") so each call site reads as a sentence.
 */
function RegisterChannelAppAffordance({
  channelAppsHref,
  children,
}: {
  readonly channelAppsHref?: string;
  readonly children: ReactNode;
}) {
  if (!channelAppsHref) {
    return <>{children} under Settings → Channel Apps</>;
  }
  return (
    <a
      href={channelAppsHref}
      className={cn(
        "font-medium underline underline-offset-2",
        "hover:no-underline",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
      )}
    >
      {children}
    </a>
  );
}

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
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
      >
        {getUserMessage(error)}
      </div>
    );
  }

  const team = reason.metadata.team_name || "This workspace";
  return (
    <div
      role="alert"
      className="space-y-1 rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
    >
      <p>
        <span className="font-medium">{team}</span> already hosts an agent
        through this app — a workspace hosts one agent per Slack app.
      </p>
      <p>
        To reach it with this agent, disconnect the existing channel, or{" "}
        <RegisterChannelAppAffordance channelAppsHref={channelAppsHref}>
          register a channel app
        </RegisterChannelAppAffordance>{" "}
        and connect through that instead.
      </p>
    </div>
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
    <div role="status" className="space-y-0.5 text-xs text-warning">
      {channels.map((c) => {
        const slack =
          c.status?.providerStatus?.case === "slack"
            ? c.status.providerStatus.value
            : null;
        const team = slack?.teamName || slack?.teamId || "a workspace";
        const agent = c.spec?.agentRef?.slug || "another agent";
        return (
          <p key={c.metadata?.id ?? team}>
            <span className="font-medium">{botName}</span> already serves{" "}
            <span className="font-medium">{team}</span> via {agent} — a
            workspace hosts one agent per app, so connect through a
            different channel app to reach it.
          </p>
        );
      })}
    </div>
  );
}

function ServingAppOption({
  id,
  label,
  hint,
  checked,
  onSelect,
  disabled,
}: {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly disabled: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5",
        checked ? "border-ring bg-accent" : "border-border hover:bg-accent-hover",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      <input
        id={id}
        type="radio"
        name="stgm-slack-serving-app"
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="mt-0.5 accent-current"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium text-foreground">{label}</span>
        <span className="block text-[0.65rem] text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Tool credentials — org-shared environments bound at connect time
// ---------------------------------------------------------------------------

/**
 * Collapsible credential-binding section for create mode (the
 * ShareAgentDialog ToolCredentialsSection pattern). Expanded by default
 * when the agent uses MCP tools — for those agents this is essential
 * configuration, not an advanced option: without a binding, every
 * workspace message that needs a tool is refused.
 */
function ToolCredentialsSection({
  agent,
  org,
  value,
  onChange,
  disabled,
}: {
  readonly agent: Agent;
  readonly org: string;
  readonly value: readonly ResourceRef[];
  readonly onChange: (refs: ResourceRef[]) => void;
  readonly disabled: boolean;
}) {
  const hasMcpTools = (agent.spec?.mcpServerUsages?.length ?? 0) > 0;
  const [expanded, setExpanded] = useState(hasMcpTools || value.length > 0);

  return (
    <section>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-medium text-muted-foreground",
          "hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded",
        )}
      >
        <ChevronIcon
          className={cn("size-3 transition-transform", expanded && "rotate-90")}
        />
        Tool credentials
      </button>

      {expanded && (
        <div className="mt-2">
          <ChannelToolCredentials
            agent={agent}
            org={org}
            value={value}
            onChange={onChange}
            disabled={disabled}
          />
        </div>
      )}
    </section>
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
    <div className="space-y-3" aria-live="polite">
      <ul className="space-y-2">
        {FLOW_STEPS.map((step, i) => {
          const isActive = i === activeIndex;
          const isDone = activeIndex > i;
          return (
            <li
              key={step.phase}
              className={cn(
                "flex items-center gap-2 text-sm",
                isActive
                  ? "text-foreground"
                  : isDone
                    ? "text-muted-foreground"
                    : "text-muted-foreground-subtle",
              )}
            >
              {isDone ? (
                <CheckIcon className="size-3.5 shrink-0 text-success" />
              ) : isActive ? (
                <Spinner className="size-3.5 shrink-0" />
              ) : (
                <span className="size-3.5 shrink-0 rounded-full border border-border" aria-hidden="true" />
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
    <div className="space-y-2" role="status">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <CheckIcon className="size-4 text-success" />
        Connected{slack?.teamName ? ` to ${slack.teamName}` : ""}
      </div>
      <p className="text-sm text-muted-foreground">
        In Slack, open a direct message with{" "}
        <span className="font-medium text-foreground">{botName}</span> — or
        type @ in any channel and pick{" "}
        <span className="font-medium text-foreground">{botName}</span> from
        the list — then ask your question. Answers come from{" "}
        <span className="font-medium text-foreground">{agentName}</span>.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="m3 3 8 8M11 3l-8 8" />
    </svg>
  );
}

function CheckIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 8.5 3.5 3.5L13 5" />
    </svg>
  );
}

function ChevronIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
    </svg>
  );
}

function Spinner({ className }: { readonly className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
