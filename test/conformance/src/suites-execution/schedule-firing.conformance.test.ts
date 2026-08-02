// Schedule firing conformance — the cross-edition FIRING contract.
// Domain: conformance suites (execution engine).
//
// The first execution-class suite that runs against BOTH editions: firing
// needs the engine (Temporal + the schedule clock) but deliberately NO
// runner and NO LLM — every fire here targets a DELETED agent, so it fails
// deterministically inside the tick before any execution is created. That
// one design choice is what makes the failure streak, the platform
// auto-pause, and resume assertable over the wire, offline, on any target
// with `scheduleFiring`.
//
// Gated on the scheduleFiring capability (the workflowChildApprovalForwarding
// pattern): true for cloud today, false for local-go-execution until the OSS
// Go clock lands (T04 slice 3) — flipping that flag is the slice's finish
// line, and this suite is the scoreboard.
import { setTimeout as delay } from "node:timers/promises";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { anthropicText } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import {
  makeSchedule,
  pausedReasonCopy,
  pollScheduleUntil,
  targetMissingReason,
  triggerPausedMessage,
} from "../support/schedules";
import { createTarget, type TargetProfile } from "../targets";

// Read once at collection time to gate the describes (constructing a target is
// side-effect-free; setup() is what boots processes).
const collectionTarget = createTarget();
const firingEnabled = collectionTarget.capabilities.scheduleFiring;
// The real-run block additionally needs the mock LLM proxy (only execution
// targets provision one; the cloud target reports it as skipped — its
// completed-run path is covered by the cloud repo's own wire suites).
const realRunProvable = firingEnabled && collectionTarget.llmProxy !== undefined;

// The auto-pause threshold BOTH harnesses pin to 2 so the pause is provable
// in two fires instead of the production five: the Java service via
// STIGMER_SCHEDULES_MAX_CONSECUTIVE_FAILURES=2 in the integration harness's
// buildServiceEnv (which the hermetic cloud conformance env reuses), and the
// Go server via the same variable in this suite's server spawn env.
const PAUSE_THRESHOLD = 2;

// Nominal fire times have whole-second granularity (the workflow-id suffix
// and the execution idempotency key both truncate to seconds), so two
// triggers inside one second would collapse into one fire. Space explicit
// triggers apart by just over a second — this is nominal-time spacing, not a
// wait for an async effect (those are polled).
const NOMINAL_TIME_SPACING_MS = 1_100;

