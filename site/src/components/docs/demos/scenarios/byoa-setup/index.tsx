"use client";

import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import { McpServerDetailView } from "@stigmer/react";
import { PreviewProvider } from "@scenar/preview/runtime";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { create } from "@bufbuild/protobuf";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type {
  GetOAuthGrantStatusOutput,
  GetOrgOAuthAppOutput,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ScenarioPlayer, useNarrationManifest, Cursor, useStepInteractions, PulseHighlight } from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { connectFixture } from "@scenar/preview/connect";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { AppShell } from "../../views/AppShell";
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import {
  type ByoaSetupStep,
  byoaSetupSteps,
  DEMO_ORG,
  DEMO_SLUG,
} from "./steps";

const emptyEnvList = () => create(EnvironmentListSchema, {});

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

function cursorTargetFor(step: ByoaSetupStep): string | undefined {
  switch (step.view) {
    case "click-byoa-cta":
      return "byoa-cta-button";
    case "click-save":
      return "byoa-save-button";
    default:
      return undefined;
  }
}

function contentKeyFor(step: ByoaSetupStep): string {
  switch (step.view) {
    case "detail-blocked":
    case "click-byoa-cta":
      return "detail-blocked";
    case "byoa-dialog":
    case "click-save":
      return "byoa-dialog";
    case "detail-org-app":
      return "detail-org-app";
    case "detail-connected":
      return "detail-connected";
  }
}

function slideDirectionFor(
  step: ByoaSetupStep,
): "forward" | "backward" | undefined {
  if (step.view === "byoa-dialog") return "forward";
  if (step.view === "detail-org-app") return "backward";
  return undefined;
}

// ---------------------------------------------------------------------------
// BYOA dialog card (authored at normal scale — DEMO_CONTENT_ZOOM handles sizing)
// ---------------------------------------------------------------------------

function ByoaDialogCard({ filled }: { readonly filled: boolean }) {
  return (
    <div className="w-80 rounded-lg border border-border bg-card p-5 shadow-lg">
      <h3 className="mb-3 text-sm font-semibold text-foreground">
        Use your own OAuth app
      </h3>

      <div className="space-y-1.5">
        <p className="text-xs text-foreground">
          Register an OAuth app with{" "}
          <span className="font-medium">Slack</span> and enter your
          credentials below.
        </p>
        <a
          href="https://api.slack.com/authentication/oauth-v2"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary underline decoration-primary/40 underline-offset-2"
        >
          Slack OAuth app registration
          <ExternalLinkIcon />
        </a>
      </div>

      <div className="mt-4 flex flex-col gap-3" data-cursor-target="byoa-client-id">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-foreground">
            Client ID
          </label>
          <div className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground">
            {filled ? (
              "7892341056.apps"
            ) : (
              <span className="text-muted-foreground">
                e.g. 1234567890abcdef
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1" data-cursor-target="byoa-client-secret">
          <label className="text-xs font-medium text-foreground">
            Client Secret
          </label>
          <div className="rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground">
            {filled ? (
              "••••••••••••••••"
            ) : (
              <span className="text-muted-foreground">
                Your client secret
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-md px-3 py-1.5 text-xs text-muted-foreground"
        >
          Cancel
        </button>
        <div className="relative" data-cursor-target="byoa-save-button">
          <button
            type="button"
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            Save
          </button>
          {filled && <PulseHighlight />}
        </div>
      </div>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.5H3.5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V10" />
      <path d="M9.5 2.5h4v4" />
      <path d="M13.5 2.5 8 8" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * BYOA setup playback for the "Bring Your Own OAuth App" guide.
 *
 * Six-step walkthrough: Slack MCP server detail (vendor approval
 * pending, sign-in disabled) → cursor clicks BYOA CTA → dialog
 * overlay with credentials form → cursor clicks Save → detail
 * showing "Using your OAuth app" → connected with tools discovered.
 */
export function ByoaSetup() {
  const narrationManifest = useNarrationManifest("byoa-setup");

  const currentServerRef = useRef<McpServer>(null!);
  const currentGrantRef = useRef<GetOAuthGrantStatusOutput>(null!);
  const currentOrgAppRef = useRef<GetOrgOAuthAppOutput>(null!);

  const previewFixtures = useMemo(
    () => [
      connectFixture(McpServerQueryController, "getByReference", () => currentServerRef.current),
      connectFixture(EnvironmentQueryController, "list", emptyEnvList),
      connectFixture(McpServerQueryController, "getOAuthGrantStatus", () => currentGrantRef.current),
      connectFixture(McpServerQueryController, "getOrgOAuthApp", () => currentOrgAppRef.current),
    ],
    [],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();
  const [stepIndex, setStepIndex] = useState(0);

  const handleStepChange = useCallback(
    (step: ByoaSetupStep, index: number) => {
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
    steps: byoaSetupSteps,
  });

  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={byoaSetupSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => {
            currentServerRef.current = step.server;
            currentGrantRef.current = step.grant;
            currentOrgAppRef.current = step.orgApp;
            const componentKey = `${step.server.metadata?.id ?? ""}:${step.grant.connected}:${step.orgApp.hasOverride}`;

            if (step.view === "byoa-dialog" || step.view === "click-save") {
              return (
                <AppShell
                  activeNav="library"
                  contentKey="byoa-dialog"
                  slideDirection={slideDirectionFor(step)}
                >
                  <Fragment key={`dialog-${componentKey}`}>
                    <div
                      className="absolute inset-0 overflow-y-auto"
                      style={{ zoom: DEMO_CONTENT_ZOOM }}
                    >
                      <div className="p-4">
                        <McpServerDetailView
                          org={DEMO_ORG}
                          slug={DEMO_SLUG}
                          defaultCapabilityTab="tools"
                        />
                      </div>
                    </div>
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60" data-scroll-target="byoa-dialog-card">
                      <div style={{ zoom: DEMO_CONTENT_ZOOM }}>
                        <ByoaDialogCard
                          filled={step.view === "click-save"}
                        />
                      </div>
                    </div>
                  </Fragment>
                </AppShell>
              );
            }

            return (
              <AppShell
                activeNav="library"
                contentKey={contentKeyFor(step)}
                slideDirection={slideDirectionFor(step)}
              >
                <div
                  key={componentKey}
                  data-scroll-container
                  className="h-full overflow-y-auto"
                  style={{ zoom: DEMO_CONTENT_ZOOM }}
                >
                  <div className="p-4">
                    <McpServerDetailView
                      org={DEMO_ORG}
                      slug={DEMO_SLUG}
                      defaultCapabilityTab="tools"
                    />
                    <div data-scroll-target="capabilities-bottom" />
                  </div>
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
