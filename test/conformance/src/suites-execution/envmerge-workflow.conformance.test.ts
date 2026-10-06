// Conformance suite for environment-merge precedence — the WORKFLOW half
// (Class B). The agent half lives in
// envmerge-agent.conformance.test.ts: rosters are file-granular and the
// local-execution target rostered agent-execution suites before the
// workflow-execution engine existed, so the two aggregates' assertions ship
// as two files. Roster-neutral here: the execution config includes by glob.
//
// Domain: agentic — the keys a workflow run receives in its
// ExecutionContext at run start, and the keys each agent turn one of its
// agent_call steps starts receives.
//
// The contract, a run's keys, in order:
//   1. spec.runtime_env, what the caller passed with the run;
//   2. the least-privilege filter: the workflow's spec.env is a KEY
//      WHITELIST (+ required/optional schema), never a value source, so a
//      key the workflow does not declare is dropped wherever it came from;
//   3. every declared key still missing, from the personal environment of
//      the run's PERSON (whoever started the run, read from the run's row),
//      by declared key — for a workflow of the run's own organization only;
//   4. a declared-but-required key still missing is only a warning: the run
//      is not failed.
// The declarations are those of the version the run pinned at create, and
// recover rebuilds the same context from that version and the same person.
// The two-person form (a member's run reads the member's keys, never the
// workflow owner's) runs on the target's enforcing lane.
//
// A workflow's agent_call step names environments of its own
// (environment_refs). The turn the step starts reads them from the version
// the step's run pinned, never the workflow's head, so an author's save
// mid-run never changes what a running step receives (stigmer#1906), the
// step is found at any depth by its name, and its environments merge in the
// order the step lists them, the later winning a key both hold.
//
// Observation strategy (why this is deterministic without polling):
// The ExecutionContext is created SYNCHRONOUSLY inside the create pipeline,
// before Temporal starts — so it exists the instant create() returns, and a
// single getByExecutionId reads it (a NotFound-retry would only mask a
// regression that made creation async). The context is ephemeral (the run
// deletes it on completion), so we keep the run non-terminal while we read:
// a `wait` workflow (durable timer) for the run, a held mock-LLM turn for a
// step's agent turn, and a human_input gate re-armed by recover for the
// recovered run. Neither the read nor the assertions depend on the run
// reaching any particular phase.
//
// Secret values follow the ExecutionContext read contract, edition-CONVERGED
// since stigmer#535 (as Environment's has been since stigmer#405): the merged
// value is observed through EC getByExecutionId under this harness's
// user-shaped credentials, so a secret comes back REDACTED on every target;
// the is_secret flag is edition-agnostic. Non-secret merged values stay
// observable in plaintext, which is what the precedence assertions ride on.
// The proof that the RUNNER still receives decrypted secrets (via the
// execution-scoped token lane, stigmer#535) is the set_vars proof test below:
// a workflow task emits a declared secret env var into its observable output,
// which only works if the runner-side EC read decrypted it.
//
// The context's end is pinned here too: once a run settles, the run-end
// activity has deleted its context through the context's own delete chain
// (stigmer#1647), so getByExecutionId answers NotFound.
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase, WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { Code, ConnectError } from "@connectrpc/connect";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { requireLlmProxy } from "../support/agentexecutions";
import { makeAgent } from "../support/agents";
import {
  type EnvVarDeclarationInit,
  type EnvironmentRefInit,
  type EnvironmentValueInit,
  makeEnvironment,
  makePersonalEnvironment,
} from "../support/environments";
import { pollUntil } from "../support/execution-poll";
import { type ExecutionValueInit } from "../support/executioncontexts";
import { uniqueName } from "../support/naming";
import { createChildOrganization } from "../support/organizations";
import {
  AGENT_CALL_GATE_SIGNAL,
  AGENT_CALL_GATE_TASK_NAME,
  AGENT_CALL_STEP_NAME,
  makeAgentCallStepWorkflow,
  makeEnvMergeWorkflow,
  makeHumanInputWorkflow,
  makeWorkflow,
} from "../support/workflows";
import { awaitPhase, awaitTaskStatus, awaitTerminal, makeWorkflowExecution, taskByName } from "../support/workflowexecutions";
import { createTarget, enforcingLaneOf, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

// Holds a step's agent turn open so the turn stays non-terminal (and its
// ephemeral ExecutionContext survives) while we read; a held turn aborts the
// instant the run is cancelled, so the wall-clock cost is tiny.
const HOLD_MS = 30_000;

// The lineage labels the runner's agent_call activity stamps on the turn a
// step starts; pinned bytes, the server finds the step's environments by them.
const WORKFLOW_EXECUTION_ID_LABEL = "stigmer.ai/workflow-execution-id";
const WORKFLOW_TASK_LABEL = "stigmer.ai/workflow-task";

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  // Release any still-held step turn before teardown so its runner activity
  // winds down (mirrors the agent suites).
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

interface MergeSetup {
  // The run's person's personal environment (stigmer.ai/personal): the
  // fill-in for a declared key the run did not pass. Omitted, the person
  // holds none.
  personal?: Record<string, EnvironmentValueInit>;
  // Blueprint env declarations (the whitelist the merged env is filtered to).
  env: Record<string, EnvVarDeclarationInit>;
  // Execution-scoped values (the first layer).
  runtimeEnv?: Record<string, ExecutionValueInit>;
}

// The caller's personal environment in `org`, deleted at cleanup.
async function seedPersonal(
  using: ConformanceClients,
  org: string,
  data: Record<string, EnvironmentValueInit>,
): Promise<void> {
  const personal = await using.environmentCommand.create(
    makePersonalEnvironment({ org, name: uniqueName("personal"), data }),
  );
  fixtures.defer(() => using.environmentCommand.delete({ resourceId: personal.metadata!.id }));
}

// A run of `workflowId` in `org` by `using`; teardown cancels best-effort,
// then deletes.
async function startRun(
  using: ConformanceClients,
  org: string,
  workflowId: string,
  runtimeEnv?: Record<string, ExecutionValueInit>,
) {
  const execution = await using.workflowExecutionCommand.create(
    makeWorkflowExecution({ org, name: uniqueName("wfx"), workflowId, runtimeEnv }),
  );
  fixtures.defer(async () => {
    await using.workflowExecutionCommand.cancel({ id: execution.metadata!.id }).catch(() => {});
    await using.workflowExecutionCommand.delete({ value: execution.metadata!.id });
  });
  return execution;
}

async function contextData(using: ConformanceClients, executionId: string) {
  const context = await using.executionContextQuery.getByExecutionId({ executionId });
  return context.spec?.data ?? {};
}

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

/**
 * Waits until the run's ExecutionContext is gone: the orchestrator deletes it
 * in an activity after the terminal phase lands, so a step that acts on the
 * terminal run waits for the delete first.
 */
async function awaitContextGone(executionId: string, after: string): Promise<void> {
  await pollUntil(
    () => contextState(executionId),
    (state) => state === "gone",
    (_, timeoutMs) =>
      `workflow execution ${executionId}'s ExecutionContext was still readable ${timeoutMs}ms after the run reached ${after}`,
    { timeoutMs: 30_000 },
  );
}

// Drives the WORKFLOW env-merge path end to end: the run's person's personal
// Environment -> Workflow (env whitelist) -> WorkflowExecution
// (runtime_env), then reads the merged ExecutionContext. The `wait` workflow
// keeps the run non-terminal so the ephemeral context survives the read.
async function runWorkflowMerge(org: string, setup: MergeSetup) {
  if (setup.personal !== undefined) {
    await seedPersonal(clients, org, setup.personal);
  }
  const workflow = await clients.workflowCommand.create(
    makeEnvMergeWorkflow({ org, name: uniqueName("wf-envmerge"), env: setup.env }),
  );
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

  const execution = await startRun(clients, org, workflow.metadata!.id, setup.runtimeEnv);
  return { execution, data: await contextData(clients, execution.metadata!.id) };
}

describe("envmerge conformance — Workflow precedence", () => {
  it("a key the workflow declares and the run does not pass is filled from the run's person's personal environment", async () => {
    const { org } = await target.provisionTenancy();
    const { data } = await runWorkflowMerge(org, {
      personal: { BRIDGE_KEY: { value: "personal-value" } },
      env: { BRIDGE_KEY: {} },
    });

    expect(data.BRIDGE_KEY?.value, "the personal environment fills the workflow's declared key").toBe(
      "personal-value",
    );
  });

  it("runtime_env wins over the personal environment; personal-only and runtime-only declared keys are both present", async () => {
    const { org } = await target.provisionTenancy();
    const { data } = await runWorkflowMerge(org, {
      personal: { PRECEDENCE_KEY: { value: "from-personal" }, PERSONAL_ONLY_KEY: { value: "personal-value" } },
      env: { PRECEDENCE_KEY: {}, PERSONAL_ONLY_KEY: {}, RUNTIME_ONLY_KEY: {} },
      runtimeEnv: { PRECEDENCE_KEY: { value: "from-runtime" }, RUNTIME_ONLY_KEY: { value: "runtime-value" } },
    });

    expect(data.PRECEDENCE_KEY?.value, "the personal fill-in never overrides a value the run passed").toBe(
      "from-runtime",
    );
    expect(data.PERSONAL_ONLY_KEY?.value, "a personal value flows through when the run passed none").toBe(
      "personal-value",
    );
    expect(data.RUNTIME_ONLY_KEY?.value, "a runtime-only declared key is present").toBe("runtime-value");
  });

  it("keys not declared in the blueprint whitelist are excluded — from BOTH the personal environment and runtime_env", async () => {
    const { org } = await target.provisionTenancy();
    const { data } = await runWorkflowMerge(org, {
      personal: { DECLARED_KEY: { value: "kept" }, UNDECLARED_PERSONAL_KEY: { value: "dropped" } },
      env: { DECLARED_KEY: {} },
      runtimeEnv: { UNDECLARED_RUNTIME_KEY: { value: "dropped" } },
    });

    expect(data.DECLARED_KEY?.value, "a declared key survives the whitelist filter").toBe("kept");
    expect(data.UNDECLARED_PERSONAL_KEY, "a personal key the workflow does not declare never reaches the run").toBeUndefined();
    // The strongest assertion: runtime_env cannot smuggle in a key the blueprint
    // did not declare — least-privilege holds even for execution-time values.
    expect(data.UNDECLARED_RUNTIME_KEY, "an undeclared runtime_env key is filtered out").toBeUndefined();
  });

  it("a required declared key that is unprovisioned is absent and the run is NOT failed (warn-only)", async () => {
    const { org } = await target.provisionTenancy();
    const { execution, data } = await runWorkflowMerge(org, {
      personal: { PROVIDED_KEY: { value: "present" } },
      env: { PROVIDED_KEY: {}, REQUIRED_MISSING_KEY: {}, OPTIONAL_MISSING_KEY: { optional: true } },
    });

    expect(data.PROVIDED_KEY?.value).toBe("present");
    expect(data.REQUIRED_MISSING_KEY, "an unprovisioned required key is absent, not defaulted").toBeUndefined();
    expect(data.OPTIONAL_MISSING_KEY, "an unprovisioned optional key is absent").toBeUndefined();
    // create() ran the merge in-pipeline; a missing required key is warn-only, so
    // creation succeeded rather than failing the execution.
    expect(execution.status?.phase, "a missing required key does not fail the run").not.toBe(
      RunPhase.RUN_FAILED,
    );
  });

  it("[rpc:ExecutionContextQueryController.getByExecutionId] a secret value survives the merge with is_secret preserved and its value redacted on the user-shaped read", async () => {
    const { org } = await target.provisionTenancy();
    const secretValue = "personal-secret-value";
    const { data } = await runWorkflowMerge(org, {
      personal: { API_TOKEN: { value: secretValue, isSecret: true }, PLAIN_KEY: { value: "plain-value" } },
      env: { API_TOKEN: { isSecret: true }, PLAIN_KEY: {} },
    });

    const secretEntry = data.API_TOKEN;
    expect(secretEntry?.isSecret, "is_secret is preserved through the merge in both editions").toBe(true);
    expect(data.PLAIN_KEY?.value, "plaintext values are never redacted").toBe("plain-value");
    // The harness is a user-shaped caller, so the merged secret is redacted
    // (stigmer#535, on both editions). That the RUNNER receives the
    // decrypted value is proven separately by the set_vars proof test
    // below.
    expect(secretEntry?.value, "no user-shaped read returns the plaintext secret").not.toBe(secretValue);
  });

  it("a merged secret reaches the RUNNER decrypted — a set_vars task emits it into the workflow output (stigmer#535)", async () => {
    // The end-to-end proof of the runner decrypt lane. The chain under test:
    // a personal Environment secret (encrypted at rest, stigmer#405) -> the
    // fill decrypts it into the EC -> EC encrypts at rest (stigmer#535) ->
    // the runner exchanges for an execution-scoped token and reads the EC
    // decrypted -> `$env` in the workflow expression scope carries the real
    // value -> the set_vars output is observable plaintext. If ANY link
    // served the redaction marker or ciphertext instead, the output would
    // carry that junk and the equality below would fail.
    const { org } = await target.provisionTenancy();
    const secretValue = "proof-secret-value";
    await seedPersonal(clients, org, { PROOF_TOKEN: { value: secretValue, isSecret: true } });

    const workflow = await clients.workflowCommand.create(
      makeWorkflow({
        org,
        name: uniqueName("wf-secretproof"),
        variables: { proof: "${ $env.PROOF_TOKEN }" },
        env: { PROOF_TOKEN: { isSecret: true } },
      }),
    );
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

    const execution = await startRun(clients, org, workflow.metadata!.id);
    const final = await awaitTerminal(clients, execution.metadata!.id);

    expect(final.status?.phase, "the secret-consuming run completes").toBe(RunPhase.RUN_COMPLETED);
    // The set_vars task's recorded output carries the evaluated variables
    // (workflow-level status.output needs an explicit output.as block, which
    // this single-task fixture deliberately omits).
    const taskOutput = taskByName(final, "setVars")?.output as Record<string, unknown> | undefined;
    expect(taskOutput?.proof, "the runner received the decrypted secret, not the marker or ciphertext").toBe(
      secretValue,
    );
  });

  it("[rpc:ExecutionContextQueryController.getByExecutionId] a workflow run's ExecutionContext is deleted once the run ends", async () => {
    // The run's set_vars task reads `$env`, so its output proves the runner
    // read the context; after the run settles, the context must be gone.
    const { org } = await target.provisionTenancy();
    await seedPersonal(clients, org, { END_KEY: { value: "end-value" } });

    const workflow = await clients.workflowCommand.create(
      makeWorkflow({
        org,
        name: uniqueName("wf-ctxend"),
        variables: { seen: "${ $env.END_KEY }" },
        env: { END_KEY: {} },
      }),
    );
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

    const execution = await startRun(clients, org, workflow.metadata!.id);
    const executionId = execution.metadata!.id;

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const taskOutput = taskByName(final, "setVars")?.output as Record<string, unknown> | undefined;
    expect(taskOutput?.seen, "the runner read the run's context").toBe("end-value");

    await awaitContextGone(executionId, RunPhase[final.status!.phase]);
  });

  it("a workflow of another organization than the run gets none of the person's keys; what the run passes still reaches it", async () => {
    // A person's values reach a workflow their own organization holds, never
    // one another organization published: here the parent's workflow,
    // shared with its child organizations, run in the child.
    const { org: parentOrg } = await target.provisionTenancy();
    const { id: childOrg } = await createChildOrganization(clients.organizationCommand, parentOrg, "the run's organization");
    fixtures.defer(() => clients.organizationCommand.delete({ value: childOrg }));
    await seedPersonal(clients, childOrg, { SHARED_KEY: { value: "child-personal" } });

    const input = makeEnvMergeWorkflow({
      org: parentOrg,
      name: uniqueName("wf-parent"),
      env: { SHARED_KEY: {}, PASSED_KEY: {} },
    });
    input.metadata = { ...input.metadata, visibility: ApiResourceVisibility.visibility_child_orgs };
    const workflow = await clients.workflowCommand.create(input);
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

    const execution = await startRun(clients, childOrg, workflow.metadata!.id, {
      PASSED_KEY: { value: "passed-value" },
    });
    const data = await contextData(clients, execution.metadata!.id);

    expect(data.PASSED_KEY?.value, "a value the run passed reaches the run").toBe("passed-value");
    expect(data.SHARED_KEY, "another organization's workflow reads none of the person's keys").toBeUndefined();
  });

  it("the declared keys are those of the version the run pinned: a save after the run's create changes only later runs", async () => {
    const { org } = await target.provisionTenancy();
    await seedPersonal(clients, org, { FIRST_KEY: { value: "first-value" }, SECOND_KEY: { value: "second-value" } });
    const name = uniqueName("wf-pinned-keys");

    const v1 = await clients.workflowCommand.apply(makeEnvMergeWorkflow({ org, name, env: { FIRST_KEY: {} } }));
    fixtures.defer(() => clients.workflowCommand.delete({ value: v1.metadata!.id }));
    const first = await startRun(clients, org, v1.metadata!.id);
    expect(first.status?.workflowVersionHash, "the first run pins the first version").toBe(v1.status?.versionHash);

    const v2 = await clients.workflowCommand.apply(makeEnvMergeWorkflow({ org, name, env: { SECOND_KEY: {} } }));
    expect(v2.status?.versionHash, "a declarations edit is a new version").not.toBe(v1.status?.versionHash);
    const second = await startRun(clients, org, v1.metadata!.id);
    expect(second.status?.workflowVersionHash).toBe(v2.status?.versionHash);

    const firstData = await contextData(clients, first.metadata!.id);
    expect(Object.keys(firstData).sort(), "the first run holds the first version's keys").toEqual(["FIRST_KEY"]);
    const secondData = await contextData(clients, second.metadata!.id);
    expect(Object.keys(secondData).sort(), "the second run holds the second version's keys").toEqual(["SECOND_KEY"]);
  });

  it("[rpc:WorkflowExecutionCommandController.recover] recover rebuilds the context create built: the pinned version's keys, from the same person", async () => {
    // A human_input gate that times out FAILS the run; recover resumes at
    // the gate, which waits again, so the rebuilt context is alive to read.
    // Between the failure and the recover the workflow is saved declaring
    // another key: the recovered run still reads the version it pinned.
    const { org } = await target.provisionTenancy();
    await seedPersonal(clients, org, { RUN_KEY: { value: "run-value" }, LATER_KEY: { value: "later-value" } });
    const name = uniqueName("wf-recover-keys");
    const gated = (env: Record<string, EnvVarDeclarationInit>) =>
      makeHumanInputWorkflow({ org, name, timeout: 5, onTimeout: "HUMAN_INPUT_TIMEOUT_FAIL", env });

    const v1 = await clients.workflowCommand.apply(gated({ RUN_KEY: {} }));
    fixtures.defer(() => clients.workflowCommand.delete({ value: v1.metadata!.id }));
    const execution = await startRun(clients, org, v1.metadata!.id);
    const executionId = execution.metadata!.id;
    const built = await contextData(clients, executionId);
    expect(built.RUN_KEY?.value, "create filled the run's key").toBe("run-value");

    await awaitPhase(clients, executionId, RunPhase.RUN_FAILED);
    // The failed run's own context delete runs after the phase lands; recover
    // only once it has, so it can never remove the rebuilt context.
    await awaitContextGone(executionId, "EXECUTION_FAILED");
    const v2 = await clients.workflowCommand.apply(gated({ LATER_KEY: {} }));
    expect(v2.status?.versionHash).not.toBe(v1.status?.versionHash);

    await clients.workflowExecutionCommand.recover({ id: executionId, reason: "conformance recovery" });
    const rebuilt = await contextData(clients, executionId);
    expect(Object.keys(rebuilt).sort(), "recover rebuilds the pinned version's keys, not the head's").toEqual([
      "RUN_KEY",
    ]);
    expect(rebuilt.RUN_KEY?.value, "from the run's own person").toBe("run-value");
  });
});

describe("envmerge conformance — whose personal keys a workflow run reads (on the enforcing lane)", () => {
  it("a member's run of the founder's workflow reads the member's personal keys, never the founder's", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const tenancy = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(tenancy));
    const member = await lane.provisionMember(tenancy);
    const org = tenancy.org;
    await seedPersonal(lane.clients, org, { PERSON_KEY: { value: "founder-value" } });
    await seedPersonal(member, org, { PERSON_KEY: { value: "member-value" } });

    // Org-visible (the blueprint default): the member may run it.
    const workflow = await lane.clients.workflowCommand.create(
      makeEnvMergeWorkflow({ org, name: uniqueName("wf-whose-keys"), env: { PERSON_KEY: {} } }),
    );
    fixtures.defer(() => lane.clients.workflowCommand.delete({ value: workflow.metadata!.id }));

    const memberRun = await startRun(member, org, workflow.metadata!.id);
    const memberData = await contextData(member, memberRun.metadata!.id);
    expect(memberData.PERSON_KEY?.value, "the run's person is the member who started it").toBe("member-value");

    const founderRun = await startRun(lane.clients, org, workflow.metadata!.id);
    const founderData = await contextData(lane.clients, founderRun.metadata!.id);
    expect(founderData.PERSON_KEY?.value, "the founder's own run reads the founder's keys").toBe("founder-value");
  });
});

