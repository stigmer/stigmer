// Schedule firing conformance — the cross-edition FIRING contract.
// Domain: conformance suites (execution engine).
//
// The trigger is a SYNCHRONOUS direct run: the RPC runs the full execution
// create pipeline and answers with the run's REAL outcome — the created
// execution's id, or the refusing gate's copy verbatim. That reshapes what
// this suite can and cannot assert black-box:
//
//   - NEWLY assertable: the outcome contract itself (a dangling target
//     names itself in the result, synchronously); the rule that manual
//     fires NEVER feed the failure streak; and the
//     run-history surface (listRuns) — every fire leaves a row with the
//     reason verbatim, including fires that created no execution.
//
//   - NO LONGER reachable black-box: the failure-streak auto-pause
//     crossing. It accumulates only from CRON fires now, and a real
//     cron arc is infeasible here (the cloud conformance environment
//     keeps the production 5-minute interval floor). The pause
//     machinery keeps its coverage at the tick level in BOTH editions —
//     cloud: the wire suites' ScheduleInspector.TriggerArtifact path;
//     OSS: the tick-activities tests and TestSchedule_RunTracking — and
//     the pause copy stays byte-pinned in both editions' unit tests.
//
// Every no-LLM fire here targets a DELETED agent, so it fails
// deterministically inside the create pipeline before any execution
// exists. Gated on the scheduleFiring capability.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  ScheduleRunOrigin,
  ScheduleRunOutcome,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { makeSchedule, targetMissingReason } from "../support/schedules";
import { pollUntil } from "../support/execution-poll";
import { createTarget, type TargetProfile } from "../targets";

// Read once at collection time to gate the describes (constructing a target is
// side-effect-free; setup() is what boots processes).
const collectionTarget = createTarget();
const firingEnabled = collectionTarget.capabilities.scheduleFiring;
// The real-run block additionally needs the mock LLM proxy (only execution
// targets provision one; the cloud target reports it as skipped — its
// completed-run path is covered by the cloud repo's own wire suites).
const realRunProvable = firingEnabled && collectionTarget.llmProxy !== undefined;

describe.skipIf(!firingEnabled)("Schedule trigger contract (scheduleFiring targets)", () => {
  let target: TargetProfile;
  let clients: ConformanceClients;
  const fixtures = new FixtureTracker();

  beforeAll(async () => {
    target = createTarget();
    await target.setup();
    clients = target.clients();
  });

  afterEach(async () => {
    await fixtures.cleanup();
  });

  afterAll(async () => {
    await target?.teardown();
  });

  // Creates a schedule whose target agent is then DELETED — the suite's
  // deterministic-failure mechanism (no cascade by contract: a dangling
  // reference surfaces at fire time, never as a create-time refusal).
  async function createDanglingSchedule(org: string) {
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("sched-dangling") }),
    );
    const agentSlug = agent.metadata!.slug;

    const schedule = await clients.scheduleCommand.create(
      makeSchedule(org, uniqueName("sched-fire"), agentSlug),
    );
    fixtures.defer(() => clients.scheduleCommand.delete({ value: schedule.metadata!.id }));

    await clients.agentCommand.delete({ value: agent.metadata!.id });
    return { schedule, agentSlug };
  }

  it("[rpc:ScheduleCommandController.trigger] a trigger answers the run's real outcome synchronously, stamps the fire, and never feeds the streak", async () => {
    const { org } = await target.provisionTenancy();
    const { schedule, agentSlug } = await createDanglingSchedule(org);

    const result = await clients.scheduleCommand.trigger({ value: schedule.metadata!.id });

    // The two-level contract: the trigger SUCCEEDED — the
    // run's deterministic failure is honestly reported in the result,
    // never thrown. The reason is the tick's exact vocabulary, pinned
    // byte-identical in both editions.
    expect(result.outcome).toBe(ScheduleRunOutcome.TARGET_MISSING);
    expect(result.refusalReason).toBe(targetMissingReason(org, agentSlug));
    expect(result.executionId).toBe("");

    // The handler stamps last_fire_at before answering — the fire is
    // observable in the result itself, no polling.
    expect(result.schedule?.status?.lastFireAt).toBeDefined();

    // Pinned cross-edition: manual fires do NOT feed the
    // failure streak — a test fire of a broken schedule must not race
    // its owner to the pause threshold. (The streak is the CRON health
    // signal; its auto-pause crossing is covered at the tick level in
    // both editions.)
    expect(result.schedule?.status?.consecutiveFailures ?? 0).toBe(0);
    const fresh = await clients.scheduleQuery.get({ value: schedule.metadata!.id });
    expect(fresh.status?.consecutiveFailures ?? 0).toBe(0);
    expect(fresh.status?.pausedReason ?? "").toBe("");
  });

  it("[rpc:ScheduleCommandController.trigger] [rpc:ScheduleQueryController.listRuns] every fire leaves a run-history row with the reason verbatim — including fires that created no execution", async () => {
    const { org } = await target.provisionTenancy();
    const { schedule, agentSlug } = await createDanglingSchedule(org);

    await clients.scheduleCommand.trigger({ value: schedule.metadata!.id });

    // The fire ledger: a no-execution fire is exactly the
    // case status.consecutive_failures alone cannot explain, and exactly
    // the row this surface exists to keep.
    const history = await clients.scheduleQuery.listRuns({
      scheduleId: schedule.metadata!.id,
    });
    expect(history.totalCount).toBe(1);
    const run = history.items[0]!;
    expect(run.origin).toBe(ScheduleRunOrigin.MANUAL);
    expect(run.outcome).toBe(ScheduleRunOutcome.TARGET_MISSING);
    expect(run.reason).toBe(targetMissingReason(org, agentSlug));
    expect(run.executionId).toBe("");
    expect(run.completedAt, "a no-run fire is terminal at insert").toBeDefined();
  });

  it("[rpc:ScheduleQueryController.listRuns] listing runs of a missing schedule is NotFound — an empty history never impersonates 'never fired'", async () => {
    await expectGrpcCode(
      () => clients.scheduleQuery.listRuns({ scheduleId: "sch_01conformancemissing" }),
      Code.NotFound,
      "list runs of a missing schedule",
    );
  });
});

