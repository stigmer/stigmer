// Schedule conformance — the CRUD + refusal contract (Class A).
// Domain: conformance suites.
//
// Everything in this file is edition-unconditional: it needs no Temporal, no
// clock, no runner. The trigger/resume refusal matrix (DD-014 D-B) is part of
// the contract even where nothing can fire yet — the OSS Go server enforces
// it ahead of its clock precisely so these negatives hold on both editions.
// Coverage spans the full CRUD + query surface: create/delete, apply
// create/update branching, update spec replacement with the immutable
// agent_ref (repointing would bypass the create-time consent bar on the
// referenced agent — the AgentChannel rule), getByReference, the
// agent-id-keyed getByAgent (unknown agent answers an empty list, not an
// error), and the org-scoped list. The FIRING contract (a trigger records
// last_fire_at, failed fires accumulate into the platform auto-pause, resume
// + re-trigger fires again) and the run-history surface (listRuns) live in
// suites-execution/schedule-firing.conformance.test.ts, gated on the
// scheduleFiring capability.
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
// the caller on both editions. Returns both handles a schedule surface uses:
// the slug (what spec.agent.agent_ref carries) and the id (what getByAgent
// is keyed on).
async function createAgentFixture(org: string): Promise<{ id: string; slug: string }> {
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("sched-target") }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return { id: agent.metadata!.id, slug: agent.metadata!.slug };
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
    const { slug: agentSlug } = await createAgentFixture(org);

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
    const { slug: agentSlug } = await createAgentFixture(org);
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
    const { slug: agentSlug } = await createAgentFixture(org);
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
    const { slug: agentSlug } = await createAgentFixture(org);
    const created = await createScheduleFixture(org, agentSlug);

    const resumed = await clients.scheduleCommand.resume({ value: created.metadata!.id });

    expect(resumed.status?.pausedReason ?? "").toBe("");
    expect(resumed.status?.consecutiveFailures ?? 0).toBe(0);
  });

  it("a disabled schedule stays disabled through a resume — the latch and the switch are independent levers", async () => {
    const { org } = await target.provisionTenancy();
    const { slug: agentSlug } = await createAgentFixture(org);
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

describe("Schedule apply contract", () => {
  it("apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const { slug: agentSlug } = await createAgentFixture(org);
    const name = uniqueName("sched-apply");

    const first = await clients.scheduleCommand.apply(
      makeSchedule(org, name, agentSlug, { cron: "0 9 * * *" }),
    );
    fixtures.defer(() => clients.scheduleCommand.delete({ value: first.metadata!.id }));
    expect(first.metadata?.id).toMatch(/^sch_/);

    const second = await clients.scheduleCommand.apply(
      makeSchedule(org, name, agentSlug, { cron: "30 18 * * *" }),
    );

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.cron, "apply-as-update replaces the spec").toBe("30 18 * * *");
  });

  it("apply-as-update cannot repoint the agent target (FailedPrecondition)", async () => {
    // The agent_ref is immutable on every update path — the create-time
    // consent bar is edit rights on the REFERENCED agent, and a repoint
    // would bypass it (the AgentChannel rule). Apply routes through update
    // when the schedule exists, so the refusal must hold here too.
    const { org } = await target.provisionTenancy();
    const { slug: agentSlug } = await createAgentFixture(org);
    const { slug: otherAgentSlug } = await createAgentFixture(org);
    const name = uniqueName("sched-repoint");

    const created = await clients.scheduleCommand.apply(makeSchedule(org, name, agentSlug));
    fixtures.defer(() => clients.scheduleCommand.delete({ value: created.metadata!.id }));

    await expectGrpcCode(
      () => clients.scheduleCommand.apply(makeSchedule(org, name, otherAgentSlug)),
      Code.FailedPrecondition,
      "apply that repoints the schedule's agent",
    );
  });
});

