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
import type { GetOAuthGrantStatusOutput } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { AppShell } from "../../views/AppShell";
import { BrowserView } from "../../views/BrowserView";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import {
  DEMO_BROWSER_ZOOM,
  DEMO_CONTENT_ZOOM,
  DEMO_PLAYER_CLASSES,
} from "../../shared/tokens";
import { PulseHighlight } from "../../shared/PulseHighlight";
import {
  type OAuthConnectStep,
  oauthConnectSteps,
  DEMO_ORG,
  DEMO_SLUG,
  NO_GRANT,
  NO_ORG_OVERRIDE,
} from "./steps";

// ---------------------------------------------------------------------------
// Demo client builder
// ---------------------------------------------------------------------------

const emptyEnvList = () => create(EnvironmentListSchema, {});

function buildClient(
  server: McpServer,
  grant: GetOAuthGrantStatusOutput,
) {
  return createDemoClient(
    buildScenario(
      fixtures.mcpServer.getByReference(() => server),
      fixtures.environment.list(emptyEnvList),
      fixtures.mcpServer.getOAuthGrantStatus(() => grant),
      fixtures.mcpServer.getOrgOAuthApp(() => NO_ORG_OVERRIDE),
    ),
  );
}

// ---------------------------------------------------------------------------
// Step helpers
// ---------------------------------------------------------------------------

function cursorTargetFor(step: OAuthConnectStep): string | undefined {
  switch (step.view) {
    case "click-sign-in":
      return "connect-button";
    case "github-authorize":
      return "authorize-btn";
    default:
      return undefined;
  }
}

function defaultTabFor(step: OAuthConnectStep): "tools" | "policies" {
  return step.view === "connected-policies" ? "policies" : "tools";
}

function contentKeyFor(step: OAuthConnectStep): string {
  switch (step.view) {
    case "detail-preconnect":
    case "click-sign-in":
      return "detail-preconnect";
    case "github-authorize":
      return "github-authorize";
    case "detail-connected":
    case "connected-policies":
      return "detail-connected";
  }
}

function slideDirectionFor(
  step: OAuthConnectStep,
): "forward" | "backward" | undefined {
  if (step.view === "github-authorize") return "forward";
  if (step.view === "detail-connected") return "backward";
  return undefined;
}

// ---------------------------------------------------------------------------
// GitHub authorization page (BrowserView content)
// ---------------------------------------------------------------------------

function GitHubAuthorizePage() {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-b from-background to-muted/30">
      <div className="w-64 rounded-lg border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 text-center">
          <div className="mx-auto mb-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-foreground">
            <svg
              className="h-4 w-4 text-background"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </div>
          <h3 className="text-[11px] font-semibold text-foreground">
            Authorize Stigmer
          </h3>
          <p className="mt-0.5 text-[8px] text-muted-foreground">
            Stigmer by stigmer wants to access your account
          </p>
        </div>

        {/* Scopes */}
        <div className="mb-3 space-y-1.5">
          <ScopeItem icon="repo" label="Repositories" access="Read and write" />
          <ScopeItem icon="org" label="Organizations" access="Read access" />
          <ScopeItem icon="user" label="Profile" access="Read access" />
        </div>

        {/* Authorize CTA */}
        <div className="space-y-1.5">
          <div className="relative" data-cursor-target="authorize-btn">
            <button
              type="button"
              className="w-full rounded-md bg-emerald-600 py-1.5 text-center text-[9px] font-medium text-white"
            >
              Authorize stigmer
            </button>
            <PulseHighlight />
          </div>
          <button
            type="button"
            className="w-full rounded-md border border-border bg-background py-1 text-center text-[9px] font-medium text-foreground"
          >
            Cancel
          </button>
        </div>

        <p className="mt-2 text-center text-[7px] text-muted-foreground">
          Authorizing will redirect to{" "}
          <span className="font-medium text-foreground">app.stigmer.ai</span>
        </p>
      </div>
    </div>
  );
}

