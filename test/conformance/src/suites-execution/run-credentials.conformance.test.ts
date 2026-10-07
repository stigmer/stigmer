// Conformance suite for the values a run receives (Class B).
//
// Domain: agentic — the one rule that decides which values a run gets,
// exercised through Run create. A run's requirements are the keys its
// declarers declare: the agent's own `env`, and each MCP server the agent or
// the session uses with its `env`. For each requirement the first source
// with a value wins:
//   1. the run's own runtime_env, by key;
//   2. the assignment on the surface that started a run with no person
//      behind it (here: a schedule's), read only while its writer may still
//      use the credential;
//   3. the run's person's own credential serving the declarer — and, for an
//      agent, the organization's credential serving it when the person may
//      use it;
//   4. nothing: a required key refuses the create with FAILED_PRECONDITION
//      naming the key; an optional key stays absent.
// Only declared keys reach the run: a runtime_env key or a credential field
// no declarer names never does. Two declarers of one key must agree, or the
// create is refused naming both.
//
// Observation strategy: the ExecutionContext is created SYNCHRONOUSLY inside
// the create pipeline, so it exists the instant create() returns; a held
// mock-LLM turn keeps the run non-terminal (and its context alive) while
// getByExecutionId reads it. Values are plain where the arm reads them by
// key; a secret comes back with is_secret set and its value redacted on the
// harness's user-shaped read (stigmer#535), and the proof that the RUNNER
// receives it decrypted is the agent's shell printing it into the next model
// request.
//
// The two-person arms (a member's run never uses a teammate's credential; the
// organization's reaches a member only once granted) run on the target's
// enforcing lane. The schedule arms gate on CapabilityFlags.scheduleFiring.
// Out of scope here: the credential resource's own contract
// (suites/credential.conformance.test.ts), the sign-in a connect writes
// (mcpserver-connect.conformance.test.ts), and assignments on shares,
// channels and platform clients, whose runs the conformance harness does not
// start through their own lanes.
import { Code, ConnectError } from "@connectrpc/connect";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScheduleFireOutcome } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { agentRefOf, makeAgent } from "../support/agents";
import {
  type CredentialFieldInit,
  type EnvVarDeclarationInit,
  agentTarget,
  assignCredential,
  makeCredential,
  mcpServerTarget,
  refOf,
} from "../support/credentials";
import type { ExecutionValueInit } from "../support/executioncontexts";
import { policyTriple } from "../support/iampolicies";
import { makeHttpMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { pollUntil } from "../support/run-poll";
import { awaitPhase, awaitTerminal, makeAgentExecution, requireLlmProxy, requireMcpFixture } from "../support/runs";
import { makeSchedule } from "../support/schedules";
import { makeSession } from "../support/sessions";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile, type TenancyContext } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

// Holds a run's single turn open so the run stays non-terminal (and its
// ExecutionContext survives) while the arm reads it. A held turn aborts the
// instant the client disconnects, so the wall-clock cost is tiny.
const HOLD_MS = 30_000;

// Read once at collection time to gate the schedule describe (constructing a
// target is side-effect-free; setup() is what boots processes).
const scheduleFiring = createTarget().capabilities.scheduleFiring;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  // Release any still-held turn before teardown so its runner activity winds
  // down and frees the session lock.
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// --- fixtures ----------------------------------------------------------------

async function createAgent(
  org: string,
  env: Record<string, EnvVarDeclarationInit>,
  opts: { mcpServerRefs?: string[]; using?: ConformanceClients; visibility?: ApiResourceVisibility } = {},
): Promise<Agent> {
  const using = opts.using ?? clients;
  const input = makeAgent({ org, name: uniqueName("cred-agent"), env, mcpServerRefs: opts.mcpServerRefs });
  if (opts.visibility !== undefined) {
    input.metadata = { ...input.metadata, visibility: opts.visibility };
  }
  const agent = await using.agentCommand.create(input);
  fixtures.defer(() => using.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

async function createCredential(
  org: string,
  fields: Record<string, CredentialFieldInit>,
  opts: {
    serves?: ReturnType<typeof agentTarget>[];
    owner?: "person" | "org";
    using?: ConformanceClients;
  } = {},
) {
  const using = opts.using ?? clients;
  const credential = await using.credentialCommand.create(
    makeCredential({ org, name: uniqueName("cred"), fields, serves: opts.serves ?? [], owner: opts.owner }),
  );
  fixtures.defer(() => using.credentialCommand.delete({ resourceId: credential.metadata!.id }));
  return credential;
}

// Plain fields, so the user-shaped context read shows the values.
function plain(values: Record<string, string>): Record<string, CredentialFieldInit> {
  return Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value, plain: true }]));
}

