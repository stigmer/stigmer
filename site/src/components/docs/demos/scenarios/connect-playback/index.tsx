"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { McpServerDetailView } from "@stigmer/react";
import { PreviewProvider } from "@scenar/preview/runtime";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { create } from "@bufbuild/protobuf";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { EnvVarInput } from "@stigmer/sdk";
import { ScenarioPlayer, useNarrationManifest, Cursor } from "@scenar/react";
import { PreviewProviders } from "../../../../../../.scenar/providers";
import { connectFixture } from "../../shared/preview-helpers";
import { AppShell } from "../../views/AppShell";
import { StigmerDemoViewport } from "../../shared/StigmerDemoViewport";
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import {
  type ConnectStep,
  connectSteps,
  DEMO_ORG,
  DEMO_SLUG,
} from "./steps";

const emptyEnvList = () => create(EnvironmentListSchema, {});

const CREDENTIAL_POOL: Record<string, EnvVarInput> = {
  API_KEY: {
    value: "sk-acme-ord-a8f29c7e1d",
    isSecret: true,
    description: "API key for order management authentication.",
  },
};

function credentialPoolLookup(key: string): EnvVarInput | undefined {
  return CREDENTIAL_POOL[key];
}

function cursorTargetFor(step: ConnectStep): string | undefined {
  switch (step.view) {
    case "click-connect":
      return "connect-button";
    case "credential-form":
      return "credential-form";
    case "credential-filled":
      return "env-form-submit";
    default:
      return undefined;
  }
}

function showCredentialFormFor(step: ConnectStep): boolean {
  return step.view === "credential-form" || step.view === "credential-filled";
}

function defaultTabFor(step: ConnectStep): "tools" | "policies" {
  return step.view === "connected-policies" ? "policies" : "tools";
}

/**
 * Compute a stable React key that only changes when the component
 * state needs to reinitialize (credential form, pool values, server, tab).
 * Steps that only differ in scroll position or cursor share the
 * same key so the component stays mounted and scroll persists.
 */
function componentKeyFor(step: ConnectStep): string {
  switch (step.view) {
    case "no-tools":
    case "click-connect":
      return "base";
    case "credential-form":
      return "cred-form";
    case "credential-filled":
      return "cred-filled";
    case "connected-tools":
      return "connected-tools";
    case "connected-policies":
      return "connected-policies";
  }
}

export function ConnectPlayback() {
  const narrationManifest = useNarrationManifest("connect-playback");
  const currentServerRef = useRef<McpServer>(connectSteps[0].data.server);

  const previewFixtures = useMemo(
    () => [
      connectFixture(McpServerQueryController, "getByReference", () => currentServerRef.current),
      connectFixture(EnvironmentQueryController, "list", emptyEnvList),
    ],
    [],
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: ConnectStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <PreviewProvider providers={PreviewProviders} fixtures={previewFixtures}>
      <StigmerDemoViewport containerRef={containerRef}>
        <ScenarioPlayer
          steps={connectSteps}
          narrationManifest={narrationManifest}
          onStepChange={handleStepChange}
        >
          {(step) => {
            currentServerRef.current = step.server;
            return (
              <AppShell activeNav="library" contentKey="mcp-detail">
                <div
                  key={componentKeyFor(step)}
                  data-scroll-container
                  className="h-full overflow-y-auto"
                  style={{ zoom: DEMO_CONTENT_ZOOM }}
                >
                  <div className="p-4">
                    <McpServerDetailView
                      org={DEMO_ORG}
                      slug={DEMO_SLUG}
                      defaultShowCredentialForm={showCredentialFormFor(step)}
                      defaultCapabilityTab={defaultTabFor(step)}
                      credentialPoolValues={
                        step.view === "credential-filled"
                          ? credentialPoolLookup
                          : undefined
                      }
                    />
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
