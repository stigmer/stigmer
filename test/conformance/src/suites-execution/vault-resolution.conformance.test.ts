// Conformance suite for how a run's values are resolved from vaults (Class B).
//
// Domain: agentic — the values that populate a run's ExecutionContext at run
// start, exercised through Run and Schedule. The contract:
//   - what a run needs is what its agent and its tools declare (and a token
//     for each repository it clones); a vault's key nobody declares never
//     reaches the run, while the conversation's own secrets all do (the
//     caller handed them to this conversation);
//   - values come from, in order: the conversation's own values, the
//     conversation's vaults; then, for a run with a person whose
//     conversation lists no vaults, their My vault and the agent's vaults;
//     for a run with no person (a schedule's), only the schedule's vaults;
//   - a plain setting may carry its value in the declaration, and a vault
//     secret of the same name takes its place;
//   - a required key found nowhere refuses the create with
//     FAILED_PRECONDITION naming the key and who must act; an optional one
//     stays absent;
//   - a conversation's own secrets are sealed on the session and every read
//     shows the redaction marker;
//   - recover rebuilds the context from the recorded agent version and the
//     vaults as they are now ("fix the key, then recover").
//
// The two-person arms (a member's run uses their own My vault, never a
// teammate's; an agent's shared vault serves only people who may use it; a
// revoked use stops a schedule's next fire) run on the enforcing execution
// lane in runner-as-subject.conformance.test.ts.
//
// Observation strategy: the ExecutionContext is created SYNCHRONOUSLY inside
// the create pipeline, so it exists the instant create() returns; a held
// mock-LLM turn keeps the run non-terminal (and its ephemeral context alive)
// while getByExecutionId reads it. Every value that came from a vault or the
// conversation's own values comes back with is_secret set and its value
// redacted, whatever its declaration says; only a declaration's own plain
// default reads plain. An arm proves such a value is there by the marker,
// and proves WHICH value the run received through the agent's shell, which
// prints the decrypted value into the next model request.
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScheduleFireOutcome } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { agentRefOf, makeAgent } from "../support/agents";
import {
  awaitPhase,
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  requireMcpFixture,
  sessionIdOf,
} from "../support/runs";
import { makeHttpMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { pollUntil } from "../support/run-poll";
import { makeSchedule } from "../support/schedules";
import { makeSession } from "../support/sessions";
import {
  type EnvVarDeclarationInit,
  makeSharedVault,
  myVaultTarget,
  setSecretsInput,
  vaultTarget,
} from "../support/vaults";
import { createTarget, type TargetProfile } from "../targets";

// The redaction marker every read shows in place of a conversation's own value.
const REDACTED_MARKER = "***REDACTED***";

// Holds a run's single turn open so the run stays non-terminal (and its
// ephemeral ExecutionContext survives) while the suite reads it.
const HOLD_MS = 30_000;

const collectionTarget = createTarget();
const firingEnabled = collectionTarget.capabilities.scheduleFiring;

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
  mock.releaseHolds();
  // An arm can end before its run reaches the model (a first turn's run
  // starts after create answers). Its turn is claimed here, not by the next
  // arm's run, which would otherwise take a script that is not its own.
  // Best-effort, bounded and never a failure: an arm whose create was
  // refused started no run, so its scripted turn is never claimed, and
  // reset() below drops it.
  const claimDeadline = Date.now() + 15_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

/** Saves secrets into the caller's My vault in `org`, creating it on the first write. */
async function saveToMyVault(org: string, secrets: Record<string, string>): Promise<string> {
  const mine = await clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), secrets));
  fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }).catch(() => undefined));
  return mine.metadata!.id;
}

/** A shared vault in `org` holding `secrets`; answers its slug and id. */
async function sharedVaultWith(org: string, secrets: Record<string, string>) {
  const vault = await clients.vaultCommand.create(makeSharedVault({ org, name: uniqueName("run-vault") }));
  fixtures.defer(() => clients.vaultCommand.delete({ resourceId: vault.metadata!.id }));
  await clients.vaultCommand.setSecrets(setSecretsInput(vaultTarget(org, vault.metadata!.id), secrets));
  return { id: vault.metadata!.id, slug: vault.metadata!.slug };
}

