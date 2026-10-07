// Conformance suite for environment-merge precedence (Class B).
//
// Domain: agentic — the env layering that populates an ExecutionContext at
// run start, exercised through Run. The merge contract (value layers +
// blueprint key whitelist, stigmer#222): a turn's value layers are the
// lane's (a PlatformClient's or a schedule's environment_refs) and its own
// runtime_env; the agent's spec.env is a KEY WHITELIST (+ required/optional
// schema), never a value source, so a key the agent does not declare is
// dropped wherever it came from; and a declared key no layer carries is
// filled from the run's person's personal environment, by declared key,
// after every layer (the personal-key bridge; the two-person form, where a
// member's turn reads the member's value and never the agent author's, is
// pinned on the enforcing lane in runner-as-subject.conformance.test.ts).
//
// A declared key no layer and no personal value carries is only a warning:
// the run starts and completes without it. Recover rebuilds the context the
// failed run's end deleted, from the agent version the turn recorded and the
// same person's personal environment as it is now, so a key fixed between
// the failure and the recover reaches the recovered run.
//
// Observation strategy: the ExecutionContext is created SYNCHRONOUSLY
// inside the create pipeline, so it exists the instant create() returns; a
// held mock-LLM turn keeps the run non-terminal (and its ephemeral context
// alive) while getByExecutionId reads it. Values are plain (not secret) so
// the read shows them unredacted, except in the secret cases: the harness
// reads as a user, so a merged secret comes back with is_secret set and its
// value redacted (stigmer#535), and the proof that the RUNNER still receives
// it decrypted is the agent's shell printing it into the next model request.
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { agentRefOf, makeAgent } from "../support/agents";
import { awaitPhase, awaitTerminal, makeAgentExecution, requireLlmProxy, requireMcpFixture } from "../support/runs";
import { makeHttpMcpServer } from "../support/mcpservers";
import { type EnvVarDeclarationInit, type EnvironmentValueInit, makePersonalEnvironment } from "../support/environments";
import { type ExecutionValueInit } from "../support/executioncontexts";
import { uniqueName } from "../support/naming";
import { pollUntil } from "../support/run-poll";
import { makeSession } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