// A held turn on `agent` by `by`, and the run's context read back by key.
async function heldRun(
  org: string,
  agent: Agent,
  opts: { using?: ConformanceClients; llm?: MockLlmProxy; runtimeEnv?: Record<string, ExecutionValueInit>; sessionId?: string } = {},
): Promise<{ run: Run; data: Record<string, { value: string; isSecret: boolean }> }> {
  const using = opts.using ?? clients;
  const llm = opts.llm ?? mock;
  llm.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
  const run = await using.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("cred-run"),
      ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : { agentRef: agentRefOf(agent) }),
      runtimeEnv: opts.runtimeEnv,
    }),
  );
  fixtures.defer(async () => {
    llm.releaseHolds();
    await using.agentExecutionCommand.cancel({ id: run.metadata!.id }).catch(() => undefined);
    await awaitTerminal(using, run.metadata!.id);
    await using.agentExecutionCommand.delete({ value: run.metadata!.id });
  });
  const context = await using.executionContextQuery.getByExecutionId({ executionId: run.metadata!.id });
  return { run, data: context.spec?.data ?? {} };
}

// A create the resolver refuses: FAILED_PRECONDITION, with its message.
async function refusedRun(org: string, agent: Agent, using: ConformanceClients = clients): Promise<string> {
  const refused = await expectGrpcCode(
    () =>
      using.agentExecutionCommand.create(
        makeAgentExecution({ org, name: uniqueName("cred-refused"), agentRef: agentRefOf(agent) }),
      ),
    Code.FailedPrecondition,
    "a run whose required key nothing provides",
  );
  return refused.rawMessage;
}

// --- the single-person rule --------------------------------------------------