describe.skipIf(!firingEnabled)("Schedule firing contract (scheduleFiring targets)", () => {
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

  it("a trigger fires: the tick records last_fire_at", async () => {
    const { org } = await target.provisionTenancy();
    const { schedule } = await createDanglingSchedule(org);

    await clients.scheduleCommand.trigger({ value: schedule.metadata!.id });

    const fired = await pollScheduleUntil(
      clients,
      schedule.metadata!.id,
      "last_fire_at recorded",
      (s) => s.status?.lastFireAt !== undefined,
    );
    expect(fired.status?.lastFireAt).toBeDefined();
  });

  it("deterministic failures accumulate into the platform auto-pause; resume clears it and the schedule fires again", async () => {
    const { org } = await target.provisionTenancy();
    const { schedule, agentSlug } = await createDanglingSchedule(org);
    const id = schedule.metadata!.id;

    // Fire 1: the dangling target fails the run start before any execution
    // exists — streak 1, below the threshold, not paused.
    await clients.scheduleCommand.trigger({ value: id });
    const afterFirst = await pollScheduleUntil(
      clients,
      id,
      "consecutive_failures == 1",
      (s) => (s.status?.consecutiveFailures ?? 0) === 1,
    );
    expect(afterFirst.status?.pausedReason ?? "").toBe("");

    // Fire 2 crosses the threshold: the platform pauses with its exact
    // teaching copy and clears next_fire_at.
    await delay(NOMINAL_TIME_SPACING_MS);
    await clients.scheduleCommand.trigger({ value: id });
    const expectedPause = pausedReasonCopy(
      PAUSE_THRESHOLD,
      targetMissingReason(org, agentSlug),
    );
    const paused = await pollScheduleUntil(
      clients,
      id,
      "platform auto-pause",
      (s) => (s.status?.pausedReason ?? "") !== "",
    );
    // The pause copy is contract: both editions must produce it
    // byte-for-byte, threshold and failure reason included.
    expect(paused.status?.pausedReason).toBe(expectedPause);
    expect(paused.status?.consecutiveFailures).toBe(PAUSE_THRESHOLD);
    expect(paused.status?.nextFireAt, "a paused schedule advertises no next fire").toBeUndefined();

    // Triggering while paused refuses with the exact copy — resume is the
    // one clearing path.
    const refusal = await expectGrpcCode(
      () => clients.scheduleCommand.trigger({ value: id }),
      Code.FailedPrecondition,
      "trigger a platform-paused schedule",
    );
    expect(refusal.message).toContain(triggerPausedMessage(expectedPause));

    // Resume clears the latch AND the streak (resuming with strikes left
    // would re-pause on the next failure — a lie), and re-arms the clock.
    const resumed = await clients.scheduleCommand.resume({ value: id });
    expect(resumed.status?.pausedReason ?? "").toBe("");
    expect(resumed.status?.consecutiveFailures ?? 0).toBe(0);

    // The schedule genuinely fires again: a fresh trigger lands a new fire
    // record and the streak restarts from the failure, not from the pause.
    await delay(NOMINAL_TIME_SPACING_MS);
    const lastFireBefore = paused.status?.lastFireAt?.seconds ?? 0n;
    await clients.scheduleCommand.trigger({ value: id });
    const firedAgain = await pollScheduleUntil(
      clients,
      id,
      "a post-resume fire recorded",
      (s) => (s.status?.lastFireAt?.seconds ?? 0n) > lastFireBefore,
    );
    expect(firedAgain.status?.consecutiveFailures).toBe(1);
    expect(firedAgain.status?.pausedReason ?? "").toBe("");
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

  it("a real fire runs the agent to completion — the run lands on status and the completed run resets the streak", async () => {
    // Failure, then recovery: the exact arc a user with a broken-then-
    // fixed schedule lives through, and the only black-box way to
    // observe the completed-run reset (status is platform-owned; a
    // streak cannot be seeded through the API).
    const { org } = await target.provisionTenancy();

    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("sched-real-target") }),
    );
    const agentSlug = agent.metadata!.slug;
    const schedule = await clients.scheduleCommand.create(
      makeSchedule(org, uniqueName("sched-real"), agentSlug),
    );
    fixtures.defer(() => clients.scheduleCommand.delete({ value: schedule.metadata!.id }));
    const id = schedule.metadata!.id;

    // Strike one: delete the target and fire — deterministic failure.
    await clients.agentCommand.delete({ value: agent.metadata!.id });
    await clients.scheduleCommand.trigger({ value: id });
    await pollScheduleUntil(clients, id, "the strike recorded",
      (s) => (s.status?.consecutiveFailures ?? 0) === 1);

    // Recovery: re-create the agent under the SAME slug (the schedule
    // references by slug) and script one text turn on the mock LLM so
    // the run completes.
    const revived = await clients.agentCommand.create(
      makeAgent({ org, name: agentSlug }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: revived.metadata!.id }));
    target.llmProxy!().enqueue(anthropicText("Reminders sent."));

    await delay(NOMINAL_TIME_SPACING_MS);
    await clients.scheduleCommand.trigger({ value: id });

    // The run lands on status as it starts...
    const withRun = await pollScheduleUntil(clients, id, "last_execution_id recorded",
      (s) => (s.status?.lastExecutionId ?? "") !== "");
    const executionId = withRun.status!.lastExecutionId;

    // ...is a REAL execution shaped by the fire (the full create
    // pipeline ran: fresh session with the pinned subject, the
    // fire-context line in the prompt)...
    const execution = await clients.agentExecutionQuery.get({ value: executionId });
    expect(execution.spec?.message).toContain("(Scheduled fire time: ");
    const session = await clients.sessionQuery.get({ value: execution.spec!.sessionId });
    expect(session.spec?.subject).toBe(`Scheduled run: ${schedule.metadata!.slug}`);

    // ...and its completion resets the streak — the tick tracked the
    // run to its terminal phase and recorded the verdict.
    const reset = await pollScheduleUntil(clients, id, "the completed run reset the streak",
      (s) => (s.status?.consecutiveFailures ?? 0) === 0 && (s.status?.pausedReason ?? "") === "");
    expect(reset.status?.consecutiveFailures ?? 0).toBe(0);

    const finished = await clients.agentExecutionQuery.get({ value: executionId });
    expect(finished.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });
});