interface RunSetup {
  // The agent's declarations: what the run needs.
  env: Record<string, EnvVarDeclarationInit>;
  // The conversation's own secrets.
  sessionSecrets?: Record<string, string>;
  // The conversation's vaults, by slug.
  sessionVaults?: string[];
}

/** Agent -> session (its own values and vaults). */
async function agentAndSession(org: string, setup: RunSetup) {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent"), env: setup.env }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  const session = await clients.sessionCommand.create(
    makeSession({
      org,
      name: uniqueName("session"),
      agentRef: agentRefOf(agent),
      ...(setup.sessionSecrets !== undefined ? { secrets: setup.sessionSecrets } : {}),
      ...(setup.sessionVaults !== undefined ? { vaults: setup.sessionVaults } : {}),
    }),
  );
  fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));
  return { agent, session };
}

/**
 * Agent -> session -> a run whose agent's shell runs `command`, to completion;
 * answers every scripted model request the run made, as text. The shell's
 * output rides the request after the tool round, so it shows the DECRYPTED
 * value the runner received where every user-shaped read shows the marker.
 */
async function shellOutputOf(org: string, setup: RunSetup, command: string): Promise<string> {
  const { session } = await agentAndSession(org, setup);
  mock.enqueue(anthropicToolUse("call_shell", "execute", { command }));
  mock.enqueue(anthropicText("Done."));
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("aex-shell"), sessionId: session.metadata!.id, autoApproveAll: true }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
  const final = await awaitTerminal(clients, executionId);
  expect(
    final.status?.phase,
    `execution ${executionId} should complete; error: ${final.status?.error || "(none)"}`,
  ).toBe(RunPhase.RUN_COMPLETED);
  return mock
    .scriptedRequests()
    .map((request) => JSON.stringify(request.body))
    .join("\n");
}

/** Agent -> session (its own values and vaults) -> a held run; answers the run and its context's values. */
async function runWith(org: string, setup: RunSetup) {
  const { agent, session } = await agentAndSession(org, setup);

  mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("aex"), sessionId: session.metadata!.id }),
  );
  fixtures.defer(async () => {
    await clients.agentExecutionCommand.cancel({ id: execution.metadata!.id }).catch(() => {});
    await clients.agentExecutionCommand.delete({ value: execution.metadata!.id });
  });

  const context = await clients.executionContextQuery.getByExecutionId({ executionId: execution.metadata!.id });
  return { agent, session, execution, data: context.spec?.data ?? {} };
}

