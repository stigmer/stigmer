// Conformance suite for environment-merge precedence — the AGENT half
// (Class B). The workflow half lives in
// envmerge-workflow.conformance.test.ts: rosters are file-granular and the
// local-execution target rostered agent-execution suites before the
// workflow-execution engine existed, so the two aggregates' assertions ship
// as two files.
//
// Domain: agentic — the env layering that populates an ExecutionContext at
// run start, exercised through AgentExecution. A turn's value layers are the
// lane's (a PlatformClient's, a schedule's or a workflow task's
// environment_refs) and its own runtime_env; the agent's declarations are
// the key whitelist; and a declared key no layer carries is filled from the
// run's person's personal environment, by declared key, after every layer
// (the personal-key bridge; the two-person form, where a member's turn reads
// the member's value and never the agent author's, is pinned on the enforcing
// lane in runner-as-subject.conformance.test.ts). The merge contract itself (value
// layers + blueprint key whitelist, stigmer#222) is documented in the
// workflow half's header.
//
// Observation strategy: the ExecutionContext is created SYNCHRONOUSLY
// inside the create pipeline, so it exists the instant create() returns; a
// held mock-LLM turn keeps the run non-terminal (and its ephemeral context
// alive) while getByExecutionId reads it. Values are plain (not secret) so
// the read shows them unredacted.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { agentRefOf, makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy, requireMcpFixture } from "../support/agentruns";
import { makeHttpMcpServer } from "../support/mcpservers";
import { type EnvVarDeclarationInit, type EnvironmentValueInit, makePersonalEnvironment } from "../support/environments";
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

interface MergeSetup {
  // The run's person's personal environment (stigmer.ai/personal): the
  // fill-in for a declared key no value layer carries.
  personal: Record<string, EnvironmentValueInit>;
  // Blueprint env declarations (the whitelist the merged env is filtered to).
  env: Record<string, EnvVarDeclarationInit>;
  // Execution-scoped overrides (highest precedence).
  runtimeEnv?: Record<string, ExecutionValueInit>;
}

// Drives the AGENT env-merge path end to end: the caller's personal
// Environment -> Agent (env whitelist) -> Session on the agent ->
// AgentExecution (runtime_env) in the session. A held mock turn keeps the run
// non-terminal for the read.
async function runAgentMerge(org: string, setup: MergeSetup) {
  const personal = await clients.environmentCommand.create(
    makePersonalEnvironment({ org, name: uniqueName("personal"), data: setup.personal }),
  );
  fixtures.defer(() => clients.environmentCommand.delete({ resourceId: personal.metadata!.id }));

  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent"), env: setup.env }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  const session = await clients.sessionCommand.create(
    makeSession({ org, name: uniqueName("session"), agentRef: agentRefOf(agent) }),
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

describe("envmerge conformance — the agent's declared keys", () => {
  it("a key the agent declares and no layer carries is filled from the run's person's personal environment", async () => {
    const { org } = await target.provisionTenancy();
    const { data } = await runAgentMerge(org, {
      personal: { BRIDGE_KEY: { value: "personal-value", isSecret: false } },
      env: { BRIDGE_KEY: { isSecret: false } },
    });

    expect(data.BRIDGE_KEY?.value, "the personal environment fills the agent's declared key").toBe("personal-value");
  });

  it("runtime_env wins over the personal environment for a declared key", async () => {
    const { org } = await target.provisionTenancy();
    const { data } = await runAgentMerge(org, {
      personal: { PRECEDENCE_KEY: { value: "from-personal", isSecret: false } },
      env: { PRECEDENCE_KEY: { isSecret: false }, RUNTIME_ONLY_KEY: { isSecret: false } },
      runtimeEnv: { PRECEDENCE_KEY: { value: "from-runtime" }, RUNTIME_ONLY_KEY: { value: "runtime-value" } },
    });

    expect(data.PRECEDENCE_KEY?.value, "the personal fill-in never overrides a value a layer carries").toBe(
      "from-runtime",
    );
    expect(data.RUNTIME_ONLY_KEY?.value, "a runtime-only declared key is present").toBe("runtime-value");
  });

  it("keys the agent does not declare are excluded, wherever they come from", async () => {
    const { org } = await target.provisionTenancy();
    const { data } = await runAgentMerge(org, {
      personal: { UNDECLARED_PERSONAL_KEY: { value: "dropped", isSecret: false } },
      env: { DECLARED_KEY: { isSecret: false } },
      runtimeEnv: { DECLARED_KEY: { value: "kept" }, UNDECLARED_RUNTIME_KEY: { value: "dropped" } },
    });

    expect(data.DECLARED_KEY?.value).toBe("kept");
    expect(data.UNDECLARED_PERSONAL_KEY, "a personal key the agent does not declare never reaches the run").toBeUndefined();
    expect(data.UNDECLARED_RUNTIME_KEY, "a runtime key the agent does not declare is filtered").toBeUndefined();
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

    const session = await clients.sessionCommand.create(
      makeSession({
        org,
        name: uniqueName("shell-session"),
        agentRef: agentRefOf(agent),
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
      `execution ${executionId} should complete; reached ${RunPhase[final.status?.phase ?? 0]}`,
    ).toBe(RunPhase.RUN_COMPLETED);

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
