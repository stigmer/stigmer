// Conformance suite for environment-merge precedence — the AGENT-INSTANCE
// half (Class B). The workflow half lives in
// envmerge-workflow.conformance.test.ts: rosters are file-granular and the
// TS-server program's local-execution target rosters agent-execution
// suites before the workflow-execution engine exists (D4 #18 vs #20/#21),
// so the two aggregates' assertions ship as two files (sub-project
// 20260824.03 ratified brief #3).
//
// Domain: agentic — the env layering that populates an ExecutionContext at
// run start, exercised through AgentExecution (via AgentInstance). The
// merge contract itself (two value layers + blueprint key whitelist,
// stigmer#222) is documented in the workflow half's header.
//
// Observation strategy: the ExecutionContext is created SYNCHRONOUSLY
// inside the create pipeline, so it exists the instant create() returns; a
// held mock-LLM turn keeps the run non-terminal (and its ephemeral context
// alive) while getByExecutionId reads it.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy, requireMcpFixture } from "../support/agentexecutions";
import { makeHttpMcpServer } from "../support/mcpservers";
import { makeAgentInstance } from "../support/agentinstances";
import { type EnvVarDeclarationInit, type EnvironmentValueInit, makeEnvironment } from "../support/environments";
import { type ExecutionValueInit } from "../support/executioncontexts";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

// Holds an agent run's single turn open so the run stays non-terminal (and its
// ephemeral ExecutionContext survives) while we read. Same rationale/value as the
// agentexecution lifecycle suite: a held turn aborts the instant the client
// disconnects, so the wall-clock cost is tiny.
const HOLD_MS = 30_000;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  // Release any still-held agent turn before fixture teardown so its runner
  // activity winds down and frees the session lock (mirrors the agent suite).
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// One Environment layer: a name hint (for readability in server logs) plus its
// spec.data. Refs are merged in array order, so the last layer wins on conflicts.
interface EnvLayer {
  name?: string;
  data: Record<string, EnvironmentValueInit>;
}

interface MergeSetup {
  // Instance environment_refs, merged in order (later overrides earlier).
  environments: EnvLayer[];
  // Blueprint env declarations (the whitelist the merged env is filtered to).
  env: Record<string, EnvVarDeclarationInit>;
  // Execution-scoped overrides (highest precedence).
  runtimeEnv?: Record<string, ExecutionValueInit>;
}

// Creates the requested Environment resources and returns their org/slug refs,
// tracking each for cleanup.
async function seedEnvironments(org: string, layers: EnvLayer[]): Promise<{ org: string; slug: string }[]> {
  const refs: { org: string; slug: string }[] = [];
  for (const layer of layers) {
    const env = await clients.environmentCommand.create(
      makeEnvironment({ org, name: uniqueName(layer.name ?? "env"), data: layer.data }),
    );
    fixtures.defer(() => clients.environmentCommand.delete({ resourceId: env.metadata!.id }));
    refs.push({ org, slug: env.metadata!.slug });
  }
  return refs;
}

// Drives the AGENT env-merge path end to end: Environment(s) -> Agent (env
// whitelist) -> AgentInstance (environment_refs) -> Session (bound to the
// instance) -> AgentExecution (runtime_env) against the session. Providing
// session_id makes the create pipeline skip default-instance/session creation, so
// the env merge resolves the instance via Session -> agent_instance_id (Path B).
// A held mock turn keeps the run non-terminal for the read.
async function runAgentMerge(org: string, setup: MergeSetup) {
  const refs = await seedEnvironments(org, setup.environments);

  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent"), env: setup.env }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  const instance = await clients.agentInstanceCommand.create(
    makeAgentInstance({ org, name: uniqueName("ain"), agentId: agent.metadata!.id, environmentRefs: refs }),
  );
  fixtures.defer(() => clients.agentInstanceCommand.delete({ value: instance.metadata!.id }));

  const session = await clients.sessionCommand.create(
    makeSession({ org, name: uniqueName("session"), agentInstanceId: instance.metadata!.id }),
  );
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

  // Enqueue the held turn before create() so the runner blocks on it rather than
  // completing (and deleting the context) before we read.
  mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("aex"), sessionId: session.metadata!.id, runtimeEnv: setup.runtimeEnv }),
  );
  fixtures.defer(async () => {
    await clients.agentExecutionCommand.cancel({ id: execution.metadata!.id }).catch(() => {});
    await clients.agentExecutionCommand.delete({ value: execution.metadata!.id });
  });

  const context = await clients.executionContextQuery.getByExecutionId({ executionId: execution.metadata!.id });
  return { execution, data: context.spec?.data ?? {} };
}

