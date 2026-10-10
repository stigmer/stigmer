// Conformance suite for how a run's values are resolved from vaults (Class B).
//
// Domain: agentic — where each value a run uses lives (the run's source
// manifest, planned at create) and what the runner fetches from those vaults
// when the work starts, exercised through Run and Schedule. The contract:
//   - what a run needs is what its agent and its tools declare (and a token
//     for each repository it clones); a vault's key nobody declares never
//     reaches the run;
//   - values come from, in order: the sender's My vault when the
//     conversation includes it (include_my_vault), then the conversation's
//     vaults; a conversation that leaves My vault out never reads it; for a
//     run with no person (a schedule's), only the schedule's vaults;
//   - a plain setting may carry its value in the declaration, and a vault
//     secret of the same name takes its place;
//   - a required key found nowhere refuses the create with
//     FAILED_PRECONDITION naming the key and what the conversation lacks;
//     an optional one stays absent;
//   - a repository's own token is sealed on the session: every read shows
//     the redaction marker, and a write sending it back keeps it; a stale
//     write keeps the stored vault choice;
//   - nothing is copied: the runner's fetch opens the manifest's entries as
//     they are when it runs, so a secret rotated after create reaches the
//     run, and recover plans again from the recorded agent version and the
//     vaults as they are now ("fix the key, then recover");
//   - only a runner credential bound to the live run fetches its values:
//     the person's own credential, another run's credential and no
//     credential are refused, never answered redacted;
//   - no vault value rides the run's Temporal history.
//
// The two-person arms (each sender's turn uses their own My vault, never a
// teammate's; a run reads only the vaults its conversation chose; a
// revoked use stops a schedule's next fire) run on the enforcing execution
// lane in runner-as-subject.conformance.test.ts.
//
// Observation strategy: the manifest is stamped SYNCHRONOUSLY inside the
// create pipeline, so the run's status names every value's source the
// instant create() returns: which vault (by id) and which entry, never a
// value. What the runner receives is read the way a runner reads it, through
// the fetch with the run's own credential (the platform exchange mints one),
// while a held mock-LLM turn keeps the run live; and, end to end, through the
// agent's shell, which prints the value into the next model request.
import { create, toJsonString } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { expectGrpcCode } from "../contract/errors";
import { ScheduleFireOutcome } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { WorkspaceEntrySchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { invokeWorkflowIdFor, showWorkflow } from "../benchmark/temporal-history";
import { TEMPORAL_DEV_NAMESPACE } from "@stigmer/test-support/temporal";
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
import {
  RunValueDeclarerKind,
  RunValueOrigin,
  agentSourceOf,
  fetchRunValues,
  runCredentialOf,
  runSourcesOf,
  sourcesFor,
} from "../support/run-values";
import { makeSchedule } from "../support/schedules";
import { makeSession, makeSessionSpec } from "../support/sessions";
import {
  type EnvVarDeclarationInit,
  makeSharedVault,
  myVaultTarget,
  setSecretsInput,
  vaultTarget,
} from "../support/vaults";
import { createTarget, type TargetProfile } from "../targets";

// The redaction marker every read shows in place of a sealed value.
const REDACTED_MARKER = "***REDACTED***";

// Holds a run's single turn open so the run stays live while the suite
// fetches its values.
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
  // Whether the conversation includes its sender's My vault.
  includeMyVault?: boolean;
  // The conversation's vaults, by slug.
  sessionVaults?: string[];
}

/** Agent -> session (the vaults it uses). */
async function agentAndSession(org: string, setup: RunSetup) {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent"), env: setup.env }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  const session = await clients.sessionCommand.create(
    makeSession({
      org,
      name: uniqueName("session"),
      agentRef: agentRefOf(agent),
      ...(setup.includeMyVault !== undefined ? { includeMyVault: setup.includeMyVault } : {}),
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

/** Agent -> session (the vaults it uses) -> a held run; answers the run and its source manifest. */
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

  const sources = await runSourcesOf(clients, execution.metadata!.id);
  return { agent, session, execution, sources };
}

/** The values the held run's runner would fetch, with the run's own credential. */
async function fetchedValuesOf(runId: string) {
  return fetchRunValues(target.clientsPresenting(await runCredentialOf(clients, runId)), runId);
}

/** Creates a run on a new conversation of a fresh agent declaring `env`; answers the refusal, or undefined when it started. */
async function refusalOfFirstTurn(
  org: string,
  env: Record<string, EnvVarDeclarationInit>,
  sessionSpec: { includeMyVault?: boolean; vaults?: string[] },
): Promise<ConnectError | undefined> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-missing"), env }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  try {
    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-missing"),
        agentRef: agentRefOf(agent),
        sessionSpec: makeSessionSpec(sessionSpec),
      }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: created.metadata!.id }));
    return undefined;
  } catch (error) {
    return ConnectError.from(error);
  }
}

