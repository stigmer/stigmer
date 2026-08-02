// Schedule conformance — the CRUD + refusal contract (Class A).
// Domain: conformance suites.
//
// Everything in this file is edition-unconditional: it needs no Temporal, no
// clock, no runner. The trigger/resume refusal matrix (DD-014 D-B) is part of
// the contract even where nothing can fire yet — the OSS Go server enforces
// it ahead of its clock precisely so these negatives hold on both editions.
// The FIRING contract (a trigger records last_fire_at, failed fires
// accumulate into the platform auto-pause, resume + re-trigger fires again)
// lives in suites-execution/schedule-firing.conformance.test.ts, gated on
// the scheduleFiring capability.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { TRIGGER_DISABLED_MESSAGE, makeSchedule } from "../support/schedules";
import { createTarget, type TargetProfile } from "../targets";

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

// Creates the referenced agent first: the schedule create's consent bar is
// edit rights on the REFERENCED agent, so the agent must exist and belong to
// the caller on both editions.
async function createAgentFixture(org: string): Promise<string> {
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("sched-target") }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent.metadata!.slug;
}

async function createScheduleFixture(
  org: string,
  agentSlug: string,
  options: { enabled?: boolean } = {},
) {
  const schedule = await clients.scheduleCommand.create(
    makeSchedule(org, uniqueName("sched"), agentSlug, { enabled: options.enabled }),
  );
  fixtures.defer(() => clients.scheduleCommand.delete({ value: schedule.metadata!.id }));
  return schedule;
}

describe("Schedule CRUD contract", () => {
  it("create round-trips the spec and starts with a clean firing status", async () => {
    const { org } = await target.provisionTenancy();
    const agentSlug = await createAgentFixture(org);

    const created = await createScheduleFixture(org, agentSlug);

    expect(created.metadata?.id).toMatch(/^sch_/);
    expect(created.spec?.cron).toBe("0 9 * * *");
    expect(created.spec?.timeZone).toBe("Asia/Kolkata");
    expect(created.spec?.enabled).toBe(true);
    expect(created.status?.pausedReason ?? "").toBe("");
    expect(created.status?.consecutiveFailures ?? 0).toBe(0);

    const fetched = await clients.scheduleQuery.get({ value: created.metadata!.id });
    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    expect(fetched.spec?.cron).toBe("0 9 * * *");
    expect(fetched.spec?.target.case).toBe("agent");
  });

  it("delete removes the schedule", async () => {
    const { org } = await target.provisionTenancy();
    const agentSlug = await createAgentFixture(org);
    const created = await createScheduleFixture(org, agentSlug);

    await clients.scheduleCommand.delete({ value: created.metadata!.id });

    await expectGrpcCode(
      () => clients.scheduleQuery.get({ value: created.metadata!.id }),
      Code.NotFound,
      "get after delete",
    );
  });
});

describe("Schedule trigger refusal matrix (DD-014 D-B — unconditional on every edition)", () => {
  it("triggering a missing schedule is NotFound", async () => {
    await expectGrpcCode(
      () => clients.scheduleCommand.trigger({ value: "sch_01conformancemissing" }),
      Code.NotFound,
      "trigger a missing schedule",
    );
  });

  it("triggering a disabled schedule refuses with the exact teaching copy", async () => {
    const { org } = await target.provisionTenancy();
    const agentSlug = await createAgentFixture(org);
    const disabled = await createScheduleFixture(org, agentSlug, { enabled: false });

    const err = await expectGrpcCode(
      () => clients.scheduleCommand.trigger({ value: disabled.metadata!.id }),
      Code.FailedPrecondition,
      "trigger a disabled schedule",
    );
    // Contract copy: pinned in the Java handler test and the Go controller
    // test; asserted here over the wire so neither edition can drift.
    expect(err.message, "the disabled refusal copy is contract").toContain(
      TRIGGER_DISABLED_MESSAGE,
    );
  });
});

describe("Schedule resume contract (unconditional on every edition)", () => {
  it("resuming an unpaused schedule succeeds and changes nothing", async () => {
    const { org } = await target.provisionTenancy();
    const agentSlug = await createAgentFixture(org);
    const created = await createScheduleFixture(org, agentSlug);

    const resumed = await clients.scheduleCommand.resume({ value: created.metadata!.id });

    expect(resumed.status?.pausedReason ?? "").toBe("");
    expect(resumed.status?.consecutiveFailures ?? 0).toBe(0);
  });

  it("a disabled schedule stays disabled through a resume — the latch and the switch are independent levers", async () => {
    const { org } = await target.provisionTenancy();
    const agentSlug = await createAgentFixture(org);
    const disabled = await createScheduleFixture(org, agentSlug, { enabled: false });

    const resumed = await clients.scheduleCommand.resume({ value: disabled.metadata!.id });

    expect(
      resumed.spec?.enabled,
      "resume clears the platform's pause, never the owner's enabled switch",
    ).toBe(false);
  });

  it("resuming a missing schedule is NotFound", async () => {
    await expectGrpcCode(
      () => clients.scheduleCommand.resume({ value: "sch_01conformancemissing" }),
      Code.NotFound,
      "resume a missing schedule",
    );
  });
});