describe("vault resolution — a person's run", () => {
  it("[rpc:RunCommandController.create] a key the agent declares is filled from the run's person's My vault", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { MINE_KEY: "my-value" });

    const { data } = await runWith(org, { env: { MINE_KEY: {} } });

    // My vault is the only place holding it: the marker is the proof it is
    // there, and a vault's value is a secret whatever the declaration says.
    expect(data.MINE_KEY?.isSecret, "the person's own vault fills the declared key, as a secret").toBe(true);
    expect(data.MINE_KEY?.value).toBe(REDACTED_MARKER);
  });

  it("the conversation's own secret wins over My vault for a declared key", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { PRECEDENCE_KEY: "from-my-vault" });

    // Both candidates are secrets, so which one won shows only where the
    // runner holds it decrypted: the agent's shell.
    const shell = await shellOutputOf(
      org,
      {
        env: { PRECEDENCE_KEY: {}, SESSION_ONLY_KEY: {} },
        sessionSecrets: { PRECEDENCE_KEY: "from-the-session", SESSION_ONLY_KEY: "session-value" },
      },
      'echo "PRECEDENCE=[$PRECEDENCE_KEY] ONLY=[$SESSION_ONLY_KEY]"',
    );

    expect(shell, "the conversation's own value comes first").toContain("PRECEDENCE=[from-the-session]");
    expect(shell, "My vault's value never reached the run").not.toContain("from-my-vault");
    expect(shell).toContain("ONLY=[session-value]");
  });

  it("a vault's keys reach the run only when declared; the conversation's own secrets all do", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { DECLARED_KEY: "kept", UNDECLARED_VAULT_KEY: "dropped" });

    const { data } = await runWith(org, {
      env: { DECLARED_KEY: {} },
      sessionSecrets: { UNDECLARED_SESSION_KEY: "handed-to-this-conversation" },
    });

    expect(Object.keys(data).sort()).toEqual(["DECLARED_KEY", "UNDECLARED_SESSION_KEY"]);
    expect(data.DECLARED_KEY?.isSecret, "the declared vault key is kept, as a secret").toBe(true);
    expect(data.DECLARED_KEY?.value).toBe(REDACTED_MARKER);
    // A conversation's own secret is delivered as a secret: the user-shaped
    // read shows it redacted, which is the proof it is there.
    expect(data.UNDECLARED_SESSION_KEY?.isSecret, "the caller handed it to this conversation").toBe(true);
    expect(data.UNDECLARED_SESSION_KEY?.value).toBe("***REDACTED***");
  });

  it("a plain setting carries its value in the declaration; a vault secret of the same name takes its place", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { OVERRIDDEN_SETTING: "from-my-vault" });

    const { data } = await runWith(org, {
      env: {
        WORKSPACE_SETTING: { value: "acme" },
        OVERRIDDEN_SETTING: { value: "the-default" },
      },
    });

    expect(data.WORKSPACE_SETTING?.value, "the declaration's own value").toBe("acme");
    expect(data.WORKSPACE_SETTING?.isSecret, "a declaration's own default stays plain").toBe(false);
    // The default would read plain "the-default"; a secret in its place is
    // the saved value, the only secret source holding the key.
    expect(data.OVERRIDDEN_SETTING?.isSecret, "a saved secret of the same name wins").toBe(true);
    expect(data.OVERRIDDEN_SETTING?.value).toBe(REDACTED_MARKER);
  });

  it("[rpc:RunCommandController.create] a required key found nowhere refuses the create naming the key and who must act; an optional one stays absent", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { PROVIDED_KEY: "present" });

    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("agent-missing"),
        env: { PROVIDED_KEY: {}, REQUIRED_MISSING_KEY: {}, OPTIONAL_MISSING_KEY: { optional: true } },
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    let refused: ConnectError | undefined;
    try {
      const created = await clients.agentExecutionCommand.create(
        makeAgentExecution({ org, name: uniqueName("aex-missing"), agentRef: agentRefOf(agent) }),
      );
      fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));
    } catch (error) {
      refused = ConnectError.from(error);
    }
    expect(refused?.code, "a missing required key refuses the create before the run starts").toBe(
      Code.FailedPrecondition,
    );
    expect(refused?.rawMessage).toContain("needs REQUIRED_MISSING_KEY");
    expect(refused?.rawMessage).toContain("add REQUIRED_MISSING_KEY to My vault");
    expect(refused?.rawMessage, "an optional key is never what refuses").not.toContain("OPTIONAL_MISSING_KEY");

    // With an optional key still missing, the run starts and completes.
    const optionalOnly = await runWith(org, { env: { PROVIDED_KEY: {}, OPTIONAL_MISSING_KEY: { optional: true } } });
    expect(optionalOnly.data.PROVIDED_KEY?.isSecret).toBe(true);
    expect(optionalOnly.data.PROVIDED_KEY?.value).toBe(REDACTED_MARKER);
    expect(optionalOnly.data.OPTIONAL_MISSING_KEY, "an unprovided optional key is absent").toBeUndefined();
    mock.releaseHolds();
    const final = await awaitTerminal(clients, optionalOnly.execution.metadata!.id);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });

  it("a conversation that lists vaults uses exactly those: My vault is not read", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { LISTED_KEY: "from-my-vault", MY_ONLY_KEY: "never" });
    const team = await sharedVaultWith(org, { LISTED_KEY: "from-the-team-vault" });

    const { data } = await runWith(org, {
      env: { LISTED_KEY: {}, MY_ONLY_KEY: { optional: true } },
      sessionVaults: [team.slug],
    });

    // With My vault unread (below), the listed vault is the only source left.
    expect(data.LISTED_KEY?.isSecret, "the listed vault fills the key").toBe(true);
    expect(data.LISTED_KEY?.value).toBe(REDACTED_MARKER);
    expect(data.MY_ONLY_KEY, "My vault is not read when the conversation lists vaults").toBeUndefined();
  });

  it("[rpc:SessionCommandController.create] a conversation cannot list anyone's own My vault", async () => {
    const { org } = await target.provisionTenancy();
    const mineId = await saveToMyVault(org, { KEY: "v" });
    const mine = await clients.vaultQuery.get({ value: mineId });

    const input = makeSession({ org, name: uniqueName("session-my-vault"), vaults: [mine.metadata!.slug] });
    let refused: ConnectError | undefined;
    try {
      const created = await clients.sessionCommand.create(input);
      fixtures.defer(() => clients.sessionCommand.delete({ value: created.metadata!.id }));
    } catch (error) {
      refused = ConnectError.from(error);
    }
    expect(refused?.code).toBe(Code.FailedPrecondition);
    expect(refused?.rawMessage).toContain("a My vault cannot be attached to a conversation");
  });

  it("[rpc:ExecutionContextQueryController.getByExecutionId] a secret keeps is_secret and its value is redacted on the user-shaped read", async () => {
    const { org } = await target.provisionTenancy();
    const secretValue = "my-vault-secret-value";
    const plainDeclaredValue = "vault-value-for-a-plain-declaration";
    await saveToMyVault(org, { API_TOKEN: secretValue, PLAIN_DECLARED_KEY: plainDeclaredValue });

    const { data } = await runWith(org, {
      env: { API_TOKEN: { isSecret: true }, PLAIN_KEY: { value: "plain-value" }, PLAIN_DECLARED_KEY: {} },
    });

    expect(data.API_TOKEN?.isSecret, "a secret declaration delivers a secret").toBe(true);
    expect(data.PLAIN_KEY?.value, "a declaration's own plain value is never redacted").toBe("plain-value");
    expect(data.API_TOKEN?.value, "no user-shaped read returns the plaintext secret").not.toBe(secretValue);
    expect(data.PLAIN_DECLARED_KEY?.isSecret, "a vault's value is a secret, even for a plain declaration").toBe(true);
    expect(data.PLAIN_DECLARED_KEY?.value, "and no user-shaped read returns it").not.toBe(plainDeclaredValue);
  });

  it("[rpc:SessionQueryController.get] a conversation's own secrets are sealed: every read shows the marker, and a write sending it back keeps the value", async () => {
    const { org } = await target.provisionTenancy();
    const { session, execution, data } = await runWith(org, {
      env: { OWN_KEY: {} },
      sessionSecrets: { OWN_KEY: "own-value" },
    });
    expect(data.OWN_KEY?.isSecret, "the run carries the conversation's own value, as a secret").toBe(true);
    expect(data.OWN_KEY?.value).toBe(REDACTED_MARKER);

    const read = await clients.sessionQuery.get({ value: session.metadata!.id });
    expect(read.spec?.secrets.OWN_KEY, "a read shows the marker, never the value").toBe(REDACTED_MARKER);

    // Sending back what a read showed keeps the stored value: the next turn
    // still receives it. Every read of that turn's context shows the marker
    // too, so the proof is its agent's shell, which holds the real value.
    mock.releaseHolds();
    const updated = await clients.sessionCommand.update(read);
    expect(updated.spec?.secrets.OWN_KEY).toBe(REDACTED_MARKER);
    // The first turn finishes before the second is scripted, so it can never
    // claim the second turn's shell call.
    await awaitTerminal(clients, execution.metadata!.id);

    mock.enqueue(anthropicToolUse("call_own", "execute", { command: 'echo "OWN=[$OWN_KEY]"' }));
    mock.enqueue(anthropicText("Done."));
    const second = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-second"),
        sessionId: session.metadata!.id,
        autoApproveAll: true,
      }),
    );
    const secondId = second.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: secondId }));
    const final = await awaitTerminal(clients, secondId);
    expect(
      final.status?.phase,
      `execution ${secondId} should complete; error: ${final.status?.error || "(none)"}`,
    ).toBe(RunPhase.RUN_COMPLETED);
    const shell = mock
      .scriptedRequests()
      .map((request) => JSON.stringify(request.body))
      .join("\n");
    expect(shell, "the marker kept the sealed value").toContain("OWN=[own-value]");
    expect(shell, "the run never received the marker as the value").not.toContain(`OWN=[${REDACTED_MARKER}]`);
  });

  it("[rpc:RunCommandController.create] a first turn's own secrets ride its new conversation, never the run", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-first-turn"), env: { FIRST_TURN_KEY: {} } }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-first-turn"),
        agentRef: agentRefOf(agent),
        sessionSecrets: { FIRST_TURN_KEY: "first-turn-value" },
      }),
    );
    fixtures.defer(async () => {
      await clients.agentExecutionCommand.cancel({ id: execution.metadata!.id }).catch(() => {});
      await clients.agentExecutionCommand.delete({ value: execution.metadata!.id });
    });

    const context = await clients.executionContextQuery.getByExecutionId({ executionId: execution.metadata!.id });
    expect(context.spec?.data.FIRST_TURN_KEY?.isSecret, "the first turn's own value reaches its run").toBe(true);
    expect(context.spec?.data.FIRST_TURN_KEY?.value).toBe(REDACTED_MARKER);
    const stored = await clients.agentExecutionQuery.get({ value: execution.metadata!.id });
    expect(stored.spec?.target.case, "the run keeps only the session's id").toBe("sessionId");
    const session = await clients.sessionQuery.get({ value: sessionIdOf(stored) });
    expect(session.spec?.secrets.FIRST_TURN_KEY).toBe(REDACTED_MARKER);
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

