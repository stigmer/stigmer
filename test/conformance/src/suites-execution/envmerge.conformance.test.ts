// Conformance suite for environment-merge precedence (Class B).
// Domain: agentic — the env layering that populates an ExecutionContext at run
// start, exercised through both aggregates that have an instance layer:
// WorkflowExecution (via WorkflowInstance) and AgentExecution (via AgentInstance).
//
// What the engine actually does (backend/libs/go/envmerge + the two
// create_execution_context_step.go controllers) — asserted here as the contract:
//
//   value layers, lowest -> highest precedence:
//     1. instance environment_refs  (resolved Environment values; later ref wins)
//     2. execution runtime_env       (wins)
//   then FilterByDeclaredKeys(merged, blueprint.spec.env): the blueprint env map
//   is a KEY WHITELIST (+ required/optional schema), never a value source. A
//   merged key not declared by the blueprint is dropped; a declared-but-required
//   key that is unprovisioned is only a warning (the run is not failed).
//
// The proto comments that describe "blueprint defaults < environment < runtime"
// are aspirational — the blueprint carries declarations (keys), not values — so
// we assert the implemented two-value-layer + whitelist model.
//
// Observation strategy (why this is deterministic without polling):
// The ExecutionContext is created SYNCHRONOUSLY inside the create pipeline
// (workflowexecution/agentexecution create.go), before Temporal starts — so it
// exists the instant create() returns, and a single getByExecutionId reads it
// (a NotFound-retry would only mask a regression that made creation async). The
// context is ephemeral (the Temporal workflow deletes it on completion), so we
// keep the run non-terminal while we read: a `wait` workflow (durable timer) for
// the workflow path, a held mock-LLM turn for the agent path. Neither the read
// nor the assertions depend on the run reaching any particular phase.
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
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { makeAgentInstance } from "../support/agentinstances";
import { type EnvVarDeclarationInit, type EnvironmentValueInit, makeEnvironment } from "../support/environments";
import { type ExecutionValueInit } from "../support/executioncontexts";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { makeEnvMergeWorkflow, makeWorkflow } from "../support/workflows";
import { awaitTerminal, makeWorkflowExecution, taskByName } from "../support/workflowexecutions";
import { makeWorkflowInstance } from "../support/workflowinstances";
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
  // Required by the agent block; harmless for the hermetic workflow block. Fails
  // loudly on a non-execution target, which cannot run this suite anyway.
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