describe("run credentials — where a run's values come from", () => {
  it("[rpc:RunCommandController.create] a run whose agent declares a required key nothing provides is refused at create, naming the key", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org, { NEEDED_KEY: { description: "required" } });

    const message = await refusedRun(org, agent);
    expect(message).toContain(`agent '${agent.metadata!.slug}' needs NEEDED_KEY`);
    expect(message).toContain("save a credential of yours that serves it");
  });

  it("[rpc:RunCommandController.create] a run whose MCP server declares a required key nothing provides is refused at create, naming the key", async () => {
    const { org } = await target.provisionTenancy();
    const mcp = requireMcpFixture(target);
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("cred-mcp"), url: mcp.url(), env: { SERVER_KEY: { isSecret: true } } }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
    const agent = await createAgent(org, {}, { mcpServerRefs: [server.metadata!.slug] });

    const message = await refusedRun(org, agent);
    expect(message).toContain(`MCP server '${server.metadata!.slug}' needs SERVER_KEY`);
  });

  it("runtime_env provides a declared key, and wins over the person's credential", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org, { PRECEDENCE_KEY: {}, RUNTIME_ONLY_KEY: {} });
    await createCredential(org, plain({ PRECEDENCE_KEY: "from-credential" }), {
      serves: [agentTarget(refOf(agent))],
    });

    const { data } = await heldRun(org, agent, {
      runtimeEnv: { PRECEDENCE_KEY: { value: "from-runtime" }, RUNTIME_ONLY_KEY: { value: "runtime-value" } },
    });
    expect(data.PRECEDENCE_KEY?.value, "runtime_env is the first source").toBe("from-runtime");
    expect(data.RUNTIME_ONLY_KEY?.value).toBe("runtime-value");
  });

  it("a person's credential serving the agent provides its declared keys to that person's run", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org, { SERVED_KEY: {} });
    await createCredential(org, plain({ SERVED_KEY: "personal-value" }), { serves: [agentTarget(refOf(agent))] });

    const { data } = await heldRun(org, agent);
    expect(data.SERVED_KEY?.value).toBe("personal-value");
  });

  it("a person's credential serving an MCP server the session uses provides that server's keys", async () => {
    const { org } = await target.provisionTenancy();
    const mcp = requireMcpFixture(target);
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("cred-mcp"), url: mcp.url(), env: { SERVER_KEY: {} } }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
    await createCredential(org, plain({ SERVER_KEY: "server-value" }), { serves: [mcpServerTarget(refOf(server))] });
    const agent = await createAgent(org, {});
    const session = await clients.sessionCommand.create(
      makeSession({
        org,
        name: uniqueName("cred-session"),
        agentRef: agentRefOf(agent),
        mcpServerRefs: [server.metadata!.slug],
      }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

    const { data } = await heldRun(org, agent, { sessionId: session.metadata!.id });
    expect(data.SERVER_KEY?.value).toBe("server-value");
  });

  it("keys no declarer names never reach the run, whether runtime_env or a credential carries them", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org, { DECLARED_KEY: {} });
    await createCredential(org, plain({ DECLARED_KEY: "kept", UNDECLARED_FIELD: "dropped" }), {
      serves: [agentTarget(refOf(agent))],
    });

    const { data } = await heldRun(org, agent, { runtimeEnv: { UNDECLARED_RUNTIME_KEY: { value: "dropped" } } });
    expect(Object.keys(data), "the run holds the declared key alone").toEqual(["DECLARED_KEY"]);
    expect(data.DECLARED_KEY?.value).toBe("kept");
  });

  it("an optional key nothing provides is absent, and the run completes without it", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org, { PROVIDED_KEY: {}, OPTIONAL_KEY: { optional: true } });
    await createCredential(org, plain({ PROVIDED_KEY: "present" }), { serves: [agentTarget(refOf(agent))] });

    const { run, data } = await heldRun(org, agent);
    expect(data.PROVIDED_KEY?.value).toBe("present");
    expect(data.OPTIONAL_KEY, "an unprovided optional key is absent, not defaulted").toBeUndefined();

    mock.releaseHolds();
    const final = await awaitTerminal(clients, run.metadata!.id);
    expect(final.status?.phase, `error: ${final.status?.error || "(none)"}`).toBe(RunPhase.RUN_COMPLETED);
  });

  it("[rpc:RunCommandController.create] two declarers of one key that resolve to different values refuse the create, naming both", async () => {
    const { org } = await target.provisionTenancy();
    const mcp = requireMcpFixture(target);
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("cred-mcp"), url: mcp.url(), env: { SHARED_KEY: {} } }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
    const agent = await createAgent(org, { SHARED_KEY: {} }, { mcpServerRefs: [server.metadata!.slug] });
    await createCredential(org, plain({ SHARED_KEY: "agent-value" }), { serves: [agentTarget(refOf(agent))] });
    await createCredential(org, plain({ SHARED_KEY: "server-value" }), { serves: [mcpServerTarget(refOf(server))] });

    const message = await refusedRun(org, agent);
    expect(message).toContain(
      `SHARED_KEY resolves to different values for agent '${agent.metadata!.slug}' and MCP server '${server.metadata!.slug}'`,
    );
  });

  it("one credential serving both declarers of a key is one value, not a conflict", async () => {
    const { org } = await target.provisionTenancy();
    const mcp = requireMcpFixture(target);
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("cred-mcp"), url: mcp.url(), env: { SHARED_KEY: {} } }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
    const agent = await createAgent(org, { SHARED_KEY: {} }, { mcpServerRefs: [server.metadata!.slug] });
    await createCredential(org, plain({ SHARED_KEY: "one-value" }), {
      serves: [agentTarget(refOf(agent)), mcpServerTarget(refOf(server))],
    });

    const { data } = await heldRun(org, agent);
    expect(data.SHARED_KEY?.value).toBe("one-value");
  });

  it("[rpc:ExecutionContextQueryController.getByExecutionId] a secret field reaches the context with is_secret set and its value redacted on the user-shaped read", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org, { API_TOKEN: { isSecret: true }, PLAIN_KEY: {} });
    await createCredential(
      org,
      { API_TOKEN: { value: "credential-secret-value" }, PLAIN_KEY: { value: "plain-value", plain: true } },
      { serves: [agentTarget(refOf(agent))] },
    );

    const { data } = await heldRun(org, agent);
    expect(data.API_TOKEN?.isSecret).toBe(true);
    expect(data.API_TOKEN?.value, "no user-shaped read returns the plaintext secret").not.toBe(
      "credential-secret-value",
    );
    expect(data.PLAIN_KEY?.value).toBe("plain-value");
  });
});