// Holds a run's single turn open so the run stays non-terminal (and its
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
// Run (runtime_env) in the session. A held mock turn keeps the run
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

  it("a required declared key that is unprovisioned is absent and the run is NOT failed (warn-only)", async () => {
    const { org } = await target.provisionTenancy();
    const { execution, data } = await runAgentMerge(org, {
      personal: { PROVIDED_KEY: { value: "present", isSecret: false } },
      env: { PROVIDED_KEY: {}, REQUIRED_MISSING_KEY: {}, OPTIONAL_MISSING_KEY: { optional: true } },
    });

    expect(data.PROVIDED_KEY?.value).toBe("present");
    expect(data.REQUIRED_MISSING_KEY, "an unprovisioned required key is absent, not defaulted").toBeUndefined();
    expect(data.OPTIONAL_MISSING_KEY, "an unprovisioned optional key is absent").toBeUndefined();
    // create() ran the merge in its pipeline and answered: the missing
    // required key failed neither the create nor, below, the turn.
    expect(execution.status?.phase, "a missing required key does not fail the run").not.toBe(RunPhase.RUN_FAILED);

    mock.releaseHolds();
    const final = await awaitTerminal(clients, execution.metadata!.id);
    expect(
      final.status?.phase,
      `the turn runs without the missing key; error: ${final.status?.error || "(none)"}`,
    ).toBe(RunPhase.RUN_COMPLETED);
  });

  it("[rpc:ExecutionContextQueryController.getByExecutionId] a secret value survives the merge with is_secret preserved and its value redacted on the user-shaped read", async () => {
    const { org } = await target.provisionTenancy();
    const secretValue = "personal-secret-value";
    const { data } = await runAgentMerge(org, {
      personal: { API_TOKEN: { value: secretValue, isSecret: true }, PLAIN_KEY: { value: "plain-value" } },
      env: { API_TOKEN: { isSecret: true }, PLAIN_KEY: {} },
    });

    expect(data.API_TOKEN?.isSecret, "is_secret is preserved through the merge").toBe(true);
    expect(data.PLAIN_KEY?.value, "plaintext values are never redacted").toBe("plain-value");
    // The harness is a user-shaped caller, so the merged secret is redacted
    // (stigmer#535). That the runner receives the decrypted value is the
    // shell case below.
    expect(data.API_TOKEN?.value, "no user-shaped read returns the plaintext secret").not.toBe(secretValue);
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

describe("envmerge conformance — recover", () => {
  it("[rpc:RunCommandController.recover] recover rebuilds the context create built: the recorded agent version's keys, from the same person's personal environment as it is now", async () => {
    // The first turn fails, and the run's end deletes its context. Between
    // the failure and the recover the agent's author saves a version
    // declaring another key, and the person fixes the key's value: the
    // recovered run reads the version the turn recorded, with the value as
    // it is at recover ("fix the key, then recover").
    const { org } = await target.provisionTenancy();
    const personalName = uniqueName("personal");
    const personal = await clients.environmentCommand.apply(
      makePersonalEnvironment({
        org,
        name: personalName,
        data: { RUN_KEY: { value: "broken-value" }, LATER_KEY: { value: "later-value" } },
      }),
    );
    fixtures.defer(() => clients.environmentCommand.delete({ resourceId: personal.metadata!.id }));

    const agentName = uniqueName("agent-recover-keys");
    const v1 = await clients.agentCommand.apply(makeAgent({ org, name: agentName, env: { RUN_KEY: {} } }));
    fixtures.defer(() => clients.agentCommand.delete({ value: v1.metadata!.id }));

    // A non-retryable failure, answered after a moment so create's context
    // is read before the failed run's end deletes it.
    mock.enqueueError(400, { delayMs: 2_000 });
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-recover-keys"), agentRef: agentRefOf(v1) }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(async () => {
      await clients.agentExecutionCommand.cancel({ id: executionId }).catch(() => {});
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
    await clients.environmentCommand.apply(
      makePersonalEnvironment({
        org,
        name: personalName,
        data: { RUN_KEY: { value: "fixed-value" }, LATER_KEY: { value: "later-value" } },
      }),
    );

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

  it("a merged secret reaches the runner decrypted: the agent's shell prints the personal environment's secret value (stigmer#535)", async () => {
    // The end-to-end proof of the runner decrypt lane: a personal
    // Environment secret (encrypted at rest) -> the fill decrypts it into
    // the context -> the context encrypts it at rest -> the runner exchanges
    // for an execution-scoped token and reads the context decrypted -> the
    // shell holds the real value. Had any link served the redaction marker
    // or ciphertext, the shell would print that instead.
    const { org } = await target.provisionTenancy();
    const secretValue = "proof-secret-value";
    const personal = await clients.environmentCommand.create(
      makePersonalEnvironment({
        org,
        name: uniqueName("personal"),
        data: { SHELL_PROOF_TOKEN: { value: secretValue, isSecret: true } },
      }),
    );
    fixtures.defer(() => clients.environmentCommand.delete({ resourceId: personal.metadata!.id }));
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("secret-agent"), env: { SHELL_PROOF_TOKEN: { isSecret: true } } }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    mock.enqueue(anthropicToolUse("call_proof", "execute", { command: 'echo "PROOF=[$SHELL_PROOF_TOKEN]"' }));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-secret-proof"),
        agentRef: agentRefOf(agent),
        autoApproveAll: true,
      }),
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
    expect(
      JSON.stringify(scripted[1]?.body),
      "the shell held the decrypted secret, not the marker or ciphertext",
    ).toContain(`PROOF=[${secretValue}]`);
  });
});
