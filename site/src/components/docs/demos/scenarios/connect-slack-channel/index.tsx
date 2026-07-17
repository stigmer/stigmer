"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AgentChannelsPanel, ConnectSlackDialog } from "@stigmer/react";
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
  BrowserView,
  PulseHighlight,
} from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { AppShell } from "../../views/AppShell";
import { DEMO_BROWSER_ZOOM, DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import {
  type ConnectSlackStep,
  connectSlackSteps,
  buildDemoAgent,
  buildInstalledChannel,
  DEMO_AGENT_SLUG,
  DEMO_WORKSPACE,
} from "./steps";

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

function cursorTargetFor(step: ConnectSlackStep): string | undefined {
  switch (step.view) {
    case "click-connect":
      return "connect-slack";
    case "click-dialog-connect":
      return "dialog-connect-slack";
    default:
      return undefined;
  }
}

/** Dialog is visible while it is being filled and while it is clicked. */
function dialogOpenFor(step: ConnectSlackStep): boolean {
  return step.view === "connect-dialog" || step.view === "click-dialog-connect";
}

/**
 * Panel remount key: the channel list hook fetches on mount, so the
 * before/after states remount the panel to re-read the fixture ref.
 */
function panelKeyFor(step: ConnectSlackStep): string {
  return step.view === "channels-connected" ? "post-install" : "pre-install";
}

function contentKeyFor(step: ConnectSlackStep): string {
  switch (step.view) {
    case "channels-empty":
    case "click-connect":
      return "channels-pre";
    case "connect-dialog":
    case "click-dialog-connect":
      return "channels-dialog";
    case "slack-consent":
      return "slack-consent";
    case "channels-connected":
      return "channels-post";
  }
}

function slideDirectionFor(
  step: ConnectSlackStep,
): "forward" | "backward" | undefined {
  if (step.view === "slack-consent") return "forward";
  if (step.view === "channels-connected") return "backward";
  return undefined;
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
// Slack consent page (BrowserView content)
// ---------------------------------------------------------------------------

function SlackConsentPage() {
  return (
    <div className="flex h-full flex-col bg-white">
      {/* Slack page header with the workspace picker — the detail the
          guide warns about: Slack preselects the signed-in workspace. */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-bold tracking-tight text-[#4A154B]">
          slack
        </span>
        <div className="relative" data-cursor-target="workspace-picker">
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md border border-border bg-white px-2 py-1 text-xs font-medium text-neutral-800"
          >
            <span className="flex h-4 w-4 items-center justify-center rounded bg-[#4A154B] text-[0.55rem] font-bold text-white">
              A
            </span>
            {DEMO_WORKSPACE}
            <svg className="h-2.5 w-2.5 text-neutral-500" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m3 4.5 3 3 3-3" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center">
        <div className="w-80 px-4 text-center">
          <h3 className="text-sm font-bold text-neutral-900">
            Stigmer is requesting permission to access the {DEMO_WORKSPACE}{" "}
            Slack workspace
          </h3>

          <div className="mt-4 rounded-lg border border-border bg-neutral-50 p-3 text-left">
            <p className="mb-2 text-xs font-semibold text-neutral-800">
              What will Stigmer be able to do?
            </p>
            <ul className="space-y-1.5 text-xs text-neutral-600">
              <li>View messages that directly mention @Stigmer</li>
              <li>View direct messages with @Stigmer</li>
              <li>Send messages as @Stigmer</li>
              <li>Act as an AI assistant in threads</li>
            </ul>
          </div>

          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              className="rounded-md border border-border bg-white px-4 py-1.5 text-xs font-medium text-neutral-800"
            >
              Cancel
            </button>
            <div className="relative" data-cursor-target="allow-btn">
              <button
                type="button"
                className="rounded-md bg-emerald-700 px-4 py-1.5 text-xs font-medium text-white"
              >
                Allow
              </button>
              <PulseHighlight />
            </div>
          </div>

          <p className="mt-3 text-xs text-neutral-500">
            You&apos;ll be redirected back to{" "}
            <span className="font-medium text-neutral-700">app.stigmer.ai</span>
          </p>
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
 * Connect-an-agent-to-Slack playback for the "Connect an Agent to
 * Slack" guide.
 *
 * Six-step walkthrough: Channels tab empty state → cursor clicks
 * Connect → the real ConnectSlackDialog over the tab → cursor clicks
 * the dialog's connect button → Slack's consent page (workspace picker
 * called out) → the tab with the installed channel card.
 */
export function ConnectSlackChannel() {
  const narrationManifest = useNarrationManifest("connect-slack-channel");

  const demoAgent = useMemo(() => buildDemoAgent(), []);
  const installedChannel = useMemo(() => buildInstalledChannel(), []);

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
      // The dialog's pre-OAuth advisory reads the org-wide list; empty
      // means no "already serves this workspace" note — the happy path.
      connectFixture(AgentChannelQueryController, "list", () =>
        create(AgentChannelListSchema, {}),
      ),
      // No BYO channel apps: the dialog's "Connect as" states the
      // platform default, matching a first connect.
      connectFixture(ChannelAppQueryController, "listByOrg", () =>
        create(ChannelAppsSchema, {}),
      ),
      // The panel gates its connect affordance on the caller's real
      // permissions; the demo viewer is an editor.
      connectFixture(IamPolicyQueryController, "checkMyPermission", () =>
        create(CheckAuthorizationResultSchema, { isAuthorized: true }),
      ),
    ],
    [],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (step: ConnectSlackStep, index: number) => {
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
    steps: connectSlackSteps,
  });

  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={connectSlackSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => {
            if (step.view === "slack-consent") {
              return (
                <BrowserView
                  url="slack.com/oauth/v2/authorize?scope=app_mentions:read+chat:write+im:history+assistant:write"
                  contentKey="slack-consent"
                  slideDirection="forward"
                  zoom={DEMO_BROWSER_ZOOM}
                >
                  <SlackConsentPage />
                </BrowserView>
              );
            }

            currentChannelsRef.current =
              step.view === "channels-connected" ? [installedChannel] : [];
            const dialogOpen = dialogOpenFor(step);

            return (
              <AppShell
                activeNav="library"
                contentKey={contentKeyFor(step)}
                slideDirection={slideDirectionFor(step)}
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
                      <ConnectSlackDialog
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