/** Whether the run's ExecutionContext is still readable. */
async function contextState(executionId: string): Promise<"present" | "gone"> {
  try {
    await clients.executionContextQuery.getByExecutionId({ executionId });
    return "present";
  } catch (error) {
    if (ConnectError.from(error).code === Code.NotFound) {
      return "gone";
    }
    throw error;
  }
}

describe("run credentials — recover", () => {
  it("[rpc:RunCommandController.recover] recover rebuilds the context create built: the recorded agent version's keys, from the same person's credential as it is now", async () => {
    // The first turn fails, and the run's end deletes its context. Between
    // the failure and the recover the agent's author saves a version
    // declaring another key, and the person fixes the value: the recovered
    // run reads the version the turn recorded, with the value as it is at
    // recover ("fix the key, then recover").
    const { org } = await target.provisionTenancy();
    const agentName = uniqueName("agent-recover-keys");
    const v1 = await clients.agentCommand.apply(makeAgent({ org, name: agentName, env: { RUN_KEY: {} } }));
    fixtures.defer(() => clients.agentCommand.delete({ value: v1.metadata!.id }));
    const credential = await createCredential(org, plain({ RUN_KEY: "broken-value", LATER_KEY: "later-value" }), {
      serves: [agentTarget(refOf(v1))],
    });

    // A non-retryable failure, answered after a moment so create's context
    // is read before the failed run's end deletes it.
    mock.enqueueError(400, { delayMs: 2_000 });
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-recover-keys"), agentRef: agentRefOf(v1) }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(async () => {
      await clients.agentExecutionCommand.cancel({ id: executionId }).catch(() => undefined);
      await clients.agentExecutionCommand.delete({ value: executionId });
    });
    const built = await clients.executionContextQuery.getByExecutionId({ executionId });
    expect(built.spec?.data.RUN_KEY?.value, "create filled the run's key").toBe("broken-value");

    await awaitPhase(clients, executionId, RunPhase.RUN_FAILED);
    // The failed run's own context delete runs after the phase lands; recover
    // only once it has, so the read below can only be the rebuilt context.
    await pollUntil(
      () => contextState(executionId),
      (state) => state === "gone",
      (_, timeoutMs) => `execution ${executionId}'s ExecutionContext was still readable ${timeoutMs}ms after it FAILED`,
      { timeoutMs: 30_000 },
    );

    const v2 = await clients.agentCommand.apply(makeAgent({ org, name: agentName, env: { LATER_KEY: {} } }));
    expect(v2.status?.versionHash, "the author's save is a new version").not.toBe(v1.status?.versionHash);
    await clients.credentialCommand.setFields({
      credentialId: credential.metadata!.id,
      fields: { RUN_KEY: { value: "fixed-value", plain: true, description: "" } },
    });

    // The recovered turn is held so its rebuilt context survives the read.
    mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
    await clients.agentExecutionCommand.recover({ id: executionId });
    const rebuilt = await clients.executionContextQuery.getByExecutionId({ executionId });
    const data = rebuilt.spec?.data ?? {};
    expect(Object.keys(data).sort(), "recover rebuilds the recorded version's keys, not the head's").toEqual([
      "RUN_KEY",
    ]);
    expect(data.RUN_KEY?.value, "from the run's own person, as the value is now").toBe("fixed-value");
  });
});

