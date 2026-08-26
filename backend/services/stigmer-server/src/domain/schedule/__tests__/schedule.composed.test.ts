/**
 * Pins the schedule domain against Go's schedule_test.go and
 * trigger_test.go — through the REAL stack: a composed server on an
 * ephemeral port, a native gRPC client, the full interceptor chain, the
 * REAL in-process agentexecution create pipeline behind the trigger, and
 * a deterministically-closed Temporal port (the arming steps must degrade,
 * never refuse — DD-015 D-A).
 *
 * The load-bearing pins the conformance suite does NOT own:
 *   - status preservation across apply-as-update (the auto-pause can never
 *     be clobbered declaratively) and the update graft's status honesty;
 *   - resume's atomic latch+streak clear, its idempotent no-write no-op,
 *     and the pause→resume round trip;
 *   - the trigger's two-level contract with the REAL launch gates: with no
 *     engine behind the server the fire happens and honestly reports the
 *     EnsureEngineAvailable refusal — never a gRPC error;
 *   - the fire ledger: manual rows, cascade on delete, listRuns paging.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { ScheduleCommandController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/command_pb";
import { ScheduleQueryController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/query_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";
import {
  ScheduleRunOrigin,
  ScheduleRunOutcome,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { TRIGGER_DISABLED_MESSAGE } from "../trigger.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof ScheduleCommandController>;
let query: Client<typeof ScheduleQueryController>;
let agentCommand: Client<typeof AgentCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "schedule-domain-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed — arming degrades (DD-015 D-A) and the trigger's launch
      // gates refuse honestly.
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  command = createClient(ScheduleCommandController, transport);
  query = createClient(ScheduleQueryController, transport);
  agentCommand = createClient(AgentCommandController, transport);

  for (const [name, slug] of [
    ["Helper", "helper"],
    ["Ephemeral", "ephemeral"],
    ["Ephemeral Two", "ephemeral-2"],
    ["Ephemeral Three", "ephemeral-3"],
  ] as const) {
    await agentCommand.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name, org: "acme", slug },
      spec: { instructions: "a composed-test target agent" },
    });
  }
});

/** Deletes a test agent by slug — the dangling-reference setup. */
async function deleteAgent(slug: string): Promise<void> {
  const agents = createClient(AgentQueryController, transport);
  const agent = await agents.getByReference({
    kind: ApiResourceKind.agent,
    org: "acme",
    slug,
  });
  await agentCommand.delete({ value: agent.metadata?.id ?? "" });
}

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

function scheduleInput(overrides?: {
  name?: string;
  org?: string;
  slug?: string;
  cron?: string;
  timeZone?: string;
  enabled?: boolean;
  agentSlug?: string;
  agentOrg?: string;
  labels?: Record<string, string>;
  message?: string;
}) {
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Schedule",
    metadata: {
      name: overrides?.name ?? "Daily Rounds",
      org: overrides?.org ?? "acme",
      slug: overrides?.slug ?? "",
      labels: overrides?.labels ?? {},
    },
    spec: {
      cron: overrides?.cron ?? "0 9 * * *",
      timeZone: overrides?.timeZone ?? "Asia/Kolkata",
      enabled: overrides?.enabled ?? true,
      target: {
        case: "agent" as const,
        value: {
          agentRef: {
            kind: ApiResourceKind.agent,
            slug: overrides?.agentSlug ?? "helper",
            org: overrides?.agentOrg ?? "",
          },
          message: overrides?.message ?? "Do the rounds",
        },
      },
    },
  };
}