describe("envmerge conformance — Agent instance layer", () => {
  it("AgentInstance environment_refs reach the ExecutionContext; runtime_env overrides them; undeclared keys are filtered", async () => {
    const { org } = await target.provisionTenancy();
    const { data } = await runAgentMerge(org, {
      environments: [
        {
          data: {
            PRECEDENCE_KEY: { value: "from-environment" },
            ENV_ONLY_KEY: { value: "env-value" },
            UNDECLARED_KEY: { value: "dropped" },
          },
        },
      ],
      env: { PRECEDENCE_KEY: {}, ENV_ONLY_KEY: {}, RUNTIME_ONLY_KEY: {} },
      runtimeEnv: { PRECEDENCE_KEY: { value: "from-runtime" }, RUNTIME_ONLY_KEY: { value: "runtime-value" } },
    });

    expect(data.ENV_ONLY_KEY?.value, "the AgentInstance environment_refs layer reaches the ExecutionContext").toBe(
      "env-value",
    );
    expect(data.PRECEDENCE_KEY?.value, "runtime_env overrides the AgentInstance environment layer").toBe("from-runtime");
    expect(data.RUNTIME_ONLY_KEY?.value, "a runtime-only declared key is present").toBe("runtime-value");
    expect(data.UNDECLARED_KEY, "keys not declared in the agent whitelist are excluded").toBeUndefined();
  });
});

// The agent's shell is one more consumer of the merged values, and it holds
// only what the AGENT declares: a key a session's own MCP server declares
// reaches the run (the declared set is the union) and that server, never the
// shell. Observed where the model sees it: the shell tool's output in the
// next model request. Values are plain (not secret) so no redaction stands
// between the shell's output and the assertion.
describe("envmerge conformance — the agent's shell", () => {
  // Where the MCP server rides: the session adds it, or the agent lists it
  // (agent save then copies the server's declared key into the agent's own
  // env, so the key reaches the run as the agent's).
  async function shellOfRun(serverOn: "session" | "agent"): Promise<string> {
    const { org } = await target.provisionTenancy();
    const mcp = requireMcpFixture(target);

    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({
        org,
        name: uniqueName("shell-mcp"),
        url: mcp.url(),
        env: { SHELL_MCP_ONLY_KEY: { description: "the server's own key", isSecret: false } },
      }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("shell-agent"),
        env: { SHELL_AGENT_KEY: { description: "the agent's own key", isSecret: false } },
        ...(serverOn === "agent" ? { mcpServerRefs: [server.metadata!.slug] } : {}),
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const agentInstanceId = agent.status?.defaultInstanceId ?? "";
    expect(agentInstanceId, "the agent's default instance").not.toBe("");

    const session = await clients.sessionCommand.create(
      makeSession({
        org,
        name: uniqueName("shell-session"),
        agentInstanceId,
        ...(serverOn === "session" ? { mcpServerRefs: [server.metadata!.slug] } : {}),
      }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

    // The shell turn is held a moment so the run's context can be read
    // first: both values must reach the RUN, or the shell's narrowing
    // proves nothing.
    mock.enqueue(
      anthropicToolUse("call_printenv", "execute", {
        // `env | grep`, not `printenv A B`: BSD printenv prints one name.
        command: "env | grep '^SHELL_' ; true",
      }),
      { delayMs: 10_000 },
    );
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-shell"),
        sessionId: session.metadata!.id,
        autoApproveAll: true,
        runtimeEnv: {
          SHELL_AGENT_KEY: { value: "agent-visible-value", isSecret: false },
          SHELL_MCP_ONLY_KEY: { value: "mcp-only-value", isSecret: false },
        },
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const context = await clients.executionContextQuery.getByExecutionId({ executionId });
    expect(Object.keys(context.spec?.data ?? {}).sort(), "both values reach the run").toEqual([
      "SHELL_AGENT_KEY",
      "SHELL_MCP_ONLY_KEY",
    ]);

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `execution ${executionId} should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    const scripted = mock.scriptedRequests();
    expect(scripted.length, "the tool round and the answer").toBeGreaterThanOrEqual(2);
    return JSON.stringify(scripted[1]?.body);
  }

  it("the shell holds the keys the agent declares and never a key only a session's MCP server declares", async () => {
    const afterShell = await shellOfRun("session");
    expect(afterShell, "the agent's declared key reaches its shell").toContain("agent-visible-value");
    expect(afterShell, "a key only the session's MCP server declares never reaches the shell").not.toContain(
      "mcp-only-value",
    );
  });

  it("the shell never holds a key the agent's own MCP server declares, though agent save copied it into the agent's env", async () => {
    const afterShell = await shellOfRun("agent");
    expect(afterShell, "the agent's declared key reaches its shell").toContain("agent-visible-value");
    expect(afterShell, "a key the agent's MCP server declares never reaches the shell").not.toContain(
      "mcp-only-value",
    );
  });
});