// The agent's shell is one more consumer of the run's values, and it holds
// only what the AGENT declares: a key an MCP server declares reaches the run
// and that server, never the shell — whether the session adds the server or
// the agent lists it, because saving an agent never copies its servers'
// declarations into the agent's own env. Observed where the model sees it:
// the shell tool's output in the next model request.
describe("run credentials — the agent's shell", () => {
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

    const agent = await createAgent(
      org,
      { SHELL_AGENT_KEY: { description: "the agent's own key", isSecret: false } },
      serverOn === "agent" ? { mcpServerRefs: [server.metadata!.slug] } : {},
    );
    expect(Object.keys(agent.spec?.env ?? {}), "the agent's env holds its own keys, never its servers'").toEqual([
      "SHELL_AGENT_KEY",
    ]);

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

  it("the shell never holds a key the agent's own MCP server declares: saving the agent copies none into its env", async () => {
    const afterShell = await shellOfRun("agent");
    expect(afterShell, "the agent's declared key reaches its shell").toContain("agent-visible-value");
    expect(afterShell, "a key the agent's MCP server declares never reaches the shell").not.toContain(
      "mcp-only-value",
    );
  });

  it("a credential's secret reaches the runner decrypted: the agent's shell prints it (stigmer#535)", async () => {
    // The end-to-end proof of the runner decrypt lane: a credential's secret
    // (encrypted at rest) -> the resolver decrypts it into the context -> the
    // context encrypts it at rest -> the runner exchanges for an
    // execution-scoped token and reads the context decrypted -> the shell
    // holds the real value. Had any link served the redaction marker or
    // ciphertext, the shell would print that instead.
    const { org } = await target.provisionTenancy();
    const secretValue = "proof-secret-value";
    const agent = await createAgent(org, { SHELL_PROOF_TOKEN: { isSecret: true } });
    await createCredential(org, { SHELL_PROOF_TOKEN: { value: secretValue } }, { serves: [agentTarget(refOf(agent))] });

    mock.enqueue(anthropicToolUse("call_proof", "execute", { command: 'echo "PROOF=[$SHELL_PROOF_TOKEN]"' }));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-secret-proof"), agentRef: agentRefOf(agent), autoApproveAll: true }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `execution ${executionId} should complete; error: ${final.status?.error || "(none)"}`,
    ).toBe(RunPhase.RUN_COMPLETED);
    const scripted = mock.scriptedRequests();
    expect(scripted.length, "the tool round and the answer").toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(scripted[1]?.body), "the shell held the decrypted secret").toContain(
      `PROOF=[${secretValue}]`,
    );
  });
});

// --- a schedule's runs have no person ----------------------------------------

describe.skipIf(!scheduleFiring)("run credentials — a schedule's runs use what the schedule assigns", () => {
  async function scheduleOn(org: string, agent: Agent, assignments: ReturnType<typeof assignCredential>[]) {
    const input = makeSchedule(org, uniqueName("cred-schedule"), agent.metadata!.slug);
    if (input.spec?.target?.case === "agent") {
      input.spec.target.value.credentials = assignments;
    }
    const schedule = await clients.scheduleCommand.create(input);
    fixtures.defer(() => clients.scheduleCommand.delete({ value: schedule.metadata!.id }));
    return schedule;
  }

  it("[rpc:ScheduleCommandController.trigger] the organization's credential a schedule assigns reaches the run its fire starts", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org, { SCHEDULED_KEY: {} });
    const teams = await createCredential(org, plain({ SCHEDULED_KEY: "assigned-value" }), { owner: "org" });
    const schedule = await scheduleOn(org, agent, [
      assignCredential({ declarer: agentTarget(refOf(agent)), key: "SCHEDULED_KEY", credential: refOf(teams) }),
    ]);

    mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
    const result = await clients.scheduleCommand.trigger({ value: schedule.metadata!.id });
    expect(result.outcome, `refusal: ${result.refusalReason}`).toBe(ScheduleFireOutcome.STARTED);
    fixtures.defer(async () => {
      mock.releaseHolds();
      await awaitTerminal(clients, result.runId);
    });

    const context = await clients.executionContextQuery.getByExecutionId({ executionId: result.runId });
    expect(context.spec?.data.SCHEDULED_KEY?.value).toBe("assigned-value");
  });

  it("[rpc:ScheduleCommandController.trigger] a schedule's fire never reaches its creator's own credential by default: the run is refused, naming what to assign", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgent(org, { SCHEDULED_KEY: {} });
    await createCredential(org, plain({ SCHEDULED_KEY: "personal-value" }), { serves: [agentTarget(refOf(agent))] });
    const schedule = await scheduleOn(org, agent, []);

    const result = await clients.scheduleCommand.trigger({ value: schedule.metadata!.id });
    expect(result.outcome).toBe(ScheduleFireOutcome.REFUSED);
    expect(result.refusalReason).toContain(`agent '${agent.metadata!.slug}' needs SCHEDULED_KEY`);
    expect(result.refusalReason).toContain("uses only what is assigned on the schedule that started it");
    expect(result.runId).toBe("");
  });
});