describe("vault resolution — a person's run", () => {
  it("[rpc:RunCommandController.create] a key the agent declares is filled from the sender's My vault when the conversation includes it", async () => {
    const { org } = await target.provisionTenancy();
    const mineId = await saveToMyVault(org, { MINE_KEY: "my-value" });

    const { execution, sources } = await runWith(org, { env: { MINE_KEY: {} }, includeMyVault: true });

    const source = agentSourceOf(sources, "MINE_KEY");
    expect(source?.origin, "the person's own vault fills the declared key").toBe(RunValueOrigin.MY_VAULT);
    expect(source?.vaultId).toBe(mineId);
    expect(source?.entry).toBe("MINE_KEY");
    const stored = await clients.agentExecutionQuery.get({ value: execution.metadata!.id });
    expect(toJsonString(RunSchema, stored), "the run's status names the source, never the value").not.toContain(
      "my-value",
    );
  });

  it("a conversation that leaves My vault out never reads it", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { MY_ONLY_KEY: "never" });

    const { sources } = await runWith(org, { env: { MY_ONLY_KEY: { optional: true } } });

    expect(sourcesFor(sources, "MY_ONLY_KEY"), "include_my_vault is off on the wire unless the caller sets it").toEqual([]);
  });

  it("My vault comes first, ahead of the vaults the conversation lists", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { PRECEDENCE_KEY: "from-my-vault" });
    const team = await sharedVaultWith(org, { PRECEDENCE_KEY: "from-the-team-vault", LISTED_ONLY_KEY: "listed-value" });

    // Both candidates are secrets, so which one won shows only where the
    // runner holds it decrypted: the agent's shell.
    const shell = await shellOutputOf(
      org,
      {
        env: { PRECEDENCE_KEY: {}, LISTED_ONLY_KEY: {} },
        includeMyVault: true,
        sessionVaults: [team.slug],
      },
      'echo "PRECEDENCE=[$PRECEDENCE_KEY] ONLY=[$LISTED_ONLY_KEY]"',
    );

    expect(shell, "the sender's own value comes first").toContain("PRECEDENCE=[from-my-vault]");
    expect(shell, "the listed vault's value lost to it").not.toContain("from-the-team-vault");
    expect(shell, "a listed vault fills what My vault lacks").toContain("ONLY=[listed-value]");
  });

  it("a vault's keys reach the run only when declared", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { DECLARED_KEY: "kept", UNDECLARED_VAULT_KEY: "dropped" });

    const { execution, sources } = await runWith(org, { env: { DECLARED_KEY: {} }, includeMyVault: true });

    expect(sources.map((source) => source.key)).toEqual(["DECLARED_KEY"]);
    const fetched = await fetchedValuesOf(execution.metadata!.id);
    expect(Object.keys(fetched.agent), "the runner receives only the declared key").toEqual(["DECLARED_KEY"]);
    expect(fetched.agent.DECLARED_KEY).toBe("kept");
  });

  it("a plain setting carries its value in the declaration; a vault secret of the same name takes its place", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { OVERRIDDEN_SETTING: "from-my-vault" });

    const { execution, sources } = await runWith(org, {
      env: {
        WORKSPACE_SETTING: { value: "acme" },
        OVERRIDDEN_SETTING: { value: "the-default" },
      },
      includeMyVault: true,
    });

    const setting = agentSourceOf(sources, "WORKSPACE_SETTING");
    expect(setting?.origin, "the declaration's own value").toBe(RunValueOrigin.DECLARATION);
    expect(setting?.plainValue).toBe("acme");
    expect(agentSourceOf(sources, "OVERRIDDEN_SETTING")?.origin, "a saved secret of the same name wins").toBe(
      RunValueOrigin.MY_VAULT,
    );
    const fetched = await fetchedValuesOf(execution.metadata!.id);
    expect(fetched.agent.WORKSPACE_SETTING, "a declaration's own default is delivered").toBe("acme");
    expect(fetched.agent.OVERRIDDEN_SETTING).toBe("from-my-vault");
  });

  it("[rpc:RunCommandController.create] a required key found nowhere refuses the create naming the key and what the conversation lacks; an optional one stays absent", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { PROVIDED_KEY: "present" });
    const team = await sharedVaultWith(org, { OTHER_KEY: "unrelated" });
    const env = { PROVIDED_KEY: {}, REQUIRED_MISSING_KEY: {}, OPTIONAL_MISSING_KEY: { optional: true } };

    const included = await refusalOfFirstTurn(org, env, { includeMyVault: true });
    expect(included?.code, "a missing required key refuses the create before the run starts").toBe(
      Code.FailedPrecondition,
    );
    expect(included?.rawMessage).toContain("needs REQUIRED_MISSING_KEY");
    expect(included?.rawMessage).toContain("add REQUIRED_MISSING_KEY to My vault");
    expect(included?.rawMessage, "an optional key is never what refuses").not.toContain("OPTIONAL_MISSING_KEY");

    const listed = await refusalOfFirstTurn(org, env, { vaults: [team.slug] });
    expect(listed?.code).toBe(Code.FailedPrecondition);
    expect(listed?.rawMessage).toContain(
      "add REQUIRED_MISSING_KEY to one of this conversation's vaults, or include My vault in this conversation",
    );

    const none = await refusalOfFirstTurn(org, env, {});
    expect(none?.code).toBe(Code.FailedPrecondition);
    expect(none?.rawMessage).toContain(
      "this conversation uses no vaults: include My vault in it, or list a vault that holds PROVIDED_KEY",
    );

    // With an optional key still missing, the run starts and completes.
    const optionalOnly = await runWith(org, {
      env: { PROVIDED_KEY: {}, OPTIONAL_MISSING_KEY: { optional: true } },
      includeMyVault: true,
    });
    expect(agentSourceOf(optionalOnly.sources, "PROVIDED_KEY")?.origin).toBe(RunValueOrigin.MY_VAULT);
    expect(
      sourcesFor(optionalOnly.sources, "OPTIONAL_MISSING_KEY"),
      "an unprovided optional key has no source",
    ).toEqual([]);
    mock.releaseHolds();
    const final = await awaitTerminal(clients, optionalOnly.execution.metadata!.id);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });

  it("a conversation that lists vaults and leaves My vault out uses exactly those", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { LISTED_KEY: "from-my-vault", MY_ONLY_KEY: "never" });
    const team = await sharedVaultWith(org, { LISTED_KEY: "from-the-team-vault" });

    const { sources } = await runWith(org, {
      env: { LISTED_KEY: {}, MY_ONLY_KEY: { optional: true } },
      sessionVaults: [team.slug],
    });

    const listed = agentSourceOf(sources, "LISTED_KEY");
    expect(listed?.origin, "the listed vault fills the key").toBe(RunValueOrigin.VAULT);
    expect(listed?.vaultId).toBe(team.id);
    expect(sourcesFor(sources, "MY_ONLY_KEY"), "My vault is not read when the conversation leaves it out").toEqual([]);
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
    expect(refused?.rawMessage, "the refusal names the door that serves it").toContain("include My vault in it instead");
  });

  it("[rpc:VaultValueController.fetchValues] only the run's own runner credential fetches its values, vault secrets and plain defaults alike; anyone else is refused, never answered redacted", async () => {
    const { org } = await target.provisionTenancy();
    const secretValue = "my-vault-secret-value";
    const plainDeclaredValue = "vault-value-for-a-plain-declaration";
    await saveToMyVault(org, { API_TOKEN: secretValue, PLAIN_DECLARED_KEY: plainDeclaredValue });
    const env = { API_TOKEN: { isSecret: true }, PLAIN_KEY: { value: "plain-value" }, PLAIN_DECLARED_KEY: {} };

    const run = await runWith(org, { env, includeMyVault: true });
    const runId = run.execution.metadata!.id;
    const fetched = await fetchedValuesOf(runId);
    expect(fetched.agent.API_TOKEN).toBe(secretValue);
    expect(fetched.agent.PLAIN_KEY, "a declaration's own plain value is delivered").toBe("plain-value");
    expect(fetched.agent.PLAIN_DECLARED_KEY, "a vault's value fills a plain declaration").toBe(plainDeclaredValue);

    // The person who sent the turn is no runner: refused.
    await expectGrpcCode(
      () => fetchRunValues(clients, runId),
      Code.PermissionDenied,
      "the person's own credential fetching their run's values",
    );
    // No credential at all: refused, by the fetch where the server admits
    // an anonymous caller (trusted-local) or by authentication where it
    // requires one.
    let anonymous: ConnectError | undefined;
    try {
      await fetchRunValues(target.anonymousClients(), runId);
    } catch (error) {
      anonymous = ConnectError.from(error);
    }
    expect([Code.PermissionDenied, Code.Unauthenticated], "no credential fetching a run's values").toContain(
      anonymous?.code,
    );
    // A credential bound to another live run: refused. Its own run's turn is
    // held like the first one's.
    const other = await runWith(org, { env: {} });
    const otherCredential = await runCredentialOf(clients, other.execution.metadata!.id);
    await expectGrpcCode(
      () => fetchRunValues(target.clientsPresenting(otherCredential), runId),
      Code.PermissionDenied,
      "another run's credential fetching this run's values",
    );
  });

  it("[rpc:VaultValueController.fetchValues] nothing is copied: a secret rotated in its vault after the run was created reaches the runner's next fetch", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { ROTATED_KEY: "before-rotation" });
    const { execution } = await runWith(org, { env: { ROTATED_KEY: {} }, includeMyVault: true });
    const runId = execution.metadata!.id;

    expect((await fetchedValuesOf(runId)).agent.ROTATED_KEY).toBe("before-rotation");
    await clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), { ROTATED_KEY: "after-rotation" }));
    expect(
      (await fetchedValuesOf(runId)).agent.ROTATED_KEY,
      "the fetch opens the vault as it is now",
    ).toBe("after-rotation");
  });

  it("[rpc:SessionCommandController.update] a repository's token is sealed and kept by a write sending the marker back; a stale write keeps the stored vault choice", async () => {
    const { org } = await target.provisionTenancy();
    const team = await sharedVaultWith(org, { TEAM_KEY: "team-value" });
    const input = makeSession({
      org,
      name: uniqueName("session-repo-token"),
      includeMyVault: true,
      vaults: [team.slug],
    });
    input.spec!.workspaceEntries = [
      create(WorkspaceEntrySchema, {
        name: "app",
        source: { source: { case: "gitRepo", value: { url: "https://github.com/acme/app", token: "ghp-own-token" } } },
      }),
    ];
    const created = await clients.sessionCommand.create(input);
    fixtures.defer(() => clients.sessionCommand.delete({ value: created.metadata!.id }));
    const tokenOf = (session: typeof created): string | undefined => {
      const source = session.spec?.workspaceEntries[0]?.source?.source;
      return source?.case === "gitRepo" ? source.value.token : undefined;
    };

    // The read a runner takes when its turn starts, written back after.
    const turnStartRead = await clients.sessionQuery.get({ value: created.metadata!.id });
    expect(tokenOf(turnStartRead), "a read shows the marker, never the token").toBe(REDACTED_MARKER);
    expect(turnStartRead.spec?.includeMyVault).toBe(true);
    expect(turnStartRead.spec?.vaults.map((ref) => ref.slug)).toEqual([team.slug]);

    // The creator leaves My vault out and removes the team vault mid-turn.
    const fresh = await clients.sessionQuery.get({ value: created.metadata!.id });
    fresh.spec!.includeMyVault = false;
    fresh.spec!.vaults = [];
    const changed = await clients.sessionCommand.update(fresh);
    expect(changed.spec?.includeMyVault).toBe(false);
    expect(changed.spec?.vaults).toEqual([]);

    // The runner's after-turn write echoes the older read: it keeps the
    // stored choice and the stored token.
    const afterTurn = await clients.sessionCommand.update(turnStartRead);
    expect(afterTurn.spec?.includeMyVault, "a stale write never switches My vault back").toBe(false);
    expect(afterTurn.spec?.vaults, "nor re-attaches a vault removed since").toEqual([]);
    expect(tokenOf(afterTurn)).toBe(REDACTED_MARKER);

    // A current write sending the marker back is accepted only when a token
    // is stored behind it: the token survived both writes.
    const current = await clients.sessionQuery.get({ value: created.metadata!.id });
    const kept = await clients.sessionCommand.update(current);
    expect(tokenOf(kept), "the marker kept the sealed token").toBe(REDACTED_MARKER);
  });

  it("[rpc:RunCommandController.create] a first turn's My vault choice rides its new conversation", async () => {
    const { org } = await target.provisionTenancy();
    await saveToMyVault(org, { FIRST_TURN_KEY: "first-turn-value" });
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
        includeMyVault: true,
      }),
    );
    fixtures.defer(async () => {
      await clients.agentExecutionCommand.cancel({ id: execution.metadata!.id }).catch(() => {});
      await clients.agentExecutionCommand.delete({ value: execution.metadata!.id });
    });

    const sources = await runSourcesOf(clients, execution.metadata!.id);
    expect(agentSourceOf(sources, "FIRST_TURN_KEY")?.origin, "the first turn reads its sender's My vault").toBe(
      RunValueOrigin.MY_VAULT,
    );
    const stored = await clients.agentExecutionQuery.get({ value: execution.metadata!.id });
    expect(stored.spec?.target.case, "the run keeps only the session's id").toBe("sessionId");
    const session = await clients.sessionQuery.get({ value: sessionIdOf(stored) });
    expect(session.spec?.includeMyVault, "the choice is the conversation's").toBe(true);
  });
});