async function refusal(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("create — the defaults resolver through the real chain", () => {
  it("creates with a derived slug and the sch_ id prefix; arming degrades with Temporal away", async () => {
    const created = await command.create(scheduleInput({ name: "Morning Digest" }));
    expect(created.metadata?.id).toMatch(/^sch_[0-9a-z]{26}$/);
    expect(created.metadata?.slug).toBe("morning-digest");
    // Temporal is a closed port: the arm degraded, next_fire_at absent —
    // the write still succeeded (DD-015 D-A).
    expect(created.status?.nextFireAt).toBeUndefined();
    // The ref org normalized to the schedule's own.
    expect(
      created.spec?.target.case === "agent"
        ? created.spec.target.value.agentRef?.org
        : "",
    ).toBe("acme");
  });

  it("requires metadata.org", async () => {
    const err = await refusal(() => command.create(scheduleInput({ org: "" })));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe("metadata.org is required for a schedule");
  });

  it("refuses a cross-org agent ref BEFORE the agent load (no slug probing)", async () => {
    const err = await refusal(() =>
      command.create(scheduleInput({ name: "X", agentOrg: "other-org", agentSlug: "secret" })),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(
      "spec.agent.agent_ref.org must match metadata.org — a schedule must live in the referenced agent's organization (other-org)",
    );
  });

  it("refuses a nonexistent agent with the direct-lookup NOT_FOUND", async () => {
    const err = await refusal(() =>
      command.create(scheduleInput({ name: "Y", agentSlug: "vanished" })),
    );
    expect(err.code).toBe(Code.NotFound);
  });

  it("validates the cron grammar and time zone through the pipeline", async () => {
    expect(
      (await refusal(() => command.create(scheduleInput({ name: "Z", cron: "@every 5m" })))).code,
    ).toBe(Code.InvalidArgument);
    expect(
      (await refusal(() => command.create(scheduleInput({ name: "Z", timeZone: "Local" })))).code,
    ).toBe(Code.InvalidArgument);
  });
});

describe("apply — create-or-update with status preserved verbatim", () => {
  it("creates, then re-applies as update WITHOUT resetting runtime status", async () => {
    const applied = await command.apply(scheduleInput({ name: "Weekly Sync", slug: "weekly-sync" }));
    const id = applied.metadata?.id ?? "";

    // Simulate the clock's runtime writes through the wire-facing store:
    // pause the schedule as the streak would.
    const paused = await pauseDirectly(id);
    expect(paused.status?.pausedReason).not.toBe("");

    // A routine manifest re-apply must never clear the latch or streak.
    const reApplied = await command.apply(
      scheduleInput({ name: "Weekly Sync", slug: "weekly-sync", cron: "30 8 * * *" }),
    );
    expect(reApplied.metadata?.id).toBe(id);
    expect(reApplied.spec?.cron).toBe("30 8 * * *");
    expect(reApplied.status?.pausedReason).toBe(paused.status?.pausedReason);
    expect(reApplied.status?.consecutiveFailures).toBe(2);
  });
});

// Pause a schedule the way the clock does — the same atomic status write
// recordFailedRun performs, driven through the composed server's exposed
// store (the boot-test seam). The trigger/resume tests below need a
// latched row without a live Temporal engine.
async function pauseDirectly(id: string): Promise<Schedule> {
  return server.store.updateResource(ApiResourceKind.schedule, id, ScheduleSchema, (live) => {
    if (live.status === undefined) {
      live.status = create(ScheduleStatusSchema);
    }
    live.status.pausedReason =
      "Paused after 2 consecutive failed runs. Last failure: run aex_x ended failed";
    live.status.consecutiveFailures = 2;
  });
}

describe("update — immutable identity and the status-honest graft", () => {
  it("refuses repointing the agent ref with the byte-pinned copy", async () => {
    await agentCommand.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "Other", org: "acme", slug: "other" },
      spec: { instructions: "the other assistant agent" },
    });
    const created = await command.create(scheduleInput({ name: "Repoint Me", slug: "repoint-me" }));
    const err = await refusal(() =>
      command.update({
        ...scheduleInput({ name: "Repoint Me", slug: "repoint-me", agentSlug: "other" }),
        metadata: created.metadata,
      }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(
      "spec.agent.agent_ref is immutable (schedule runs acme/helper) — create a new schedule to run a different agent",
    );
  });

  it("re-validates cron/tz on update (spec replaced wholesale)", async () => {
    const created = await command.create(scheduleInput({ name: "Revalidate", slug: "revalidate" }));
    const err = await refusal(() =>
      command.update({
        ...scheduleInput({ name: "Revalidate", slug: "revalidate", cron: "bad" }),
        metadata: created.metadata,
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("preserves concurrently-written status through the graft", async () => {
    const created = await command.create(scheduleInput({ name: "Graft", slug: "graft" }));
    const id = created.metadata?.id ?? "";
    await pauseDirectly(id);
    const updated = await command.update({
      ...scheduleInput({ name: "Graft", slug: "graft", cron: "15 7 * * *" }),
      metadata: created.metadata,
    });
    // The graft carried the request's spec but answered with the LIVE
    // status the runtime wrote mid-request.
    expect(updated.spec?.cron).toBe("15 7 * * *");
    expect(updated.status?.consecutiveFailures).toBe(2);
    expect(updated.status?.pausedReason).toContain("Paused after 2");
  });
});

describe("resume — the one clearing path (DD-013 D-D)", () => {
  it("clears the latch AND the streak atomically and re-arms", async () => {
    const created = await command.create(scheduleInput({ name: "Resume Me", slug: "resume-me" }));
    const id = created.metadata?.id ?? "";
    await pauseDirectly(id);

    const resumed = await command.resume({ value: id });
    expect(resumed.status?.pausedReason).toBe("");
    expect(resumed.status?.consecutiveFailures).toBe(0);
  });

  it("is an idempotent no-op on a fresh row — no write, no audit bump", async () => {
    const created = await command.create(scheduleInput({ name: "Fresh", slug: "fresh" }));
    const id = created.metadata?.id ?? "";
    const before = await query.get({ value: id });
    const resumed = await command.resume({ value: id });
    expect(resumed.status?.audit?.statusAudit?.updatedAt?.seconds).toBe(
      before.status?.audit?.statusAudit?.updatedAt?.seconds,
    );
    expect(resumed.status?.audit?.statusAudit?.updatedAt?.nanos).toBe(
      before.status?.audit?.statusAudit?.updatedAt?.nanos,
    );
  });

  it("answers NOT_FOUND for a missing schedule", async () => {
    const err = await refusal(() => command.resume({ value: "sch_missing" }));
    expect(err.code).toBe(Code.NotFound);
  });
});

describe("trigger — the two-level contract (DD-017 D-5)", () => {
  it("refuses a missing schedule with NOT_FOUND (level one)", async () => {
    const err = await refusal(() => command.trigger({ value: "sch_missing" }));
    expect(err.code).toBe(Code.NotFound);
  });

  it("refuses a disabled schedule with FAILED_PRECONDITION and the byte-pinned copy", async () => {
    await command.create(scheduleInput({ name: "Disabled", slug: "disabled", enabled: false }));
    const row = await query.getByReference({
      kind: ApiResourceKind.schedule,
      org: "acme",
      slug: "disabled",
    });
    const err = await refusal(() => command.trigger({ value: row.metadata?.id ?? "" }));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(TRIGGER_DISABLED_MESSAGE);
  });

  it("relays an infrastructure failure as a CLEAN gRPC error (the engine gate's UNAVAILABLE, re-minted — never NGHTTP2 corruption)", async () => {
    const created = await command.create(scheduleInput({ name: "Fire Me", slug: "fire-me" }));
    const id = created.metadata?.id ?? "";

    // No engine behind this server: the create pipeline's engine gate
    // refuses Unavailable — an infrastructure failure, propagated as the
    // trigger's OWN error (Go: "Manual trigger's run start failed on
    // infrastructure"). The re-mint matters: echoing the in-process error
    // corrupts HTTP/2 trailers (the #18 transport finding).
    const err = await refusal(() => command.trigger({ value: id }));
    expect(err.code).toBe(Code.Unavailable);
    // No fire happened: no ledger row, no last_fire_at.
    const runs = await query.listRuns({ scheduleId: id });
    expect(runs.totalCount).toBe(0);
    const after = await query.get({ value: id });
    expect(after.status?.lastFireAt).toBeUndefined();
  });

  it("fires and honestly reports TARGET_MISSING (level two: gRPC success, outcome named)", async () => {
    const created = await command.create(
      scheduleInput({ name: "Orphan Fire", slug: "orphan-fire", agentSlug: "ephemeral" }),
    );
    const id = created.metadata?.id ?? "";
    await deleteAgent("ephemeral");

    // The fire happened (level two): the deterministic dangling-reference
    // outcome is a SUCCESSFUL trigger honestly reported, never an
    // exception (no cascade by contract).
    const result = await command.trigger({ value: id });
    expect(result.outcome).toBe(ScheduleRunOutcome.TARGET_MISSING);
    expect(result.refusalReason).toBe("target agent acme/ephemeral not found");
    expect(result.executionId).toBe("");
    // The post-fire row: last_fire_at stamped by the handler.
    expect(result.schedule?.status?.lastFireAt).toBeDefined();

    // The manual fire left its terminal ledger row.
    const runs = await query.listRuns({ scheduleId: id });
    expect(runs.totalCount).toBe(1);
    expect(runs.items[0]?.origin).toBe(ScheduleRunOrigin.MANUAL);
    expect(runs.items[0]?.outcome).toBe(ScheduleRunOutcome.TARGET_MISSING);
    expect(runs.items[0]?.completedAt).toBeDefined();
  });

  it("a PAUSED schedule is triggerable (test-then-resume) and manual fires never feed the streak", async () => {
    const created = await command.create(
      scheduleInput({ name: "Paused Fire", slug: "paused-fire", agentSlug: "ephemeral-2" }),
    );
    const id = created.metadata?.id ?? "";
    await deleteAgent("ephemeral-2");
    await pauseDirectly(id);

    // Past ValidateTriggerable (paused ≠ disabled), the fire runs and
    // reports its target-missing outcome.
    const result = await command.trigger({ value: id });
    expect(result.outcome).toBe(ScheduleRunOutcome.TARGET_MISSING);
    const after = await query.get({ value: id });
    // The streak is untouched by the manual fire's outcome.
    expect(after.status?.consecutiveFailures).toBe(2);
    expect(after.status?.pausedReason).toContain("Paused after 2");
  });
});

describe("queries — list, getByAgent, listRuns", () => {
  it("list filters by org and labels (AND), newest first", async () => {
    await command.create(
      scheduleInput({ name: "Tagged A", slug: "tagged-a", labels: { team: "ops", tier: "1" } }),
    );
    await command.create(
      scheduleInput({ name: "Tagged B", slug: "tagged-b", labels: { team: "ops" } }),
    );
    const both = await query.list({ org: "acme", labels: { team: "ops" } });
    expect(both.items.map((s) => s.metadata?.slug)).toContain("tagged-a");
    expect(both.items.map((s) => s.metadata?.slug)).toContain("tagged-b");
    // Newest first: tagged-b was created after tagged-a.
    expect(both.items.findIndex((s) => s.metadata?.slug === "tagged-b")).toBeLessThan(
      both.items.findIndex((s) => s.metadata?.slug === "tagged-a"),
    );

    const one = await query.list({ org: "acme", labels: { team: "ops", tier: "1" } });
    expect(one.items.map((s) => s.metadata?.slug)).toEqual(["tagged-a"]);

    const none = await query.list({ org: "other-org", labels: {} });
    expect(none.totalCount).toBe(0);
  });

  it("getByAgent answers an empty list for an unknown agent id", async () => {
    const result = await query.getByAgent({ agentId: "agt_missing", org: "" });
    expect(result.totalCount).toBe(0);
    expect(result.items).toEqual([]);
  });

  it("getByAgent resolves the agent by id and filters by its org+slug identity", async () => {
    const agents = createClient(AgentQueryController, transport);
    const helper = await agents.getByReference({
      kind: ApiResourceKind.agent,
      org: "acme",
      slug: "helper",
    });
    const result = await query.getByAgent({ agentId: helper.metadata?.id ?? "", org: "acme" });
    expect(result.totalCount).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(
        item.spec?.target.case === "agent" ? item.spec.target.value.agentRef?.slug : "",
      ).toBe("helper");
    }
  });

  it("listRuns answers NOT_FOUND for a missing schedule (never an empty history)", async () => {
    const err = await refusal(() => query.listRuns({ scheduleId: "sch_missing" }));
    expect(err.code).toBe(Code.NotFound);
  });

  it("listRuns pages newest-first with 1-indexed pages (fire-identity rows via the ledger)", async () => {
    const created = await command.create(scheduleInput({ name: "Paged Runs", slug: "paged-runs" }));
    const id = created.metadata?.id ?? "";
    // Three fires with distinct nominal times, inserted through the store
    // (a trigger's nominal is "now", so real fires within one second would
    // upsert the same row — the ledger key IS the fire identity).
    for (const hour of ["09", "10", "11"]) {
      await server.store.upsertScheduleRun({
        scheduleId: id,
        org: "acme",
        nominalFireTime: `2026-08-25T${hour}:00:00Z`,
        origin: "cron",
        outcome: "completed",
        reason: "",
        executionId: "aex_paged",
        recordedAt: `2026-08-25T${hour}:00:00Z`,
        completedAt: `2026-08-25T${hour}:30:00Z`,
      });
    }

    const pageOne = await query.listRuns({ scheduleId: id, pageInfo: { size: 2, num: 1 } });
    expect(pageOne.totalCount).toBe(3);
    expect(pageOne.items).toHaveLength(2);
    // Newest first: 11:00 then 10:00.
    expect(pageOne.items[0]?.nominalFireTime?.seconds).toBe(
      BigInt(Date.parse("2026-08-25T11:00:00Z") / 1000),
    );

    const pageTwo = await query.listRuns({ scheduleId: id, pageInfo: { size: 2, num: 2 } });
    expect(pageTwo.items).toHaveLength(1);
    expect(pageTwo.items[0]?.nominalFireTime?.seconds).toBe(
      BigInt(Date.parse("2026-08-25T09:00:00Z") / 1000),
    );

    // A zero/absent page reads as the first (1-indexed contract).
    const defaulted = await query.listRuns({ scheduleId: id, pageInfo: { size: 2, num: 0 } });
    expect(defaulted.items[0]?.nominalFireTime?.seconds).toBe(
      pageOne.items[0]?.nominalFireTime?.seconds,
    );
  });
});

describe("delete — teardown posture and the ledger cascade", () => {
  it("returns the pre-delete resource and cascades the fire ledger", async () => {
    const created = await command.create(
      scheduleInput({ name: "Delete Me", slug: "delete-me", agentSlug: "ephemeral-3" }),
    );
    const id = created.metadata?.id ?? "";
    await deleteAgent("ephemeral-3");
    await command.trigger({ value: id }); // leaves a manual TARGET_MISSING row

    const deleted = await command.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    const err = await refusal(() => query.get({ value: id }));
    expect(err.code).toBe(Code.NotFound);
    // The ledger cascade ran (listRuns on the deleted schedule is NOT_FOUND,
    // so assert through the store).
    const { total } = await server.store.listScheduleRuns(id, 0, 10);
    expect(total).toBe(0);
  });
});

// Round-trip guard: the wire schedule marshals/unmarshals through the
// binary codec the store uses (catches schema drift in the test itself).
it("schedule wire shape round-trips through the binary codec", async () => {
  const created = await command.create(scheduleInput({ name: "Round Trip", slug: "round-trip" }));
  const bytes = toBinary(ScheduleSchema, created);
  expect(fromBinary(ScheduleSchema, bytes).metadata?.slug).toBe("round-trip");
});
