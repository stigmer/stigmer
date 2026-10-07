// Conformance suite for deleting an organization while one of its runs is
// live (Class B: the purge's engine arm).
// Domain: tenancy / organization, agentic / agentexecution.
//
// The contract under test: a run parked at an approval gate is live in the
// engine. Deleting its organization answers at once; from then the run
// answers NOT_FOUND to a read and to a decision on its gate, so nobody can
// resume it. The purge terminates the run before it removes the run's row
// (it does not finish while the engine holds a run that may still be live),
// and only then releases the organization's slug, so a slug that comes free
// is the purge's proof that the run was stopped and removed.
import { Code } from "@connectrpc/connect";
import { ApprovalAction, RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUses } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { DESTRUCTIVE_ECHO_TOOL_NAME } from "../harness/mcp-server";
import { agentRefOf, makeAgent } from "../support/agents";
import {
  awaitPhase,
  createConnectedMcpServer,
  makeAgentExecution,
  requireLlmProxy,
  requireMcpFixture,
} from "../support/agentruns";
import { uniqueName } from "../support/naming";
import { createOrganizationOnceReleased, organizationSlug } from "../support/organizations";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  mcp = requireMcpFixture(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

describe("Organization purge with a live run", () => {
  it("[rpc:OrganizationCommandController.delete] [rpc:AgentRunQueryController.get] [rpc:AgentRunCommandController.submitApproval] a run parked at a gate answers not found once its organization is deleted, and the purge stops and removes it before the slug comes free", async () => {
    const { org } = await target.provisionTenancy();
    const slug = await organizationSlug(clients.organizationQuery, org);
    const server = await createConnectedMcpServer(clients, mcp, fixtures, {
      org,
      name: uniqueName("mcp"),
      tools: [DESTRUCTIVE_ECHO_TOOL_NAME],
    });
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-purge"), mcpServerRefs: [server.metadata!.slug] }),
    );
    mock.enqueue(
      anthropicToolUses([
        { toolCallId: "call_purge_echo", toolName: DESTRUCTIVE_ECHO_TOOL_NAME, toolInput: { text: "held" } },
      ]),
    );
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-purge"), agentRef: agentRefOf(agent) }),
    );
    const executionId = execution.metadata!.id;
    const gated = await awaitPhase(clients, executionId, RunPhase.RUN_WAITING_FOR_APPROVAL, {
      label: "WAITING_FOR_APPROVAL",
    });

    await clients.organizationCommand.delete({ value: org });

    await expectGrpcCode(
      () => clients.agentExecutionQuery.get({ value: executionId }),
      Code.NotFound,
      "the live run, once its organization is deleted",
    );
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: gated.status!.pendingApprovals[0]!.toolCallId,
          action: ApprovalAction.APPROVE,
        }),
      Code.NotFound,
      "a decision on its gate",
    );

    const next = await createOrganizationOnceReleased(clients.organizationCommand, slug);
    fixtures.defer(() => clients.organizationCommand.delete({ value: next.metadata!.id }));
    expect(next.metadata?.id).not.toBe(org);
    await expectGrpcCode(
      () => clients.agentExecutionQuery.get({ value: executionId }),
      Code.NotFound,
      "the run, after the purge",
    );
  });
});