describe("vault resolution — recover", () => {
  it("[rpc:RunCommandController.recover] recover plans the run's values again: the recorded agent version's keys, from the run's person's My vault as it is now, and the runner fetches the fixed value", async () => {
    const { org } = await target.provisionTenancy();
    // RUN_KEY is not saved yet when the run is created, and saved before it
    // is recovered: its arrival in the manifest, and the fixed value in the
    // fetch, prove recover read My vault as it is now.
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
        sessionSpec: { subject: "recover keys", includeMyVault: true },
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(async () => {
      await clients.agentExecutionCommand.cancel({ id: executionId }).catch(() => {});
      await clients.agentExecutionCommand.delete({ value: executionId });
    });
    expect(execution.status?.credentials?.person, "create records the run's person").toBeDefined();
    expect(sourcesFor(await runSourcesOf(clients, executionId), "RUN_KEY"), "create found the run's key nowhere yet").toEqual(
      [],
    );

    await awaitPhase(clients, executionId, RunPhase.RUN_FAILED);

    const v2 = await clients.agentCommand.apply(makeAgent({ org, name: agentName, env: { LATER_KEY: {} } }));
    expect(v2.status?.versionHash, "the author's save is a new version").not.toBe(v1.status?.versionHash);
    await clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), { RUN_KEY: "fixed-value" }));

    mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
    await clients.agentExecutionCommand.recover({ id: executionId });
    const replanned = await runSourcesOf(clients, executionId);
    expect(replanned.map((source) => source.key), "recover plans the recorded version's keys, not the head's").toEqual([
      "RUN_KEY",
    ]);
    expect(agentSourceOf(replanned, "RUN_KEY")?.origin, "from the recorded person's My vault, as it is now").toBe(
      RunValueOrigin.MY_VAULT,
    );
    expect((await fetchedValuesOf(executionId)).agent.RUN_KEY, "the runner fetches the fixed value").toBe(
      "fixed-value",
    );
    const recovered = await clients.agentExecutionQuery.get({ value: executionId });
    expect(recovered.status?.credentials?.person, "recover keeps the recorded person").toBe(
      execution.status?.credentials?.person,
    );
  });
});