// --- two people ----------------------------------------------------------------

// Who a run's person is decides whose credentials it may use: a member's run
// takes the member's own credential and never a teammate's, and the
// organization's credential only once the member may use it. Run on the
// enforcing lane, where each person signs in as themselves; a lane with its
// own runner answers its runs from its own mock.
describe("run credentials — a member's run uses the member's credentials (enforcing lane)", () => {
  let lane: EnforcingLane | undefined;
  let laneReason = "";

  beforeAll(async () => {
    const enforcing = await enforcingLaneOf(target);
    lane = enforcing.lane;
    laneReason = enforcing.lane === undefined ? enforcing.reason : "";
  });

  afterEach(() => {
    lane?.llmProxy?.().releaseHolds();
    lane?.llmProxy?.().reset();
  });

  function laneOrSkip(ctx: { skip: (note?: string) => never }): { on: EnforcingLane; llm: MockLlmProxy } {
    if (lane === undefined) ctx.skip(laneReason);
    return { on: lane, llm: lane.llmProxy?.() ?? mock };
  }

  async function people(on: EnforcingLane): Promise<{ context: TenancyContext; member: ConformanceClients }> {
    const context = await on.provisionTenancy();
    fixtures.defer(() => on.cleanupTenancy(context));
    return { context, member: await on.provisionMember(context) };
  }

  it("[rpc:RunCommandController.create] a member's run never uses a teammate's credential: refused until the member saves their own", async (ctx) => {
    const { on, llm } = laneOrSkip(ctx);
    const { context, member } = await people(on);
    const agent = await createAgent(
      context.org,
      { TEAM_AGENT_KEY: {} },
      { using: on.clients, visibility: ApiResourceVisibility.visibility_org },
    );
    await createCredential(context.org, plain({ TEAM_AGENT_KEY: "founder-value" }), {
      serves: [agentTarget(refOf(agent))],
      using: on.clients,
    });

    const message = await refusedRun(context.org, agent, member);
    expect(message).toContain(`agent '${agent.metadata!.slug}' needs TEAM_AGENT_KEY`);

    await createCredential(context.org, plain({ TEAM_AGENT_KEY: "member-value" }), {
      serves: [agentTarget(refOf(agent))],
      using: member,
    });
    const { data } = await heldRun(context.org, agent, { using: member, llm });
    expect(data.TEAM_AGENT_KEY?.value, "the member's run takes the member's own").toBe("member-value");
  });

  it("[rpc:RunCommandController.create] the organization's credential serving an agent reaches an admin's run, and a member's only once granted `user`", async (ctx) => {
    const { on, llm } = laneOrSkip(ctx);
    const { context, member } = await people(on);
    const agent = await createAgent(
      context.org,
      { ORG_AGENT_KEY: {} },
      { using: on.clients, visibility: ApiResourceVisibility.visibility_org },
    );
    const teams = await createCredential(context.org, plain({ ORG_AGENT_KEY: "team-value" }), {
      owner: "org",
      serves: [agentTarget(refOf(agent))],
      using: on.clients,
    });

    const founders = await heldRun(context.org, agent, { using: on.clients, llm });
    expect(founders.data.ORG_AGENT_KEY?.value, "an admin may use the organization's credential").toBe("team-value");
    llm.releaseHolds();

    const message = await refusedRun(context.org, agent, member);
    expect(message).toContain(`agent '${agent.metadata!.slug}' needs ORG_AGENT_KEY`);

    if (!target.capabilities.perResourceGrants) {
      return ctx.skip("the edition grants roles on organizations only, so no one can be made a user of one credential");
    }
    await on.clients.iamPolicyCommand.create(
      policyTriple(
        { kind: "identity_account", id: await on.accountIdOf(member) },
        "user",
        { kind: "credential", id: teams.metadata!.id },
      ),
    );
    const members = await heldRun(context.org, agent, { using: member, llm });
    expect(members.data.ORG_AGENT_KEY?.value, "a `user` of the credential takes it").toBe("team-value");
  });
});
