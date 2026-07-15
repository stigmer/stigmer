"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, type ResourceRef } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { Button } from "../button/Button.js";
import { useChannelAppList } from "../channel-app/useChannelAppList.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { ChannelToolCredentials } from "./ChannelToolCredentials.js";
import { useConnectSlackChannel, type SlackConnectPhase } from "./useConnectSlackChannel.js";
import { useCreateAgentChannel } from "./useCreateAgentChannel.js";
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
}

function ConnectSlackDialogBody({
  agent,
  channel,
  onChannelsChanged,
  onClose,
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
          <InstalledSummary channel={installed} agentName={agentName} />
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
                value={appRef}
                onChange={setAppRef}
                disabled={busy}
              />
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
              Members reach{" "}
              <span className="font-medium text-foreground">{agentName}</span>{" "}
              by opening a direct message with the bot, or typing @ in a
              channel and choosing it from the list.
            </p>
            <p className="text-xs text-muted-foreground">
              Conversations from Slack are billed to{" "}
              <span className="font-medium">{org}</span>. A workspace can
              host one agent per Slack app.
            </p>

            {error && (
              <div
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive-subtle px-3 py-2 text-xs text-destructive"
              >
                {getUserMessage(error)}
              </div>
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
 * Rendered only when the org has registered channel apps — with none, the
 * platform app is the only answer and a one-option radio group is noise.
 * Apps are registered under Settings → Channel Apps.
 */
function ServingAppSection({
  org,
  value,
  onChange,
  disabled,
}: {
  readonly org: string;
  readonly value: ResourceRef | null;
  readonly onChange: (ref: ResourceRef | null) => void;
  readonly disabled: boolean;
}) {
  const { channelApps } = useChannelAppList(org);

  const slackApps = channelApps.filter(
    (app) => app.spec?.providerConfig?.case === "slack",
  );
  if (slackApps.length === 0) {
    return null;
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
        {slackApps.map((app) => {
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
    </fieldset>
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
}: {
  readonly channel: AgentChannel;
  readonly agentName: string;
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
        In Slack, open a direct message with the bot — or type @ in any
        channel and pick it from the list — then ask your question. It
        replies as{" "}
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