describe.skipIf(!realRunProvable)("Schedule real-run contract (scheduleFiring + mock LLM targets)", () => {
  let target: TargetProfile;
  let clients: ConformanceClients;
  const fixtures = new FixtureTracker();

  beforeAll(async () => {
    target = createTarget();
    await target.setup();
    clients = target.clients();
  });

  afterEach(async () => {
    await fixtures.cleanup();
  });

  afterAll(async () => {
    await target?.teardown();
  });

  it("[rpc:ScheduleCommandController.trigger] [rpc:ScheduleQueryController.listRuns] a real fire runs the agent to completion — the result carries the execution, and run history resolves it at read time", async () => {
    const { org } = await target.provisionTenancy();

    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("sched-real-target") }),
    );
    const schedule = await clients.scheduleCommand.create(
      makeSchedule(org, uniqueName("sched-real"), agent.metadata!.slug),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    fixtures.defer(() => clients.scheduleCommand.delete({ value: schedule.metadata!.id }));
    const id = schedule.metadata!.id;

    target.llmProxy!().enqueue(anthropicText("Reminders sent."));

    // The sync trigger answers with the execution — no polling for
    // last_execution_id (the asynchronous shape this replaced).
    const result = await clients.scheduleCommand.trigger({ value: id });
    expect(result.outcome).toBe(ScheduleRunOutcome.STARTED);
    const executionId = result.executionId;
    expect(executionId).not.toBe("");
    expect(result.schedule?.status?.lastExecutionId).toBe(executionId);

    // A REAL execution shaped by the fire (the full create pipeline ran:
    // fresh session with the pinned subject, the fire-context line in
    // the prompt)...
    const execution = await clients.agentExecutionQuery.get({ value: executionId });
    expect(execution.spec?.message).toContain("(Scheduled fire time: ");
    const session = await clients.sessionQuery.get({ value: execution.spec!.sessionId });
    expect(session.spec?.subject).toBe(`Scheduled run: ${schedule.metadata!.slug}`);

    // ...that runs to completion.
    await pollUntil(
      () => clients.agentExecutionQuery.get({ value: executionId }),
      (e) => e.status?.phase === ExecutionPhase.EXECUTION_COMPLETED,
      (last, timeoutMs) =>
        `execution ${executionId} did not complete within ${timeoutMs}ms; ` +
        `last phase: ${last?.status?.phase}`,
    );

    // Manual fires are untracked by design — the caller watches the
    // execution — so run history resolves their outcome at READ time
    // from the execution's live phase (the honesty rule).
    const history = await clients.scheduleQuery.listRuns({ scheduleId: id });
    expect(history.totalCount).toBe(1);
    const run = history.items[0]!;
    expect(run.origin).toBe(ScheduleRunOrigin.MANUAL);
    expect(run.outcome).toBe(ScheduleRunOutcome.COMPLETED);
    expect(run.executionId).toBe(executionId);

    // The streak was never fed: manual fires are not the cron health
    // signal, completed or not.
    const fresh = await clients.scheduleQuery.get({ value: id });
    expect(fresh.status?.consecutiveFailures ?? 0).toBe(0);
  });
});