describe("vault resolution — recover", () => {
  it("[rpc:RunCommandController.recover] recover rebuilds the context create built: the recorded agent version's keys, from the run's person's My vault as it is now", async () => {
    const { org } = await target.provisionTenancy();
    // RUN_KEY is not saved yet when the run is created, and saved before it
    // is recovered: every read of a vault value shows the marker, so the
    // key's arrival is what proves recover read My vault as it is now.
    await saveToMyVault(org, { LATER_KEY: "later-value" });

    const agentName = uniqueName("agent-recover-keys");
    const v1 = await clients.agentCommand.apply(
      makeAgent({ org, name: agentName, env: { RUN_KEY: { optional: true } } }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: v1.metadata!.id }));

    mock.enqueueError(400, { delayMs: 2_000 });
    // A subject of its own, so no title call races the turn for the
    // scripted failure.
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-recover-keys"),
        agentRef: agentRefOf(v1),
        sessionSpec: { subject: "recover keys" },
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(async () => {
      await clients.agentExecutionCommand.cancel({ id: executionId }).catch(() => {});
      await clients.agentExecutionCommand.delete({ value: executionId });
    });
    expect(execution.status?.credentials?.person, "create records the run's person").toBeDefined();
    const built = await clients.executionContextQuery.getByExecutionId({ executionId });
    expect(built.spec?.data.RUN_KEY, "create found the run's key nowhere yet").toBeUndefined();

    await awaitPhase(clients, executionId, RunPhase.RUN_FAILED);
    await pollUntil(
      () => contextState(executionId),
      (state) => state === "gone",
      (_, timeoutMs) => `execution ${executionId}'s ExecutionContext was still readable ${timeoutMs}ms after it FAILED`,
      { timeoutMs: 30_000 },
    );

    const v2 = await clients.agentCommand.apply(makeAgent({ org, name: agentName, env: { LATER_KEY: {} } }));
    expect(v2.status?.versionHash, "the author's save is a new version").not.toBe(v1.status?.versionHash);
    await clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), { RUN_KEY: "fixed-value" }));

    mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
    await clients.agentExecutionCommand.recover({ id: executionId });
    const rebuilt = await clients.executionContextQuery.getByExecutionId({ executionId });
    const data = rebuilt.spec?.data ?? {};
    expect(Object.keys(data).sort(), "recover rebuilds the recorded version's keys, not the head's").toEqual([
      "RUN_KEY",
    ]);
    expect(data.RUN_KEY?.isSecret, "from the recorded person's My vault, as it is now").toBe(true);
    expect(data.RUN_KEY?.value).toBe(REDACTED_MARKER);
    const recovered = await clients.agentExecutionQuery.get({ value: executionId });
    expect(recovered.status?.credentials?.person, "recover keeps the recorded person").toBe(
      execution.status?.credentials?.person,
    );
  });
});

