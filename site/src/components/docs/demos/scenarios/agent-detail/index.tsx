"use client";

import { useMemo } from "react";
import { StigmerProvider, AgentDetailView } from "@stigmer/react";
import {
  createDemoClient,
  buildScenario,
  fixtures,
  samples,
} from "@stigmer/react/demo";
import { create } from "@bufbuild/protobuf";
import { AgentSpecSchema, McpServerUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { DEMO_DETAIL_CLASSES } from "../../shared/tokens";

const DEMO_ORG = "acme";

function buildDemoAgent() {
  const agent = samples.agent({
    name: "support-agent",
    org: DEMO_ORG,
    description:
      "Handles customer support requests — answers questions using company knowledge, looks up orders, and processes returns with human approval.",
    instructions: [
      "You are a customer support agent for Acme Corp.",
      "",
      "Use the company knowledge base to answer product questions.",
      "When customers ask about orders, look up the order details",
      "using the available tools before responding.",
      "",
      "For returns and refunds, always ask for human approval",
      "before processing. Never process a refund without approval.",
    ].join("\n"),
  });

  agent.spec = create(AgentSpecSchema, {
    description: agent.spec!.description,
    instructions: agent.spec!.instructions,
    mcpServerUsages: [
      create(McpServerUsageSchema, {
        mcpServerRef: create(ApiResourceReferenceSchema, {
          kind: ApiResourceKind.mcp_server,
          slug: "order-management-api",
        }),
        enabledTools: ["get_order", "list_orders", "process_return"],
        toolApprovalOverrides: [],
      }),
    ],
    skillRefs: [
      create(ApiResourceReferenceSchema, {
        kind: ApiResourceKind.skill,
        slug: "company-knowledge-base",
      }),
      create(ApiResourceReferenceSchema, {
        kind: ApiResourceKind.skill,
        slug: "return-policy",
      }),
    ],
    env: {
      ORDER_API_URL: create(EnvVarDeclarationSchema, {
        isSecret: false,
        description: "Base URL of the order management API",
      }),
      ORDER_API_KEY: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description: "API key for authenticating with the order management service",
      }),
    },
  });

  return agent;
}

export function AgentDetail() {
  const client = useMemo(() => {
    const agent = buildDemoAgent();
    const scenario = buildScenario(
      fixtures.agent.getByReference(() => agent),
    );
    return createDemoClient(scenario);
  }, []);

  return (
    <StigmerProvider client={client}>
      <div className={DEMO_DETAIL_CLASSES}>
        <div className="p-4">
          <AgentDetailView org={DEMO_ORG} slug="support-agent" />
        </div>
      </div>
    </StigmerProvider>
  );
}