// Nothing a run uses from a vault rides its workflow's Temporal history: the
// history holds ids and the run's credential, and the runner fetches the
// values when the work starts. Read through the `temporal` CLI on a lane
// whose server and runner configure NO payload codec (the local managed
// targets set no STIGMER_PAYLOAD_ENCRYPTION_KEY), so every payload's `data`
// is the plain JSON a reader of the history sees; a target without engine
// coordinates (the cloud's) skips.
describe.skipIf(collectionTarget.engineCoordinates === undefined)("vault resolution — Temporal history", () => {
  /** Every payload `data` string in a proto-JSON history, decoded from base64. */
  function payloadData(node: unknown, found: string[] = []): string[] {
    if (Array.isArray(node)) {
      for (const item of node) payloadData(item, found);
    } else if (typeof node === "object" && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (key === "data" && typeof value === "string") {
          found.push(Buffer.from(value, "base64").toString("utf8"));
        } else {
          payloadData(value, found);
        }
      }
    }
    return found;
  }

  it("[rpc:RunCommandController.create] a run's history holds no byte of a secret it used", async () => {
    const { org } = await target.provisionTenancy();
    const secretValue = uniqueName("history-probe-secret");
    await saveToMyVault(org, { HISTORY_PROBE_KEY: secretValue });
    const { session } = await agentAndSession(org, {
      env: { HISTORY_PROBE_KEY: { isSecret: true } },
      includeMyVault: true,
    });
    mock.enqueue(anthropicToolUse("call_probe", "execute", { command: 'echo "PROBE=[$HISTORY_PROBE_KEY]"' }));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-history"), sessionId: session.metadata!.id, autoApproveAll: true }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, `execution ${executionId}: ${final.status?.error || "(none)"}`).toBe(
      RunPhase.RUN_COMPLETED,
    );
    // The runner held the value: the shell printed it into the next request.
    expect(
      mock.scriptedRequests().map((request) => JSON.stringify(request.body)).join("\n"),
      "the run used the secret",
    ).toContain(`PROBE=[${secretValue}]`);

    const history = await showWorkflow(
      target.engineCoordinates!().temporalHostPort,
      TEMPORAL_DEV_NAMESPACE,
      invokeWorkflowIdFor(executionId),
    );
    const decoded = payloadData(history);
    expect(decoded.length, "the history carries payloads to search").toBeGreaterThan(0);
    expect(
      decoded.filter((data) => data.includes(secretValue)),
      "no payload of the run's history holds the secret",
    ).toEqual([]);
    expect(JSON.stringify(history), "nor does any other field of it").not.toContain(secretValue);
  });
});