// The agent's shell holds only what the AGENT declares: a key a session's own
// MCP server declares reaches the run and that server, never the shell.
// Observed where the model sees it: the shell tool's output in the next model
// request.
describe("vault resolution — the agent's shell", () => {
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
        secrets: { SHELL_AGENT_KEY: "agent-visible-value", SHELL_MCP_ONLY_KEY: "mcp-only-value" },
        ...(serverOn === "session" ? { mcpServerRefs: [server.metadata!.slug] } : {}),
      }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

    mock.enqueue(
      anthropicToolUse("call_printenv", "execute", {
        // `env | grep`, not `printenv A B`: BSD printenv prints one name.
        command: "env | grep '^SHELL_' ; true",
      }),
      { delayMs: 10_000 },
    );
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-shell"), sessionId: session.metadata!.id, autoApproveAll: true }),
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

  it("a vault secret reaches the runner decrypted: the agent's shell prints the My vault secret's value", async () => {
    // The end-to-end proof of the runner decrypt lane: a My vault secret
    // (sealed at rest) -> the resolver opens it into the context -> the
    // context seals it at rest -> the runner reads the context decrypted ->
    // the shell holds the real value.
    const { org } = await target.provisionTenancy();
    const secretValue = "proof-secret-value";
    await saveToMyVault(org, { SHELL_PROOF_TOKEN: secretValue });
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("secret-agent"), env: { SHELL_PROOF_TOKEN: { isSecret: true } } }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

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
    expect(
      JSON.stringify(scripted[1]?.body),
      "the shell held the decrypted secret, not the marker or ciphertext",
    ).toContain(`PROOF=[${secretValue}]`);
  });
});

