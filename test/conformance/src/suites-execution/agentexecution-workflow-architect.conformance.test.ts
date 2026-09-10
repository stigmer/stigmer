// Conformance suite for the Workflow Architect: the seedpack agent that designs
// Workflow YAML through the `stigmer mcp-server` tools, run as an ordinary
// AgentExecution against the real mcp-server over stdio.
// Domain: agentic / agentexecution — a product agent's tool loop, observed
// through the transcript.
//
// What is real here and what is scripted: the agent's instructions are the
// seedpack's, the McpServer is the real `@stigmer/mcp-server` full roster
// spawned by the runner as a stdio child (it reaches THIS server through the
// STIGMER_SERVER_ADDRESS the execution's runtime env supplies —
// support/workflow-architect.ts), and the tool calls the architect makes
// (get_task_kind_registry, validate_workflow_yaml) execute for real against the
// server's registry and validator. Only the model's turns are scripted on the
// mock. So a passing arm proves the whole chain: seedpack prompt → runner →
// stdio mcp-server → this server → tool result → the architect's YAML answer.
//
// Pinned (DD-001 of entry 20260910.02; the Go offline suite's
// workflow_architect_offline_test.go): the architect consults the registry and
// answers a fenced YAML block declaring set_vars; its MCP tool calls are
// recorded as ToolCalls; validate_workflow_yaml runs before it answers when the
// script says so; a second execution in the same session refines the earlier
// YAML (the session carries the conversation).
//
// The registry tool's contract is not met by the TypeScript server today: the
// RPC behind it (TaskKindRegistryQueryController) has no handler, so the call
// 404s and the architect proceeds without the registry (stigmer#1026, found by
// this port). The three arms that read the registry's answer assert the
// contract through the known-deviation registry (contract/deviations.ts,
// TASK_KIND_REGISTRY_RPC_UNROUTED): on the deviating implementation they assert
// the observed reading and report the tracked deviation, and the day the RPC is
// routed they turn red until the entry is deleted. Nothing here is skipped.
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { assertContractOrDeviation, TASK_KIND_REGISTRY_RPC_UNROUTED } from "../contract/deviations";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { AnthropicMessageBody, MockLlmProxy } from "../harness/mock-llm";
import { anthropicText, anthropicToolUse } from "../harness/mock-llm";
import { allToolCalls, awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import {
  ARCHITECT_REGISTRY_TOOL,
  ARCHITECT_VALIDATE_TOOL,
  extractWorkflowYaml,
  makeStigmerMcpServer,
  makeWorkflowArchitectAgent,
  stigmerMcpServerRuntimeEnv,
} from "../support/workflow-architect";
import { createTarget, type TargetProfile } from "../targets";

// Collection-time gate: the stdio mcp-server child dials the server under test
// with no credential of its own, so the arms run only where the target exposes
// an anonymously reachable unified port (the local targets). On the cloud
// targets the lane needs a bearer the fixture does not mint, and the file
// reports SKIPPED rather than a false green (the DD-012 posture).
const dialsAnonymously = createTarget().httpBaseUrl !== undefined;

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// The YAML the scripted architect "generates": a valid two-task Workflow the
// server's validator accepts (the validate arm runs it for real).
const GENERATED_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: architect-generate
  org: conformance
spec:
  description: A simple two-task workflow
  document:
    dsl: "1.0.0"
    namespace: conformance
    name: architect-generate
    version: "1.0.0"
  tasks:
    - name: setMessage
      kind: set_vars
      task_config:
        variables:
          message: "hello world"
      export:
        as: "\${.}"
      flow:
        then: setStatus
    - name: setStatus
      kind: set_vars
      task_config:
        variables:
          status: "complete"
      export:
        as: "\${.}"`;

// The refined YAML: one more task than the generated one, naming `farewell`.
const REFINED_YAML = `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: architect-refine
  org: conformance
spec:
  description: A refined three-task workflow
  document:
    dsl: "1.0.0"
    namespace: conformance
    name: architect-refine
    version: "1.0.0"
  tasks:
    - name: setGreeting
      kind: set_vars
      task_config:
        variables:
          greeting: "hello"
      export:
        as: "\${.}"
      flow:
        then: setFarewell
    - name: setFarewell
      kind: set_vars
      task_config:
        variables:
          farewell: "goodbye"
      export:
        as: "\${.}"
      flow:
        then: setDone
    - name: setDone
      kind: set_vars
      task_config:
        variables:
          done: "true"
      export:
        as: "\${.}"`;

function registryTurn(toolCallId: string): AnthropicMessageBody {
  return anthropicToolUse(toolCallId, ARCHITECT_REGISTRY_TOOL, {});
}

function yamlAnswer(yaml: string, lead = "Based on the available task kinds, here is your workflow:"): AnthropicMessageBody {
  return anthropicText(`${lead}\n\n\`\`\`yaml\n${yaml}\n\`\`\`\n\nThe tasks run in sequence.`);
}