function ScopeItem({
  icon,
  label,
  access,
}: {
  icon: "repo" | "org" | "user";
  label: string;
  access: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1">
      <span className="flex h-4 w-4 items-center justify-center text-muted-foreground">
        {icon === "repo" && <RepoIcon />}
        {icon === "org" && <OrgIcon />}
        {icon === "user" && <UserIcon />}
      </span>
      <div className="flex-1">
        <span className="text-[9px] font-medium text-foreground">{label}</span>
        <span className="ml-1 text-[8px] text-muted-foreground">
          — {access}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scope icons
// ---------------------------------------------------------------------------

function RepoIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1h-8a1 1 0 00-1 1v6.708A2.486 2.486 0 014.5 9h8V1.5z" />
    </svg>
  );
}

function OrgIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.5 14.25c0 .138.112.25.25.25H4v-1.25a.75.75 0 01.75-.75h2.5a.75.75 0 01.75.75v1.25h2.25a.25.25 0 00.25-.25V1.75a.25.25 0 00-.25-.25h-8.5a.25.25 0 00-.25.25v12.5zM1.75 16A1.75 1.75 0 010 14.25V1.75C0 .784.784 0 1.75 0h8.5C11.216 0 12 .784 12 1.75v12.5c0 .085-.006.168-.018.25h2.268a.25.25 0 00.25-.25V8.285a.25.25 0 00-.111-.208l-1.055-.703a.75.75 0 11.832-1.248l1.055.703c.487.325.777.871.777 1.456v5.965A1.75 1.75 0 0114.25 16h-3.5a.75.75 0 01-.197-.026c-.099.017-.2.026-.303.026h-3a.75.75 0 01-.75-.75V14h-1v1.25a.75.75 0 01-.75.75h-3zM3 3.75A.75.75 0 013.75 3h.5a.75.75 0 010 1.5h-.5A.75.75 0 013 3.75zM3.75 6a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5zM3 9.75A.75.75 0 013.75 9h.5a.75.75 0 010 1.5h-.5A.75.75 0 013 9.75zM7.75 3a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5zM7 6.75A.75.75 0 017.75 6h.5a.75.75 0 010 1.5h-.5A.75.75 0 017 6.75zM7.75 9a.75.75 0 000 1.5h.5a.75.75 0 000-1.5h-.5z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M10.561 8.073a6.005 6.005 0 013.432 5.142.75.75 0 11-1.498.07 4.5 4.5 0 00-8.99 0 .75.75 0 01-1.498-.07 6.004 6.004 0 013.431-5.142 3.999 3.999 0 115.123 0zM10.5 5a2.5 2.5 0 10-5 0 2.5 2.5 0 005 0z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Exported component
// ---------------------------------------------------------------------------

/**
 * OAuth connect flow playback for the "OAuth for tools" guide.
 *
 * Five-step walkthrough: MCP server detail (pre-connect with "Sign in
 * to connect") → cursor clicks sign-in → GitHub authorization page
 * in BrowserView → connected detail with discovered tools →
 * policies tab showing approval classifications.
 */
export function OAuthConnectFlow() {
  const narrationManifest = useNarrationManifest("oauth-connect-flow");

  const clientMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildClient>>();
    for (const step of oauthConnectSteps) {
      const data = step.data;
      if ("server" in data) {
        const key = `${data.server.metadata?.id ?? ""}:${data.grant.connected}`;
        if (!map.has(key)) {
          map.set(key, buildClient(data.server, data.grant));
        }
      }
    }
    return map;
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: OAuthConnectStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
      <ScenarioPlayer
        steps={oauthConnectSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => {
          if (step.view === "github-authorize") {
            return (
              <BrowserView
                url="github.com/login/oauth/authorize?client_id=Iv1.abc123&scope=repo+read:org+read:user"
                contentKey="github-authorize"
                slideDirection="forward"
                zoom={DEMO_BROWSER_ZOOM}
              >
                <GitHubAuthorizePage />
              </BrowserView>
            );
          }

          const key = `${step.server.metadata?.id ?? ""}:${step.grant.connected}`;
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
                      defaultCapabilityTab={defaultTabFor(step)}
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
