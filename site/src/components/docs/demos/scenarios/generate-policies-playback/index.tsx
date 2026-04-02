"use client";

import { useMemo } from "react";
import { StigmerProvider, McpServerDetailView } from "@stigmer/react";
import {
  createDemoClient,
  buildScenario,
  fixtures,
} from "@stigmer/react/demo";
import { create } from "@bufbuild/protobuf";
import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { AppShell } from "../../views/AppShell";
import { ScenarioPlayer } from "../../engine/ScenarioPlayer";
import { DEMO_DETAIL_CLASSES, DEMO_PLAYER_CLASSES } from "../../shared/tokens";
import {
  generatePoliciesSteps,
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

export function GeneratePoliciesPlayback() {
  const clientMap = useMemo(() => {
    const map = new Map<McpServer, ReturnType<typeof buildClient>>();
    for (const step of generatePoliciesSteps) {
      if (!map.has(step.data.server)) {
        map.set(step.data.server, buildClient(step.data.server));
      }
    }
    return map;
  }, []);

  return (
    <div className={DEMO_PLAYER_CLASSES}>
      <ScenarioPlayer steps={generatePoliciesSteps}>
        {(step) => (
          <StigmerProvider client={clientMap.get(step.server)!}>
            <AppShell activeNav="library" contentKey="mcp-detail">
              <div className={DEMO_DETAIL_CLASSES}>
                <div className="p-4">
                  <McpServerDetailView
                    org={DEMO_ORG}
                    slug={DEMO_SLUG}
                    defaultCapabilityTab="policies"
                  />
                </div>
              </div>
            </AppShell>
          </StigmerProvider>
        )}
      </ScenarioPlayer>
    </div>
  );
}