// The architect agent on the real stigmer mcp-server, with a NATIVE session
// the arms run one or more executions in. Returns what an arm needs to create
// executions: the org, the session id and the runtime env carrying the
// server's address for the stdio child.
async function provisionArchitect(): Promise<{
  org: string;
  sessionId: string;
  runtimeEnv: ReturnType<typeof stigmerMcpServerRuntimeEnv>;
}> {
  const { org } = await target.provisionTenancy();
  const server = await clients.mcpServerCommand.create(makeStigmerMcpServer({ org, name: uniqueName("stigmer-mcp") }));
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

  const agent = await clients.agentCommand.create(
    makeWorkflowArchitectAgent({ org, name: uniqueName("architect"), stigmerMcpServerSlug: server.metadata!.slug }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const instanceId = agent.status?.defaultInstanceId;
  if (instanceId === undefined || instanceId === "") {
    throw new Error("agent create did not provision a default instance");
  }
  const session = await clients.sessionCommand.create(
    makeSession({ org, name: uniqueName("ses-architect"), agentInstanceId: instanceId, harness: Harness.NATIVE }),
  );
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

  return { org, sessionId: session.metadata!.id, runtimeEnv: stigmerMcpServerRuntimeEnv(serverAddress()) };
}

// The gRPC origin the stdio mcp-server child dials: the server this suite
// talks to. The execution targets expose it as the unified port's base URL.
function serverAddress(): string {
  const url = target.httpBaseUrl?.();
  if (url === undefined) {
    throw new Error(`target ${target.name} exposes no server base URL for the stdio mcp-server to dial`);
  }
  return url;
}

async function runArchitect(
  ctx: { org: string; sessionId: string; runtimeEnv: ReturnType<typeof stigmerMcpServerRuntimeEnv> },
  message: string,
): Promise<AgentExecution> {
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org: ctx.org,
      name: uniqueName("aex-architect"),
      sessionId: ctx.sessionId,
      message,
      autoApproveAll: true,
      runtimeEnv: ctx.runtimeEnv,
    }),
  );
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: execution.metadata!.id }));
  const final = await awaitTerminal(clients, execution.metadata!.id, { timeoutMs: 120_000 });
  expect(
    final.status?.phase,
    `the architect run should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]} ` +
      `(status.error: ${JSON.stringify(final.status?.error ?? "")})`,
  ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  return final;
}

// The YAML block of the run's final assistant message, or a named failure.
function yamlOf(final: AgentExecution): string {
  const lastAi = [...(final.status?.messages ?? [])].reverse().find((m) => m.type === MessageType.MESSAGE_AI);
  const yaml = extractWorkflowYaml(lastAi?.content ?? "");
  if (yaml === undefined) {
    throw new Error(`the architect's final message carries no fenced YAML: ${JSON.stringify(lastAi?.content ?? "")}`);
  }
  return yaml;
}

const GENERATE_PROMPT =
  "Create a simple workflow with two tasks: 1) a set_vars task that sets 'message' to 'hello world', " +
  "2) a set_vars task that sets 'status' to 'complete'. The first task should flow into the second.";

