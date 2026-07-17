"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AgentChannelsPanel, ConnectWhatsAppDialog } from "@stigmer/react";
import { PreviewProvider } from "@scenar/preview/runtime";
import { connectFixture } from "@scenar/preview/connect";
import { create } from "@bufbuild/protobuf";
import { AgentChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/query_pb";
import { AgentChannelListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import { ChannelAppQueryController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/query_pb";
import { ChannelAppsSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/io_pb";
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import { CheckAuthorizationResultSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { AgentChannel } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  ScenarioPlayer,
  useNarrationManifest,
  Cursor,
  useStepInteractions,
  MobileView,
} from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { AppShell } from "../../views/AppShell";
import { DEMO_CONTENT_ZOOM, DEMO_MOBILE_ZOOM } from "../../shared/tokens";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import {
  type ConnectWhatsAppStep,
  connectWhatsAppSteps,
  buildDemoAgent,
  buildInstalledChannel,
  buildWhatsAppApp,
  DEMO_AGENT_SLUG,
  DEMO_DISPLAY_NUMBER,
  DEMO_VERIFIED_NAME,
} from "./steps";

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

function cursorTargetFor(step: ConnectWhatsAppStep): string | undefined {
  switch (step.view) {
    case "click-connect":
      return "connect-whatsapp";
    case "click-dialog-connect":
      return "dialog-connect-whatsapp";
    default:
      return undefined;
  }
}

/** Dialog is visible while it is being filled and while it is clicked. */
function dialogOpenFor(step: ConnectWhatsAppStep): boolean {
  return step.view === "connect-dialog" || step.view === "click-dialog-connect";
}

function isPhoneStep(step: ConnectWhatsAppStep): boolean {
  return step.view === "whatsapp-message" || step.view === "whatsapp-reply";
}

/**
 * Panel remount key: the channel list hook fetches on mount, so the
 * before/after states remount the panel to re-read the fixture ref.
 */
function panelKeyFor(step: ConnectWhatsAppStep): string {
  return step.view === "channels-connected" ? "post-install" : "pre-install";
}

function contentKeyFor(step: ConnectWhatsAppStep): string {
  switch (step.view) {
    case "channels-empty":
    case "click-connect":
      return "channels-pre";
    case "connect-dialog":
    case "click-dialog-connect":
      return "channels-dialog";
    case "channels-connected":
      return "channels-post";
    case "whatsapp-message":
      return "wa-message";
    case "whatsapp-reply":
      return "wa-reply";
  }
}

// ---------------------------------------------------------------------------
// Agent detail frame — scenario-owned chrome around the real panel
// ---------------------------------------------------------------------------

/**
 * Schematic agent-detail header and tab strip so the reader sees where
 * the Channels tab lives. Content-layer JSX owned by this scenario; the
 * tab content itself is the real AgentChannelsPanel.
 */
function AgentDetailFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-4">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-base font-semibold text-foreground">
          {DEMO_AGENT_SLUG}
        </h2>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          Agent
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Handles customer support requests using company knowledge.
      </p>
      <div className="mb-4 flex gap-4 border-b border-border text-xs">
        {["Overview", "Dependencies", "Channels"].map((tab) => (
          <span
            key={tab}
            className={
              tab === "Channels"
                ? "-mb-px border-b-2 border-primary pb-1.5 font-medium text-foreground"
                : "pb-1.5 text-muted-foreground"
            }
          >
            {tab}
          </span>
        ))}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// WhatsApp conversation (MobileView content)
// ---------------------------------------------------------------------------

/**
 * The phone side of the channel: a WhatsApp conversation with the
 * connected business number. Scenario-owned JSX (like the Slack demo's
 * consent page) styled with WhatsApp's brand colors — Scenar's generic
 * ChatView renders iMessage-blue bubbles and cannot carry the brand.
 */
function WhatsAppConversation({ replied }: { readonly replied: boolean }) {
  return (
    <div className="flex h-full flex-col bg-[#ECE5DD] pt-10">
      {/* Chat header: the business identity people see — the verified
          name, and "typing…" while the agent works on the reply. */}
      <div className="flex items-center gap-2.5 bg-[#008069] px-3 py-2 text-white">
        <svg className="h-4 w-4 shrink-0 text-white/90" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7.5 2.5 4 6l3.5 3.5" />
        </svg>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/25 text-xs font-semibold">
          A
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">
            {DEMO_VERIFIED_NAME}
          </p>
          <p className="truncate text-xs leading-tight text-white/80">
            {replied ? DEMO_DISPLAY_NUMBER : "typing…"}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col justify-end gap-1.5 px-3 pb-3">
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-lg rounded-tr-none bg-[#D9FDD3] px-2.5 py-1.5 shadow-sm">
            <p className="text-sm text-neutral-900">
              Hi! Can I return a blender I already opened?
            </p>
            <p className="mt-0.5 text-right text-xs text-neutral-500">
              9:41{" "}
              <span className="text-[#53BDEB]" aria-hidden="true">
                ✓✓
              </span>
            </p>
          </div>
        </div>

        {replied && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white px-2.5 py-1.5 shadow-sm">
              <p className="text-sm text-neutral-900">
                Yes — opened items can be returned within 30 days as long as
                you have the receipt. Want me to email you a return label?
              </p>
              <p className="mt-0.5 text-right text-xs text-neutral-500">9:42</p>
            </div>
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-2 px-2 pb-3">
        <div className="flex-1 rounded-full bg-white px-3 py-2 text-sm text-neutral-400 shadow-sm">
          Message
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#008069] text-white">
          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 1a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 8 1Zm-4 6.5a.75.75 0 0 1 1.5 0 2.5 2.5 0 0 0 5 0 .75.75 0 0 1 1.5 0 4 4 0 0 1-3.25 3.93v1.82h1.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5h1.5v-1.82A4 4 0 0 1 4 7.5Z" />
          </svg>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

const noop = () => undefined;

/**
 * Connect-an-agent-to-WhatsApp playback for the "Connect an Agent to
 * WhatsApp" guide.
 *
 * Seven-step walkthrough: Channels tab empty state → cursor clicks
 * Connect → the real ConnectWhatsAppDialog over the tab (the cursor
 * types the phone number ID into the real input) → cursor clicks the
 * dialog's connect button → the tab with the installed channel card →
 * WhatsApp on a phone: a message to the number, then the agent's reply.
 */
export function ConnectWhatsAppChannel() {
  const narrationManifest = useNarrationManifest("connect-whatsapp-channel");

  const demoAgent = useMemo(() => buildDemoAgent(), []);
  const installedChannel = useMemo(() => buildInstalledChannel(), []);
  const whatsappApp = useMemo(() => buildWhatsAppApp(), []);

  // The panel's channel list per playback position; the render callback
  // updates it and the panel remounts (panelKeyFor) to re-fetch.
  const currentChannelsRef = useRef<readonly AgentChannel[]>([]);

  const previewFixtures = useMemo(
    () => [
      connectFixture(AgentChannelQueryController, "getByAgent", () =>
        create(AgentChannelListSchema, {
          totalCount: currentChannelsRef.current.length,
          items: [...currentChannelsRef.current],
        }),
      ),
      // The dialog's pre-install advisory reads the org-wide list; empty
      // means no "already served" note — the happy path.
      connectFixture(AgentChannelQueryController, "list", () =>
        create(AgentChannelListSchema, {}),
      ),
      // The org's registered Meta app, present in EVERY step: the dialog
      // preselects it as the sole serving app, and the installed card
      // resolves its serving-app name from this list.
      connectFixture(ChannelAppQueryController, "listByOrg", () =>
        create(ChannelAppsSchema, { entries: [whatsappApp] }),
      ),
      // The panel gates its connect affordance on the caller's real
      // permissions; the demo viewer is an editor.
      connectFixture(IamPolicyQueryController, "checkMyPermission", () =>
        create(CheckAuthorizationResultSchema, { isAuthorized: true }),
      ),
    ],
    [whatsappApp],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (step: ConnectWhatsAppStep, index: number) => {
      setCursorTarget(cursorTargetFor(step));
      setStepIndex(index);
    },
    [],
  );

  useStepInteractions({
    stepIndex,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps: connectWhatsAppSteps,
  });

  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={connectWhatsAppSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => {
            if (isPhoneStep(step)) {
              return (
                <MobileView
                  contentKey={contentKeyFor(step)}
                  slideDirection="forward"
                  zoom={DEMO_MOBILE_ZOOM}
                >
                  <WhatsAppConversation replied={step.view === "whatsapp-reply"} />
                </MobileView>
              );
            }

            currentChannelsRef.current =
              step.view === "channels-connected" ? [installedChannel] : [];
            const dialogOpen = dialogOpenFor(step);

            return (
              <AppShell
                activeNav="library"
                contentKey={contentKeyFor(step)}
                slideDirection={
                  step.view === "channels-connected" ? "forward" : undefined
                }
              >
                <div
                  className="relative h-full overflow-y-auto"
                  style={{ zoom: DEMO_CONTENT_ZOOM }}
                >
                  <AgentDetailFrame>
                    <AgentChannelsPanel
                      key={panelKeyFor(step)}
                      agent={demoAgent}
                    />
                  </AgentDetailFrame>

                  {/* The real connect dialog rendered in-flow over the
                      tab (modal={false}: no top layer, no focus trap),
                      keeping the page visible behind it. */}
                  {dialogOpen && (
                    <div className="absolute inset-0 flex items-start justify-center bg-black/40 pt-8">
                      <ConnectWhatsAppDialog
                        open
                        modal={false}
                        onOpenChange={noop}
                        agent={demoAgent}
                      />
                    </div>
                  )}
                </div>
              </AppShell>
            );
          }}
        </ScenarioPlayer>
        <Cursor target={cursorTarget} containerRef={containerRef} />
      </StigmerDemoViewport>
    </PreviewProvider>
  );
}
