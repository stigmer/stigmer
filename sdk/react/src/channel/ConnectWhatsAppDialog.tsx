"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { getErrorReason, type ResourceRef } from "@stigmer/sdk";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { Button } from "../button/Button.js";
import { useChannelAppList } from "../channel-app/useChannelAppList.js";
import { useDeploymentMode } from "../deployment-mode.js";
import { useStigmer } from "../hooks.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import {
  RegisterChannelAppAffordance,
  ServingAppSection,
} from "./connect/ServingAppSection.js";
import { ToolCredentialsSection } from "./connect/ToolCredentialsSection.js";
import { RefusalBox, VerbatimRefusal } from "./connect/VerbatimRefusal.js";
import { CheckIcon, CloseIcon, Spinner } from "./connect/icons.js";
import { useCreateAgentChannel } from "./useCreateAgentChannel.js";
import { useInstallChannel } from "./useInstallChannel.js";
import { useOrgAgentChannelList } from "./useOrgAgentChannelList.js";
import { agentChannelToInput, useSaveAgentChannel } from "./useSaveAgentChannel.js";
import { WhatsAppMarkIcon } from "./WhatsAppMarkIcon.js";

/** Props for {@link ConnectWhatsAppDialog}. */
export interface ConnectWhatsAppDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Called when the dialog requests an open-state change. */
  readonly onOpenChange: (open: boolean) => void;
  /** The agent the channel connects. */
  readonly agent: Agent;
  /**
   * An existing channel to (re)connect — a `pending_install` channel
   * whose install never completed. Unlike Slack's frozen reconnect, the
   * number and serving app stay editable here: a failed direct install
   * usually means one of them is wrong, and both are server-mutable
   * while the channel isn't installed. When omitted, the dialog opens in
   * **create mode**.
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
   * `/settings/channel-apps`). When provided, the serving-app section
   * and install refusals render a "Register a channel app" link there.
   * SDK components never hardcode host routes — hosts inject the
   * destination. Absent, the affordance degrades to plain guidance text.
   */
  readonly channelAppsHref?: string;
}

/**
 * The connect flow for a WhatsApp channel: create the
 * {@link AgentChannel} (create mode), then run the direct install — one
 * server call that verifies the declared phone number against Meta's
 * Graph API through the selected channel app's credentials (DD-WA-1).
 * No consent popup, no callback route.
 *
 * WhatsApp is BYO-only (DD-WA-2): there is no platform Meta app, so a
 * serving channel app is required — with none registered, the flow
 * blocks on registering one first. The declared phone number ID is
 * likewise required: the install proves it, and an empty value can only
 * fail there.
 *
 * Requires Stigmer Cloud — on a `local` (OSS) backend the flow is
 * preempted with a cloud-feature notice, matching the server's
 * FAILED_PRECONDITION refusal. Install refusals render the server's
 * copy verbatim except the duplicate-number refusal, which gets a
 * guided treatment.
 *
 * Built on the native `<dialog>` element for focus trapping and escape
 * handling, matching the SDK's modal convention
 * ({@link ConnectSlackDialog}). All visual properties flow through
 * `--stgm-*` design tokens.
 *
 * Most hosts mount it via {@link AgentChannelsPanel} (the Channels tab).
 * Render it directly only when you own the open-state.
 */