describe.skipIf(!dialsAnonymously)("Workflow Architect — generate", () => {
  it("the architect calls the task-kind registry and answers a YAML block that declares set_vars", async () => {
    const architect = await provisionArchitect();
    mock.enqueue(registryTurn("toolu_registry_01"));
    mock.enqueue(yamlAnswer(GENERATED_YAML));

    const final = await runArchitect(architect, GENERATE_PROMPT);

    const yaml = yamlOf(final);
    expect(yaml).toContain("set_vars");
    expect(yaml).toContain("kind: Workflow");
    expect(mock.remaining(), "the architect consumed exactly its script").toBe(0);
  });

  it("the architect's MCP tool call to the stigmer server is recorded as a ToolCall", async () => {
    const architect = await provisionArchitect();
    mock.enqueue(registryTurn("toolu_registry_02"));
    mock.enqueue(yamlAnswer(GENERATED_YAML));

    const final = await runArchitect(architect, GENERATE_PROMPT);

    const registryCall = allToolCalls(final).find((tc) => tc.name === ARCHITECT_REGISTRY_TOOL);
    expect(registryCall, "the registry lookup went through the real mcp-server").toBeDefined();
    await assertContractOrDeviation(target, TASK_KIND_REGISTRY_RPC_UNROUTED, {
      contract: () => expect(registryCall!.result, "and the registry answered").not.toBe(""),
      observed: () => expect(registryCall!.result, "the unrouted RPC leaves the call without a result").toBe(""),
    });
  });

  it("the architect validates its YAML through validate_workflow_yaml before answering", async () => {
    const architect = await provisionArchitect();
    mock.enqueue(registryTurn("toolu_registry_03"));
    mock.enqueue(anthropicToolUse("toolu_validate_01", ARCHITECT_VALIDATE_TOOL, { yaml_content: GENERATED_YAML }));
    mock.enqueue(yamlAnswer(GENERATED_YAML, "Validation passed. Here is the workflow:"));

    const final = await runArchitect(architect, GENERATE_PROMPT);

    const names = allToolCalls(final).map((tc) => tc.name);
    expect(names).toContain(ARCHITECT_REGISTRY_TOOL);
    await assertContractOrDeviation(target, TASK_KIND_REGISTRY_RPC_UNROUTED, {
      contract: () => {
        expect(names, "the validation call followed the registry lookup").toContain(ARCHITECT_VALIDATE_TOOL);
        expect(yamlOf(final)).toContain("set_vars");
        expect(mock.consumed(), "registry, validate, answer").toBe(3);
      },
      observed: () => {
        // With the registry call failing, the agent never reaches the
        // validation turn the script queued: the transcript carries the
        // registry call alone.
        expect(names, "the validation turn was not reached").not.toContain(ARCHITECT_VALIDATE_TOOL);
      },
    });
  });
});

describe.skipIf(!dialsAnonymously)("Workflow Architect — refine", () => {
  it("a second execution in the same session refines the earlier YAML", async () => {
    const architect = await provisionArchitect();
    mock.enqueue(registryTurn("toolu_registry_04"));
    mock.enqueue(yamlAnswer(GENERATED_YAML));
    mock.enqueue(yamlAnswer(REFINED_YAML, "Here is the refined workflow with the additional tasks:"));

    const first = await runArchitect(architect, GENERATE_PROMPT);
    const originalYaml = yamlOf(first);

    const second = await runArchitect(
      architect,
      "Add a second set_vars task for 'farewell' = 'goodbye' and a third for 'done' = 'true'.",
    );
    const refinedYaml = yamlOf(second);

    expect(refinedYaml).not.toBe(originalYaml);
    expect(refinedYaml.length, "the refinement grew the workflow").toBeGreaterThan(originalYaml.length);
    expect(refinedYaml).toContain("farewell");
    expect(mock.remaining(), "both executions consumed exactly the shared script").toBe(0);
  });
});