// The turn an agent_call step started for `workflowExecutionId`, found by the
// lineage label the runner stamps on it (poll: the runner creates it once
// the step starts).
async function stepTurnOf(org: string, workflowExecutionId: string): Promise<AgentRun> {
  const turn = await pollUntil(
    async () =>
      (await clients.agentExecutionQuery.list({ org })).entries.find(
        (entry) => entry.metadata?.labels[WORKFLOW_EXECUTION_ID_LABEL] === workflowExecutionId,
      ),
    (found) => found !== undefined,
    (_, timeoutMs) => `no agent turn labeled ${WORKFLOW_EXECUTION_ID_LABEL}=${workflowExecutionId} within ${timeoutMs}ms`,
    { timeoutMs: 30_000 },
  );
  if (turn === undefined) {
    throw new Error(`workflow execution ${workflowExecutionId} started no agent turn`);
  }
  fixtures.defer(async () => {
    await clients.agentExecutionCommand.cancel({ id: turn.metadata!.id }).catch(() => {});
    await clients.agentExecutionCommand.delete({ value: turn.metadata!.id });
  });
  return turn;
}

describe("envmerge conformance — the environments a workflow step names", () => {
  // An agent declaring STEP_KEY, and one environment per value, in `org`.
  async function seedStep(org: string, values: readonly string[]) {
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("step-agent"), env: { STEP_KEY: { isSecret: false } } }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const refs: EnvironmentRefInit[] = [];
    for (const value of values) {
      const environment = await clients.environmentCommand.create(
        makeEnvironment({ org, name: uniqueName("step-keys"), data: { STEP_KEY: { value } } }),
      );
      fixtures.defer(() => clients.environmentCommand.delete({ resourceId: environment.metadata!.id }));
      refs.push({ org, slug: environment.metadata!.slug });
    }
    return { agentSlug: agent.metadata!.slug, refs };
  }

  it("a step reads its environments from the version its run pinned: an author's save mid-run never reaches the running step (stigmer#1906)", async () => {
    const { org } = await target.provisionTenancy();
    const { agentSlug, refs } = await seedStep(org, ["from-pinned", "from-edit"]);
    const [pinnedRef, editedRef] = refs;
    const name = uniqueName("wf-step-pin");

    const v1 = await clients.workflowCommand.apply(
      makeAgentCallStepWorkflow({ org, name, agentSlug, environmentRefs: [pinnedRef!], gated: true }),
    );
    fixtures.defer(() => clients.workflowCommand.delete({ value: v1.metadata!.id }));
    mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
    const run = await startRun(clients, org, v1.metadata!.id);
    const runId = run.metadata!.id;
    expect(run.status?.workflowVersionHash).toBe(v1.status?.versionHash);
    await awaitTaskStatus(clients, runId, AGENT_CALL_GATE_TASK_NAME, WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS);

    // The author repoints the step at another environment while the run
    // waits at its gate; the workflow suite pins that this is a new version.
    await clients.workflowCommand.apply(
      makeAgentCallStepWorkflow({ org, name, agentSlug, environmentRefs: [editedRef!], gated: true }),
    );
    await clients.workflowExecutionCommand.sendSignal({ runId: runId, signalName: AGENT_CALL_GATE_SIGNAL });

    const turn = await stepTurnOf(org, runId);
    expect(turn.metadata?.labels[WORKFLOW_TASK_LABEL], "the turn names the step that started it").toBe(
      AGENT_CALL_STEP_NAME,
    );
    const data = await contextData(clients, turn.metadata!.id);
    expect(data.STEP_KEY?.value, "the running step receives the pinned version's environments, not the head's").toBe(
      "from-pinned",
    );
  });

  it("a step's environment_refs merge in declaration order: the later environment wins a key both hold", async () => {
    const { org } = await target.provisionTenancy();
    const { agentSlug, refs } = await seedStep(org, ["from-first", "from-second"]);

    const workflow = await clients.workflowCommand.create(
      makeAgentCallStepWorkflow({
        org,
        name: uniqueName("wf-step-order"),
        agentSlug,
        environmentRefs: refs,
      }),
    );
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
    mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
    const run = await startRun(clients, org, workflow.metadata!.id);

    const turn = await stepTurnOf(org, run.metadata!.id);
    const data = await contextData(clients, turn.metadata!.id);
    expect(data.STEP_KEY?.value, "the later environment in the step's list wins").toBe("from-second");
  });

  it("a nested agent_call step's environments reach the turn it starts", async () => {
    const { org } = await target.provisionTenancy();
    const { agentSlug, refs } = await seedStep(org, ["from-nested-step"]);

    const workflow = await clients.workflowCommand.create(
      makeAgentCallStepWorkflow({
        org,
        name: uniqueName("wf-step-nested"),
        agentSlug,
        environmentRefs: refs,
        placement: "for_each",
      }),
    );
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
    mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
    const run = await startRun(clients, org, workflow.metadata!.id);

    const turn = await stepTurnOf(org, run.metadata!.id);
    expect(turn.metadata?.labels[WORKFLOW_TASK_LABEL]).toBe(AGENT_CALL_STEP_NAME);
    const data = await contextData(clients, turn.metadata!.id);
    expect(data.STEP_KEY?.value, "the step is found below the top level by its name").toBe("from-nested-step");
  });
});