describe("Schedule update contract", () => {
  it("update replaces the spec but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const { slug: agentSlug } = await createAgentFixture(org);
    const created = await createScheduleFixture(org, agentSlug);

    const updated = await clients.scheduleCommand.update({
      apiVersion: created.apiVersion,
      kind: created.kind,
      metadata: created.metadata,
      spec: { ...created.spec!, cron: "15 6 * * 1", timeZone: "UTC" },
    });

    expect(updated.metadata?.id).toBe(created.metadata?.id);
    expect(updated.metadata?.slug).toBe(created.metadata?.slug);
    expect(updated.metadata?.org).toBe(org);
    expect(updated.spec?.cron).toBe("15 6 * * 1");
    expect(updated.spec?.timeZone).toBe("UTC");
  });

  it("update cannot change the agent_ref (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    const { slug: agentSlug } = await createAgentFixture(org);
    const { slug: otherAgentSlug } = await createAgentFixture(org);
    const created = await createScheduleFixture(org, agentSlug);

    // Target the existing row (update loads by metadata.id) but carry a
    // different agent in the spec.
    const repointed = makeSchedule(org, created.metadata!.name, otherAgentSlug);
    await expectGrpcCode(
      () => clients.scheduleCommand.update({ ...repointed, metadata: created.metadata }),
      Code.FailedPrecondition,
      "update that repoints the schedule's agent",
    );
  });

  it("update of a missing schedule is NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const { slug: agentSlug } = await createAgentFixture(org);
    const name = uniqueName("sched-missing");

    // A valid schedule shape whose metadata.id points at nothing.
    const missing = makeSchedule(org, name, agentSlug);
    missing.metadata = { name, org, id: "sch_01conformancemissing" };
    await expectGrpcCode(
      () => clients.scheduleCommand.update(missing),
      Code.NotFound,
      "update a missing schedule",
    );
  });
});

describe("Schedule queries", () => {
  it("getByReference resolves by org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const { slug: agentSlug } = await createAgentFixture(org);
    const created = await createScheduleFixture(org, agentSlug);

    const fetched = await clients.scheduleQuery.getByReference({
      org,
      slug: created.metadata!.slug,
    });
    expect(fetched.metadata?.id).toBe(created.metadata?.id);
  });

  it("getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.scheduleQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("getByAgent returns only the agent's schedules, keyed by agent id", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await createAgentFixture(org);
    const otherAgent = await createAgentFixture(org);

    const mine = await createScheduleFixture(org, agent.slug);
    await createScheduleFixture(org, otherAgent.slug);

    const list = await clients.scheduleQuery.getByAgent({ agentId: agent.id });

    const ids = list.items.map((s) => s.metadata?.id);
    expect(ids, "the agent's schedule is present").toContain(mine.metadata?.id);
    for (const item of list.items) {
      const targetArm = item.spec?.target;
      expect(targetArm?.case, "every returned schedule targets an agent").toBe("agent");
      expect(
        targetArm?.case === "agent" ? targetArm.value.agentRef?.slug : undefined,
        "getByAgent must not leak another agent's schedules",
      ).toBe(agent.slug);
    }
    expect(list.totalCount).toBe(list.items.length);
  });

  it("getByAgent of an unknown agent returns an empty list, not an error", async () => {
    // "No schedules" is the useful answer for an operational surface
    // whether the agent is unknown or merely schedule-less.
    const list = await clients.scheduleQuery.getByAgent({
      agentId: "agent_01conformancemissing",
    });
    expect(list.items).toHaveLength(0);
    expect(list.totalCount ?? 0).toBe(0);
  });

  it("getByAgent rejects an empty agent_id with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.scheduleQuery.getByAgent({ agentId: "" }),
      Code.InvalidArgument,
      "getByAgent empty agent_id",
    ));

  it("list returns the org's schedules", async () => {
    const { org } = await target.provisionTenancy();
    const { slug: agentSlug } = await createAgentFixture(org);
    const created = await createScheduleFixture(org, agentSlug);

    const list = await clients.scheduleQuery.list({ org });

    expect(list.items.map((s) => s.metadata?.id)).toContain(created.metadata?.id);
    expect(list.totalCount).toBe(list.items.length);
  });

  it("list rejects an empty org with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.scheduleQuery.list({ org: "" }),
      Code.InvalidArgument,
      "list empty org",
    ));
});
