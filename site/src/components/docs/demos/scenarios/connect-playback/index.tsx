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
import type { EnvVarInput } from "@stigmer/sdk";
import { AppShell } from "../../views/AppShell";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { useNarrationManifest } from "../../engine/useNarrationManifest";
import { Cursor } from "../../engine/Cursor";
import { DemoViewport } from "../../engine/DemoViewport";
import { DEMO_CONTENT_ZOOM } from "../../shared/tokens";
import {
  type ConnectStep,
  connectSteps,
  DEMO_ORG,
  DEMO_SLUG,
} from "./steps";

const emptyEnvList = () => create(EnvironmentListSchema, {});

function buildClient(server: McpServer) {
  return createDemoClient(
    buildScenario(
      fixtures.mcpServer.getByReference(() => server),
      fixtures.environment.list(emptyEnvList),
    ),
  );
}

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
  const clientMap = useMemo(() => {
    const map = new Map<McpServer, ReturnType<typeof buildClient>>();
    for (const step of connectSteps) {
      if (!map.has(step.data.server)) {
        map.set(step.data.server, buildClient(step.data.server));
      }
    }
    return map;
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: ConnectStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <DemoViewport containerRef={containerRef}>
      <ScenarioPlayer
        steps={connectSteps}
        narrationManifest={narrationManifest}
        onStepChange={handleStepChange}
      >
        {(step) => (
          <AppShell activeNav="library" contentKey="mcp-detail">
            <StigmerProvider
              key={componentKeyFor(step)}
              client={clientMap.get(step.server)!}
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
            </StigmerProvider>
          </AppShell>
        )}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </DemoViewport>
  );
}