// A schedule's fire has no person: it uses only the vaults the schedule
// names, never its owner's My vault unless the owner attached it.
describe.skipIf(!firingEnabled)("vault resolution — a schedule's fire (scheduleFiring targets)", () => {
  async function scheduleOn(org: string, env: Record<string, EnvVarDeclarationInit>, vaults: string[] = []) {
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("sched-agent"), env }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const schedule = await clients.scheduleCommand.create(
      makeSchedule(org, uniqueName("sched-vault"), agent.metadata!.slug, { vaults }),
    );
    fixtures.defer(() => clients.scheduleCommand.delete({ value: schedule.metadata!.id }));
    return schedule;
  }

  it("[rpc:ScheduleCommandController.trigger] a fire never reads its owner's My vault: a key only there refuses the fire, naming the key and the schedule", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { SCHED_KEY: "owner-value" });
    const schedule = await scheduleOn(org, { SCHED_KEY: {} });

    const result = await clients.scheduleCommand.trigger({ value: schedule.metadata!.id });

    expect(result.outcome, "a person-less fire with a key nowhere it may look is refused").not.toBe(
      ScheduleFireOutcome.STARTED,
    );
    expect(result.runId).toBe("");
    expect(result.refusalReason).toContain("needs SCHED_KEY");
    expect(result.refusalReason).toContain("ask the owner of schedule");
  });

  it("[rpc:ScheduleCommandController.trigger] a fire uses the schedule's own vaults", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { SCHED_KEY: "owner-value", OWNER_ONLY_KEY: "owner-only" });
    const team = await sharedVaultWith(org, { SCHED_KEY: "schedule-value" });
    const schedule = await scheduleOn(org, { SCHED_KEY: {}, OWNER_ONLY_KEY: { optional: true } }, [team.slug]);
    expect(Object.values(schedule.status?.vaultAttachers ?? {}), "the attacher is recorded").toHaveLength(1);

    mock.enqueue(anthropicText("Scheduled work..."), { delayMs: HOLD_MS });
    const result = await clients.scheduleCommand.trigger({ value: schedule.metadata!.id });
    expect(result.outcome, `fire refused: ${result.refusalReason}`).toBe(ScheduleFireOutcome.STARTED);
    fixtures.defer(async () => {
      await clients.agentExecutionCommand.cancel({ id: result.runId }).catch(() => {});
      await clients.agentExecutionCommand.delete({ value: result.runId });
    });

    const context = await clients.executionContextQuery.getByExecutionId({ executionId: result.runId });
    // A key only the owner's My vault holds stays absent, so the fire read no
    // My vault, and the schedule's vault is what filled SCHED_KEY.
    expect(context.spec?.data.OWNER_ONLY_KEY, "the fire never reads its owner's My vault").toBeUndefined();
    expect(context.spec?.data.SCHED_KEY?.isSecret, "the schedule's vault fills the key").toBe(true);
    expect(context.spec?.data.SCHED_KEY?.value).toBe(REDACTED_MARKER);
    const fired = await clients.agentExecutionQuery.get({ value: result.runId });
    expect(fired.status?.credentials?.person, "a fire records no person").toBeUndefined();
  });

  it("[rpc:ScheduleCommandController.create] a schedule may carry its owner's own My vault, and its fires use it", async () => {
    const { org } = await target.provisionTenancy();
    const mineId = await saveToMyVault(org, { OWNERS_KEY: "owners-own" });
    const mine = await clients.vaultQuery.get({ value: mineId });
    const schedule = await scheduleOn(org, { OWNERS_KEY: {} }, [mine.metadata!.slug]);

    mock.enqueue(anthropicText("Scheduled work..."), { delayMs: HOLD_MS });
    const result = await clients.scheduleCommand.trigger({ value: schedule.metadata!.id });
    expect(result.outcome, `fire refused: ${result.refusalReason}`).toBe(ScheduleFireOutcome.STARTED);
    fixtures.defer(async () => {
      await clients.agentExecutionCommand.cancel({ id: result.runId }).catch(() => {});
      await clients.agentExecutionCommand.delete({ value: result.runId });
    });
    const context = await clients.executionContextQuery.getByExecutionId({ executionId: result.runId });
    expect(context.spec?.data.OWNERS_KEY?.isSecret, "the owner's attached My vault fills the key").toBe(true);
    expect(context.spec?.data.OWNERS_KEY?.value).toBe(REDACTED_MARKER);
  });

  it("[rpc:ScheduleCommandController.create] a schedule's repository cannot carry a token: it names a vault instead", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("sched-repo-agent") }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const input = makeSchedule(org, uniqueName("sched-repo"), agent.metadata!.slug, {
      repositories: [{ name: "repo", url: "https://github.com/acme/repo", token: "ghp-inline" }],
    });
    let refused: ConnectError | undefined;
    try {
      const created = await clients.scheduleCommand.create(input);
      fixtures.defer(() => clients.scheduleCommand.delete({ value: created.metadata!.id }));
    } catch (error) {
      refused = ConnectError.from(error);
    }
    expect(refused?.code).toBe(Code.InvalidArgument);
    expect(refused?.rawMessage).toContain("cannot carry a token");
  });
});