// The agent's shell holds only what the AGENT declares: a key an MCP server of
// the run declares is planned for that server alone, never for the agent, so
// it never reaches the shell, even when agent save copied it into the agent's
// env.
// Observed where the model sees it: the shell tool's output in the next model
// request.
describe("vault resolution — the agent's shell", () => {
  async function shellOfRun(serverOn: "session" | "agent"): Promise<string> {
    const { org } = await target.provisionTenancy();
    const mcp = requireMcpFixture(target);
    await saveToMyVault(org, { SHELL_AGENT_KEY: "agent-visible-value", SHELL_MCP_ONLY_KEY: "mcp-only-value" });

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
        includeMyVault: true,
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

    const sources = await runSourcesOf(clients, executionId);
    expect(agentSourceOf(sources, "SHELL_AGENT_KEY")?.origin, "the agent's key is planned for the agent").toBe(
      RunValueOrigin.MY_VAULT,
    );
    const mcpOnly = sourcesFor(sources, "SHELL_MCP_ONLY_KEY");
    expect(
      mcpOnly.map((source) => [source.declarer?.kind, source.declarer?.mcpServerId]),
      "the server's key is planned for the server alone",
    ).toEqual([[RunValueDeclarerKind.TOOL, server.metadata!.id]]);

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
    // The end-to-end proof of the fetch: a My vault secret (sealed at rest)
    // -> the run's manifest names its entry -> the runner fetches it opened
    // when the turn starts -> the shell holds the real value.
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
      makeAgentExecution({
        org,
        name: uniqueName("aex-secret-proof"),
        agentRef: agentRefOf(agent),
        includeMyVault: true,
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

    const sources = await runSourcesOf(clients, result.runId);
    expect(sourcesFor(sources, "OWNER_ONLY_KEY"), "the fire never reads its owner's My vault").toEqual([]);
    const scheduled = agentSourceOf(sources, "SCHED_KEY");
    expect(scheduled?.origin, "the schedule's vault fills the key").toBe(RunValueOrigin.SURFACE_VAULT);
    expect(scheduled?.vaultId).toBe(team.id);
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
    const owners = agentSourceOf(await runSourcesOf(clients, result.runId), "OWNERS_KEY");
    expect(owners?.origin, "the owner's attached My vault fills the key").toBe(RunValueOrigin.SURFACE_VAULT);
    expect(owners?.vaultId).toBe(mineId);
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
