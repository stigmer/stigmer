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
import { Cursor } from "../../engine/Cursor";
import { DEMO_CONTENT_ZOOM, DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  type DiscoverStep,
  discoverSteps,
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

function cursorTargetFor(step: DiscoverStep): string | undefined {
  switch (step.view) {
    case "click-discover":
      return "discover-button";
    case "credential-form":
      return "credential-form";
    case "credential-filled":
      return "env-form-submit";
    default:
      return undefined;
  }
}

function showCredentialFormFor(step: DiscoverStep): boolean {
  return step.view === "credential-form" || step.view === "credential-filled";
}

export function DiscoverCapabilitiesPlayback() {
  const clientMap = useMemo(() => {
    const map = new Map<McpServer, ReturnType<typeof buildClient>>();
    for (const step of discoverSteps) {
      if (!map.has(step.data.server)) {
        map.set(step.data.server, buildClient(step.data.server));
      }
    }
    return map;
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const [cursorTarget, setCursorTarget] = useState<string | undefined>();

  const handleStepChange = useCallback((step: DiscoverStep) => {
    setCursorTarget(cursorTargetFor(step));
  }, []);

  return (
    <div ref={containerRef} className={DEMO_PLAYER_CLASSES}>
      <ScenarioPlayer steps={discoverSteps} onStepChange={handleStepChange}>
        {(step) => (
          <StigmerProvider
            key={step.view}
            client={clientMap.get(step.server)!}
          >
            <AppShell activeNav="library" contentKey="mcp-detail">
              <div
                className="h-full overflow-y-auto"
                style={{ zoom: DEMO_CONTENT_ZOOM }}
              >
                <div className="p-4">
                  <McpServerDetailView
                    org={DEMO_ORG}
                    slug={DEMO_SLUG}
                    defaultShowCredentialForm={showCredentialFormFor(step)}
                    credentialPoolValues={
                      step.view === "credential-filled"
                        ? credentialPoolLookup
                        : undefined
                    }
                  />
                </div>
              </div>
            </AppShell>
          </StigmerProvider>
        )}
      </ScenarioPlayer>
      <Cursor target={cursorTarget} containerRef={containerRef} />
    </div>
  );
}