// Drives the WORKFLOW env-merge path end to end: Environment(s) -> Workflow (env
// whitelist) -> WorkflowInstance (environment_refs) -> WorkflowExecution
// (runtime_env), then reads the merged ExecutionContext via getByExecutionId. The
// `wait` workflow keeps the run non-terminal so the ephemeral context survives
// the read; teardown cancels best-effort, then deletes.
async function runWorkflowMerge(org: string, setup: MergeSetup) {
  const refs = await seedEnvironments(org, setup.environments);

  const workflow = await clients.workflowCommand.create(
    makeEnvMergeWorkflow({ org, name: uniqueName("wf-envmerge"), env: setup.env }),
  );
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

  const instance = await clients.workflowInstanceCommand.create(
    makeWorkflowInstance({ org, name: uniqueName("wfi"), workflowId: workflow.metadata!.id, environmentRefs: refs }),
  );
  fixtures.defer(() => clients.workflowInstanceCommand.delete({ value: instance.metadata!.id }));

  const execution = await clients.workflowExecutionCommand.create(
    makeWorkflowExecution({
      org,
      name: uniqueName("wfx"),
      workflowInstanceId: instance.metadata!.id,
      runtimeEnv: setup.runtimeEnv,
    }),
  );
  fixtures.defer(async () => {
    await clients.workflowExecutionCommand.cancel({ id: execution.metadata!.id }).catch(() => {});
    await clients.workflowExecutionCommand.delete({ value: execution.metadata!.id });
  });

  const context = await clients.executionContextQuery.getByExecutionId({ executionId: execution.metadata!.id });
  return { execution, data: context.spec?.data ?? {} };
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

describe("envmerge conformance — Workflow precedence", () => {
  it("runtime_env overrides the instance environment layer; env-only and runtime-only declared keys are both present", async () => {
    const { org } = await target.provisionTenancy();
    const { data } = await runWorkflowMerge(org, {
      environments: [{ data: { PRECEDENCE_KEY: { value: "from-environment" }, ENV_ONLY_KEY: { value: "env-value" } } }],
      env: { PRECEDENCE_KEY: {}, ENV_ONLY_KEY: {}, RUNTIME_ONLY_KEY: {} },
      runtimeEnv: { PRECEDENCE_KEY: { value: "from-runtime" }, RUNTIME_ONLY_KEY: { value: "runtime-value" } },
    });

    expect(data.PRECEDENCE_KEY?.value, "runtime_env wins over the instance environment layer").toBe("from-runtime");
    expect(data.ENV_ONLY_KEY?.value, "instance environment value flows through when not overridden").toBe("env-value");
    expect(data.RUNTIME_ONLY_KEY?.value, "a runtime-only declared key is present").toBe("runtime-value");
  });

  it("keys not declared in the blueprint whitelist are excluded — from BOTH the environment and runtime_env layers", async () => {
    const { org } = await target.provisionTenancy();
    const { data } = await runWorkflowMerge(org, {
      environments: [{ data: { DECLARED_KEY: { value: "kept" }, UNDECLARED_ENV_KEY: { value: "dropped" } } }],
      env: { DECLARED_KEY: {} },
      runtimeEnv: { UNDECLARED_RUNTIME_KEY: { value: "dropped" } },
    });

    expect(data.DECLARED_KEY?.value, "a declared key survives the whitelist filter").toBe("kept");
    expect(data.UNDECLARED_ENV_KEY, "an undeclared environment key is filtered out").toBeUndefined();
    // The strongest assertion: runtime_env cannot smuggle in a key the blueprint
    // did not declare — least-privilege holds even for execution-time overrides.
    expect(data.UNDECLARED_RUNTIME_KEY, "an undeclared runtime_env key is filtered out").toBeUndefined();
  });

  it("a required declared key that is unprovisioned is absent and the run is NOT failed (warn-only)", async () => {
    const { org } = await target.provisionTenancy();
    const { execution, data } = await runWorkflowMerge(org, {
      environments: [{ data: { PROVIDED_KEY: { value: "present" } } }],
      env: { PROVIDED_KEY: {}, REQUIRED_MISSING_KEY: {}, OPTIONAL_MISSING_KEY: { optional: true } },
    });

    expect(data.PROVIDED_KEY?.value).toBe("present");
    expect(data.REQUIRED_MISSING_KEY, "an unprovisioned required key is absent, not defaulted").toBeUndefined();
    expect(data.OPTIONAL_MISSING_KEY, "an unprovisioned optional key is absent").toBeUndefined();
    // create() ran the merge in-pipeline; a missing required key is warn-only, so
    // creation succeeded rather than failing the execution.
    expect(execution.status?.phase, "a missing required key does not fail the run").not.toBe(
      ExecutionPhase.EXECUTION_FAILED,
    );
  });

  it("a secret value survives the merge with is_secret preserved and its value redacted on the user-shaped read", async () => {
    const { org } = await target.provisionTenancy();
    const secretValue = "env-secret-value";
    const { data } = await runWorkflowMerge(org, {
      environments: [
        { data: { API_TOKEN: { value: secretValue, isSecret: true }, PLAIN_KEY: { value: "plain-value" } } },
      ],
      env: { API_TOKEN: { isSecret: true }, PLAIN_KEY: {} },
    });

    const secretEntry = data.API_TOKEN;
    expect(secretEntry?.isSecret, "is_secret is preserved through the merge in both editions").toBe(true);
    expect(data.PLAIN_KEY?.value, "plaintext values are never redacted").toBe("plain-value");
    // The harness is a user-shaped caller, so the merged secret is redacted
    // (stigmer#535 — the stigmer-cloud#152 contract on both editions). That
    // the RUNNER receives the decrypted value is proven separately by the
    // set_vars proof test below.
    expect(secretEntry?.value, "no user-shaped read returns the plaintext secret").not.toBe(secretValue);
  });

  it("a merged secret reaches the RUNNER decrypted — a set_vars task emits it into the workflow output (stigmer#535)", async () => {
    // The end-to-end proof of the runner decrypt lane, replacing the proof
    // the redaction flip removed (pre-#535, the harness observed the
    // plaintext directly on the EC read). The chain under test:
    // Environment secret (encrypted at rest, stigmer#405) -> merge decrypts
    // it into the EC (RuntimeResolutionService) -> EC encrypts at rest
    // (stigmer#535) -> the runner exchanges for an execution-scoped token
    // and reads the EC decrypted -> `$env` in the workflow expression scope
    // carries the real value -> the set_vars output is observable plaintext.
    // If ANY link served the redaction marker or ciphertext instead, the
    // output would carry that junk and the equality below would fail.
    const { org } = await target.provisionTenancy();
    const secretValue = "proof-secret-value";

    const refs = await seedEnvironments(org, [
      { data: { PROOF_TOKEN: { value: secretValue, isSecret: true } } },
    ]);

    const workflow = await clients.workflowCommand.create(
      makeWorkflow({
        org,
        name: uniqueName("wf-secretproof"),
        variables: { proof: "${ $env.PROOF_TOKEN }" },
        env: { PROOF_TOKEN: { isSecret: true } },
      }),
    );
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

    const instance = await clients.workflowInstanceCommand.create(
      makeWorkflowInstance({ org, name: uniqueName("wfi"), workflowId: workflow.metadata!.id, environmentRefs: refs }),
    );
    fixtures.defer(() => clients.workflowInstanceCommand.delete({ value: instance.metadata!.id }));

    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx"), workflowInstanceId: instance.metadata!.id }),
    );
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: execution.metadata!.id }));

    const final = await awaitTerminal(clients, execution.metadata!.id);

    expect(final.status?.phase, "the secret-consuming run completes").toBe(ExecutionPhase.EXECUTION_COMPLETED);
    // The set_vars task's recorded output carries the evaluated variables
    // (workflow-level status.output needs an explicit output.as block, which
    // this single-task fixture deliberately omits).
    const taskOutput = taskByName(final, "setVars")?.output as Record<string, unknown> | undefined;
    expect(taskOutput?.proof, "the runner received the decrypted secret, not the marker or ciphertext").toBe(
      secretValue,
    );
  });

  it("environment_refs merge in declaration order — the later environment wins on a conflicting key", async () => {
    const { org } = await target.provisionTenancy();
    const { data } = await runWorkflowMerge(org, {
      environments: [
        { name: "env-lower", data: { CONFLICT_KEY: { value: "from-first" }, FIRST_ONLY: { value: "first" } } },
        { name: "env-upper", data: { CONFLICT_KEY: { value: "from-second" }, SECOND_ONLY: { value: "second" } } },
      ],
      env: { CONFLICT_KEY: {}, FIRST_ONLY: {}, SECOND_ONLY: {} },
    });

    expect(data.CONFLICT_KEY?.value, "the later environment_ref overrides the earlier one").toBe("from-second");
    expect(data.FIRST_ONLY?.value, "a key only in the first environment is retained").toBe("first");
    expect(data.SECOND_ONLY?.value, "a key only in the second environment is retained").toBe("second");
  });
});

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
