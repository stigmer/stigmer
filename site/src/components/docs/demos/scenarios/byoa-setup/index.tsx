"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { StigmerProvider, McpServerDetailView } from "@stigmer/react";
import {
  createDemoClient,
  buildScenario,
  fixtures,
} from "@stigmer/react/demo";
import { create } from "@bufbuild/protobuf";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type {
  GetOAuthGrantStatusOutput,
  GetOrgOAuthAppOutput,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { AppShell } from "../../views/AppShell";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import { PulseHighlight } from "../../shared/PulseHighlight";
import { DEMO_CONTENT_ZOOM, DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type ByoaSetupStep,
  byoaSetupSteps,
  DEMO_ORG,
  DEMO_SLUG,
  NO_GRANT,
  NO_ORG_OVERRIDE,
  HAS_ORG_OVERRIDE,
} from "./steps";

// ---------------------------------------------------------------------------
// Demo client builder
// ---------------------------------------------------------------------------

const emptyEnvList = () => create(EnvironmentListSchema, {});

function buildClient(
  server: McpServer,
  grant: GetOAuthGrantStatusOutput,
  orgApp: GetOrgOAuthAppOutput,
) {
  return createDemoClient(
    buildScenario(
      fixtures.mcpServer.getByReference(() => server),
      fixtures.environment.list(emptyEnvList),
      fixtures.mcpServer.getOAuthGrantStatus(() => grant),
      fixtures.mcpServer.getOrgOAuthApp(() => orgApp),
    ),
  );
}

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
// BYOA dialog overlay (hand-built to match production <dialog>)
// ---------------------------------------------------------------------------

function ByoaDialogOverlay({ filled }: { readonly filled: boolean }) {
  return (
    <div className="relative flex h-full items-center justify-center">
      {/* Dimmed detail view behind the dialog */}
      <div className="absolute inset-0 bg-background/60" />

      {/* Dialog card */}
      <div className="relative z-10 w-72 rounded-lg border border-border bg-card p-4 shadow-lg">
        <h3 className="mb-3 text-[11px] font-semibold text-foreground">
          Use your own OAuth app
        </h3>

        <div className="space-y-1.5">
          <p className="text-[9px] text-foreground">
            Register an OAuth app with{" "}
            <span className="font-medium">Slack</span> and enter your
            credentials below.
          </p>
          <a
            href="https://api.slack.com/authentication/oauth-v2"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[8px] text-primary underline decoration-primary/40 underline-offset-2"
          >
            Slack OAuth app registration
            <ExternalLinkIcon />
          </a>
        </div>

        {/* Fields */}
        <div className="mt-3 flex flex-col gap-2.5">
          <div className="flex flex-col gap-1">
            <label className="text-[8px] font-medium text-foreground">
              Client ID
            </label>
            <div className="rounded-md border border-input bg-background px-2 py-1.5 text-[9px] text-foreground">
              {filled ? (
                "7892341056.apps"
              ) : (
                <span className="text-muted-foreground">
                  e.g. 1234567890abcdef
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[8px] font-medium text-foreground">
              Client Secret
            </label>
            <div className="rounded-md border border-input bg-background px-2 py-1.5 text-[9px] text-foreground">
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

        {/* Actions */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-2.5 py-1 text-[9px] text-muted-foreground"
          >
            Cancel
          </button>
          <div className="relative" data-cursor-target="byoa-save-button">
            <button
              type="button"
              className="inline-flex items-center rounded-md bg-primary px-2.5 py-1 text-[9px] font-medium text-primary-foreground"
            >
              Save
            </button>
            {filled && <PulseHighlight />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      className="h-2.5 w-2.5 shrink-0"
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

  const clientMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildClient>>();
    for (const step of byoaSetupSteps) {
      const data = step.data;
      if ("server" in data) {
        const key = `${data.server.metadata?.id ?? ""}:${data.grant.connected}:${data.orgApp.hasOverride}`;
        if (!map.has(key)) {
          map.set(key, buildClient(data.server, data.grant, data.orgApp));
        }
      }
    }
    return map;
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: ByoaSetupStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
      <ScenarioPlayer
        steps={byoaSetupSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => {
          if (step.view === "byoa-dialog" || step.view === "click-save") {
            return (
              <AppShell
                activeNav="library"
                contentKey="byoa-dialog"
                slideDirection={slideDirectionFor(step)}
              >
                <div style={{ zoom: DEMO_CONTENT_ZOOM }}>
                  <ByoaDialogOverlay filled={step.view === "click-save"} />
                </div>
              </AppShell>
            );
          }

          const key = `${step.server.metadata?.id ?? ""}:${step.grant.connected}:${step.orgApp.hasOverride}`;
          const client = clientMap.get(key)!;

          return (
            <StigmerProvider key={key} client={client}>
              <AppShell
                activeNav="library"
                contentKey={contentKeyFor(step)}
                slideDirection={slideDirectionFor(step)}
              >
                <div
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
                  </div>
                </div>
              </AppShell>
            </StigmerProvider>
          );
        }}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </div>
  );
}