export function ConnectWhatsAppDialog({
  open,
  onOpenChange,
  agent,
  channel,
  onChannelsChanged,
  modal = true,
  channelAppsHref,
}: ConnectWhatsAppDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Instance-scoped title id (oss#593): a reusable component must not
  // hardcode DOM ids — hosts legitimately mount this dialog more than once
  // per page (e.g. zone-cached detail pages), and duplicate ids break the
  // aria-labelledby association for every copy after the first.
  const titleId = useId();

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
        "stg:w-full stg:max-w-md stg:rounded-xl stg:border stg:border-border stg:bg-popover stg:p-0 stg:shadow-xl",
        modal ? "stg:fixed stg:inset-0 stg:m-auto stg:backdrop:bg-backdrop" : "stg:relative",
      )}
      aria-labelledby={titleId}
    >
      {/* Body mounts only while open so its flow state resets per
          session — reopening the dialog never resumes a stale flow. */}
      {open && (
        <ConnectWhatsAppDialogBody
          agent={agent}
          channel={channel ?? null}
          onChannelsChanged={onChannelsChanged}
          onClose={handleClose}
          channelAppsHref={channelAppsHref}
          titleId={titleId}
        />
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Dialog body — create step (optional) + direct install
// ---------------------------------------------------------------------------

interface ConnectWhatsAppDialogBodyProps {
  readonly agent: Agent;
  readonly channel: AgentChannel | null;
  readonly onChannelsChanged?: () => void;
  readonly onClose: () => void;
  readonly channelAppsHref?: string;
  /** Heading id minted by the outer dialog for its aria-labelledby. */
  readonly titleId: string;
}

function ConnectWhatsAppDialogBody({
  agent,
  channel,
  onChannelsChanged,
  onClose,
  channelAppsHref,
  titleId,
}: ConnectWhatsAppDialogBodyProps) {
  const stigmer = useStigmer();
  const deploymentMode = useDeploymentMode();
  const agentName = agent.metadata?.name || agent.metadata?.slug || "this agent";
  const org = agent.metadata?.org ?? "";

  const { createChannel, isPending: isCreating } = useCreateAgentChannel();
  const { save, isPending: isSaving } = useSaveAgentChannel();
  const installer = useInstallChannel();

  const [name, setName] = useState(() =>
    channel ? (channel.metadata?.name ?? "") : `${agentName} WhatsApp`,
  );
  // The declared number (spec.whatsapp.phone_number_id). Genuinely
  // user-declared — a WABA holds many numbers; the owner picks which one
  // the agent serves. Required client-side: the write path defers it to
  // the install probe, where an empty value can only fail.
  const [phoneNumberId, setPhoneNumberId] = useState(() =>
    channel?.spec?.providerConfig?.case === "whatsapp"
      ? channel.spec.providerConfig.value.phoneNumberId
      : "",
  );
  // Tool credentials bound at connect time (create mode only — a retry
  // keeps the channel's existing bindings untouched; edits go through
  // the channel card's credentials dialog).
  const [environmentRefs, setEnvironmentRefs] = useState<ResourceRef[]>([]);
  // The serving app — required (DD-WA-2: no platform Meta app exists).
  // Editable in retry mode too: app_ref is server-mutable while the
  // channel isn't installed, and a wrong app is a likely failure cause.
  const [appRef, setAppRef] = useState<ResourceRef | null>(() =>
    channel?.spec?.appRef?.slug
      ? { org: channel.spec.appRef.org || org, slug: channel.spec.appRef.slug }
      : null,
  );
  const [installed, setInstalled] = useState<AgentChannel | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // The org's channel apps, fetched once here so the serving-app picker
  // and the advisory read one consistent list.
  const { channelApps } = useChannelAppList(org || null);
  const whatsappApps = useMemo(
    () => channelApps.filter((app) => app.spec?.providerConfig?.case === "whatsapp"),
    [channelApps],
  );

  // A sole registered app is the only possible choice — preselect it so
  // the required picker never blocks on a decision with one answer
  // (Hick's law). Derived, not effect-synced: apps load async.
  const effectiveAppRef =
    appRef ??
    (whatsappApps.length === 1
      ? { org, slug: whatsappApps[0].metadata?.slug ?? "" }
      : null);
  const selectedApp = effectiveAppRef
    ? whatsappApps.find((app) => app.metadata?.slug === effectiveAppRef.slug) ?? null
    : null;

  // Numbers the selected serving app already serves, matched on the same
  // key the database enforces uniqueness on: (phone number, channel app).
  // Advisory only — the list is permission-bounded; the install stays
  // the arbiter.
  const advisoryActive = deploymentMode === "cloud" && !installed;
  const { channels: orgChannels } = useOrgAgentChannelList(
    advisoryActive && org ? org : null,
  );
  const trimmedNumber = phoneNumberId.trim();
  const alreadyServed = useMemo(() => {
    const selectedAppId = selectedApp?.metadata?.id;
    if (!selectedAppId || !trimmedNumber) return [];
    return orgChannels.filter(
      (c) =>
        c.metadata?.id !== channel?.metadata?.id &&
        c.status?.installState === AgentChannelInstallState.installed &&
        c.status?.providerStatus?.case === "whatsapp" &&
        c.status.providerStatus.value.phoneNumberId === trimmedNumber &&
        c.status.providerStatus.value.channelAppId === selectedAppId,
    );
  }, [orgChannels, selectedApp, trimmedNumber, channel]);

  // One click drives the whole journey: (create/update →) direct
  // install → fetch the installed facts. No popup, so nothing here needs
  // the synchronous-gesture treatment the Slack flow does.
  const handleConnect = useCallback(async () => {
    setError(null);
    try {
      let target = channel;
      if (!target) {
        target = await createChannel({
          name: name.trim() || `${agentName} WhatsApp`,
          org,
          agentRef: {
            org,
            slug: agent.metadata?.slug ?? "",
          },
          enabled: true,
          whatsapp: { phoneNumberId: trimmedNumber },
          ...(effectiveAppRef ? { appRef: effectiveAppRef } : {}),
          ...(environmentRefs.length > 0 ? { environmentRefs } : {}),
        });
        // The channel now exists even if the install below fails —
        // surface it in the list either way.
        onChannelsChanged?.();
      } else {
        // Retry mode: persist edits to the number or app before
        // re-installing. Skipped when nothing changed so a plain retry
        // is one call, not two.
        const existingNumber =
          target.spec?.providerConfig?.case === "whatsapp"
            ? target.spec.providerConfig.value.phoneNumberId
            : "";
        const existingAppSlug = target.spec?.appRef?.slug ?? "";
        if (
          existingNumber !== trimmedNumber ||
          existingAppSlug !== (effectiveAppRef?.slug ?? "")
        ) {
          target = await save({
            ...agentChannelToInput(target),
            whatsapp: { phoneNumberId: trimmedNumber },
            ...(effectiveAppRef ? { appRef: effectiveAppRef } : {}),
          });
          onChannelsChanged?.();
        }
      }

      await installer.install(target.metadata?.id ?? "");
      // The install answer carries no channel — read the recorded facts
      // (display number, verified name) for the success summary.
      const result = await stigmer.agentChannel.get(target.metadata?.id ?? "");
      setInstalled(result);
      onChannelsChanged?.();
    } catch (err) {
      setError(
        installer.error ?? (err instanceof Error ? err : new Error(String(err))),
      );
    }
  }, [agent, agentName, channel, createChannel, effectiveAppRef, environmentRefs, installer, name, org, onChannelsChanged, save, stigmer, trimmedNumber]);

  const busy = isCreating || isSaving || installer.isInProgress;
  const canConnect = trimmedNumber !== "" && effectiveAppRef !== null && !busy;

  return (
    <div className="stg:flex stg:flex-col">
      {/* Header */}
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-3 stg:border-b stg:border-border stg:px-5 stg:py-4">
        <div className="stg:flex stg:items-center stg:gap-2.5">
          <WhatsAppMarkIcon className="stg:size-5 stg:text-foreground" />
          <h2 id={titleId} className="stg:text-sm stg:font-semibold stg:text-foreground">
            {channel ? "Reconnect to WhatsApp" : "Connect to WhatsApp"}
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
          // Preempt the doomed flow: the OSS backend answers every
          // install with FAILED_PRECONDITION.
          <CloudFeatureNotice>
            Channel installs require Stigmer Cloud. The local backend
            manages channel configuration, but connecting to WhatsApp
            verifies your number through Stigmer&apos;s hosted webhook
            infrastructure.
          </CloudFeatureNotice>
        ) : installed ? (
          <InstalledSummary channel={installed} agentName={agentName} />
        ) : busy ? (
          <InstallingIndicator />
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
                  identifies the number if you connect more than one.
                </span>
              </label>
            )}

            <label className="stg:block">
              <span className="stg:mb-1.5 stg:block stg:text-xs stg:font-medium stg:text-foreground">
                Phone number ID
              </span>
              <input
                type="text"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                disabled={busy}
                required
                placeholder="106540352242922"
                data-cursor-target="dialog-whatsapp-number"
                className={cn(
                  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-3 stg:py-1.5",
                  "stg:font-mono stg:text-sm stg:text-foreground stg:placeholder:text-muted-foreground",
                  "stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-ring",
                )}
              />
              <span className="stg:mt-1 stg:block stg:text-xs stg:text-muted-foreground">
                From Meta&apos;s WhatsApp Manager (API Setup) — the numeric
                ID of the number this agent should answer, not the phone
                number itself.
              </span>
            </label>

            <ServingAppSection
              org={org}
              apps={whatsappApps}
              value={effectiveAppRef}
              onChange={setAppRef}
              disabled={busy}
              channelAppsHref={channelAppsHref}
              idPrefix="stgm-whatsapp-app"
              appHint="Your Meta app — its credentials verify and serve the number"
              emptyBody={
                <p className="stg:text-xs stg:text-muted-foreground">
                  WhatsApp channels connect through your own Meta app — there
                  is no shared platform app.{" "}
                  <RegisterChannelAppAffordance channelAppsHref={channelAppsHref}>
                    Register a channel app
                  </RegisterChannelAppAffordance>{" "}
                  with your Meta app&apos;s credentials first, then connect
                  here.
                </p>
              }
            />

            {alreadyServed.length > 0 && (
              <AlreadyServedNote channels={alreadyServed} />
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
              When you continue, Stigmer verifies the number with WhatsApp
              through the selected app&apos;s credentials — the connection
              completes right here, with no browser hand-off.
            </p>
            <p className="stg:text-sm stg:text-muted-foreground">
              People reach the agent by sending a WhatsApp message to the
              connected number — it answers as{" "}
              <span className="stg:font-medium stg:text-foreground">{agentName}</span>.
            </p>
            <p className="stg:text-xs stg:text-muted-foreground">
              Conversations from WhatsApp are billed to{" "}
              <span className="stg:font-medium">{org}</span>. Each number serves
              one agent per channel app.
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
              disabled={!canConnect}
              icon={<WhatsAppMarkIcon className="stg:size-3.5" />}
              data-cursor-target="dialog-connect-whatsapp"
            >
              {error ? "Try again" : channel ? "Reconnect to WhatsApp" : "Connect to WhatsApp"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Install refusal — guided for the duplicate-number reason
// ---------------------------------------------------------------------------

/**
 * The reason code the server attaches (google.rpc.ErrorInfo, domain
 * stigmer.ai) to a duplicate-number initiateInstall refusal — see the
 * initiateInstall rpc comment for the vocabulary.
 */
const REASON_NUMBER_ALREADY_CONNECTED = "WHATSAPP_NUMBER_ALREADY_CONNECTED";

/**
 * Install-refusal rendering. The duplicate-number refusal is the one a
 * user can act on from here, so it gets a guided treatment — names the
 * occupied number (from the ErrorInfo metadata) and the ways out. Every
 * other refusal (bad token, unknown number, dangling app — and any error
 * from a server not attaching reasons) renders the server's copy
 * verbatim — the server owns that vocabulary.
 */
function InstallRefusal({
  error,
  channelAppsHref,
}: {
  readonly error: Error;
  readonly channelAppsHref?: string;
}) {
  const reason = getErrorReason(error);
  if (reason?.reason !== REASON_NUMBER_ALREADY_CONNECTED) {
    return <VerbatimRefusal error={error} />;
  }

  const number = reason.metadata.display_phone_number || "This number";
  return (
    <RefusalBox>
      <p>
        <span className="stg:font-medium">{number}</span> is already connected
        to an agent through this channel app — each number serves one
        agent.
      </p>
      <p>
        To reach it with this agent, disconnect the existing channel, use a
        different number, or{" "}
        <RegisterChannelAppAffordance channelAppsHref={channelAppsHref}>
          register a channel app
        </RegisterChannelAppAffordance>{" "}
        and connect through that instead.
      </p>
    </RefusalBox>
  );
}

/**
 * Pre-install advisory: the selected serving app already serves this
 * number, matched on the exact key the database enforces — (phone
 * number, serving app). Shown before the user spends the install
 * round-trip discovering it. Best-effort by design: the list is bounded
 * by the caller's visibility, so the copy warns rather than forbids.
 */
function AlreadyServedNote({
  channels,
}: {
  readonly channels: readonly AgentChannel[];
}) {
  return (
    <div role="status" className="stg:space-y-0.5 stg:text-xs stg:text-warning">
      {channels.map((c) => {
        const whatsapp =
          c.status?.providerStatus?.case === "whatsapp"
            ? c.status.providerStatus.value
            : null;
        const number =
          whatsapp?.displayPhoneNumber || whatsapp?.phoneNumberId || "this number";
        const agent = c.spec?.agentRef?.slug || "another agent";
        return (
          <p key={c.metadata?.id ?? number}>
            <span className="stg:font-medium">{number}</span> is already served
            via {agent} — each number serves one agent per channel app, so
            disconnect that channel or pick a different number.
          </p>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installing indicator — a single live step, deliberately not a ladder
// ---------------------------------------------------------------------------

/**
 * The busy state of a direct install: one server call, so one live line —
 * not the Slack dialog's three-step OAuth ladder, which would render two
 * permanently-empty rungs here. No cancel affordance either: there is no
 * popup to abandon, and the call settles in seconds.
 */
function InstallingIndicator() {
  return (
    <div className="stg:flex stg:items-center stg:gap-2 stg:text-sm stg:text-foreground" aria-live="polite">
      <Spinner className="stg:size-3.5 stg:shrink-0" />
      Verifying the number with WhatsApp…
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installed summary — the success state with the observed WhatsApp facts
// ---------------------------------------------------------------------------

function InstalledSummary({
  channel,
  agentName,
}: {
  readonly channel: AgentChannel;
  readonly agentName: string;
}) {
  const whatsapp =
    channel.status?.providerStatus?.case === "whatsapp"
      ? channel.status.providerStatus.value
      : null;
  const number = whatsapp?.displayPhoneNumber || whatsapp?.phoneNumberId || null;

  return (
    <div className="stg:space-y-2" role="status">
      <div className="stg:flex stg:items-center stg:gap-2 stg:text-sm stg:font-medium stg:text-foreground">
        <CheckIcon className="stg:size-4 stg:text-success" />
        Connected{number ? ` to ${number}` : ""}
        {whatsapp?.verifiedName ? ` (${whatsapp.verifiedName})` : ""}
      </div>
      <p className="stg:text-sm stg:text-muted-foreground">
        Send a WhatsApp message to{" "}
        <span className="stg:font-medium stg:text-foreground">
          {number ?? "the connected number"}
        </span>{" "}
        and ask your question — answers come from{" "}
        <span className="stg:font-medium stg:text-foreground">{agentName}</span>.
      </p>
    </div>
  );
}
