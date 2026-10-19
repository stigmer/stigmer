/**
 * Pins the routine domain against Go's schedule_test.go and
 * trigger_test.go — through the REAL stack: a composed server on an
 * ephemeral port, a native gRPC client, the full interceptor chain, the
 * REAL in-process agentexecution create pipeline behind the trigger, and
 * a deterministically-closed Temporal port (the arming steps must degrade,
 * never refuse).
 *
 * The load-bearing pins the conformance suite does NOT own:
 *   - the create refusals an unattended run needs: a resource that is a
 *     local folder, a File that does not exist (domain/file/routine-files.ts
 *     owns the File checks), a Cursor routine with no pinned model, and
 *     a pin the model registry does not know;
 *   - status preservation across apply-as-update (the auto-pause can never
 *     be clobbered declaratively) and the update graft's status honesty;
 *   - an update keeps the tick's pause that lands between its read and its
 *     write, the lost swap retried from a fresh read;
 *   - resume's atomic latch+streak clear, its idempotent no-write no-op,
 *     and the pause→resume round trip;
 *   - the fire's two-level contract with the REAL launch gates: with no
 *     engine behind the server the fire happens and honestly reports the
 *     EnsureEngineAvailable refusal — never a gRPC error;
 *   - a routine goes with its agent: deleting the agent deletes it and its
 *     fire history. A fire's TARGET_MISSING outcome is still reported for
 *     an agent row gone without its cascade (a store restored from a backup
 *     older than the routine), which these cases stage through the store;
 *   - the fire ledger: manual rows, cascade on delete, listFires paging,
 *     and an in-flight row's outcome read from its run's live phase.
 */
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase, ServiceTier } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { RoutineCommandController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/command_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { RoutineStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/status_pb";
import {
  RoutineFireOrigin,
  RoutineFireOutcome,
} from "@stigmer/apis/ai/stigmer/agentic/routine/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { writeLandsMidUpdate } from "../../../pipeline/__tests__/race-support.js";
import { releaseNamesOfDeleted } from "../../../pipeline/steps/names.js";
import { FIRE_DISABLED_MESSAGE } from "../fire.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let dir: string;
let server: ComposedServer;
let transport: Transport;
let command: Client<typeof RoutineCommandController>;
let query: Client<typeof RoutineQueryController>;
let agentCommand: Client<typeof AgentCommandController>;
// The ids the server minted for `acme` and `other-org`. Requests name
// them by slug, which the serving chain resolves; a stored reference and
// every copy that interpolates an organization carry the id.
let acmeId: string;
let otherOrgId: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "routine-domain-test-"));
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed — arming degrades and the trigger's launch
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
  const ids = await seedOrganizations(transport, ["acme", "other-org"]);
  acmeId = organizationId(ids, "acme");
  otherOrgId = organizationId(ids, "other-org");
  command = createClient(RoutineCommandController, transport);
  query = createClient(RoutineQueryController, transport);
  agentCommand = createClient(AgentCommandController, transport);

  for (const [name, slug] of [
    ["Helper", "helper"],
    ["Ephemeral", "ephemeral"],
    ["Ephemeral Two", "ephemeral-2"],
    ["Ephemeral Three", "ephemeral-3"],
    ["Ephemeral Four", "ephemeral-4"],
  ] as const) {
    await agentCommand.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name, org: "acme", slug },
      spec: { instructions: "a composed-test target agent" },
    });
  }
});

/** The id of the test agent with `slug` in acme. */
async function agentId(slug: string): Promise<string> {
  const agents = createClient(AgentQueryController, transport);
  const agent = await agents.getByReference({
    kind: ApiResourceKind.agent,
    org: "acme",
    slug,
  });
  return agent.metadata?.id ?? "";
}

/** Deletes a test agent through its API, cascade included, and answers the id it had. */
async function deleteAgent(slug: string): Promise<string> {
  const id = await agentId(slug);
  await agentCommand.delete({ value: id });
  return id;
}

/**
 * Removes a test agent's row and frees its name the way a delete does, but
 * runs no cascade: the dangling-reference setup, an agent gone while its
 * routines stayed (a store restored from a backup older than the routine).
 */
async function dropAgentRow(slug: string): Promise<string> {
  const id = await agentId(slug);
  await server.store.deleteResource(ApiResourceKind.agent, id);
  await releaseNamesOfDeleted(server.store, silentLogger, ApiResourceKind.agent, acmeId, id);
  return id;
}

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

function routineInput(overrides?: {
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
    kind: "Routine",
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
      agent: {
        agentRef: {
          kind: ApiResourceKind.agent,
          slug: overrides?.agentSlug ?? "helper",
          org: overrides?.agentOrg ?? "",
        },
        message: overrides?.message ?? "Do the rounds",
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
  it("creates with a derived slug and the rtn_ id prefix; arming degrades with Temporal away", async () => {
    const created = await command.create(routineInput({ name: "Morning Digest" }));
    expect(created.metadata?.id).toMatch(/^rtn_[0-9a-z]{26}$/);
    expect(created.metadata?.slug).toBe("morning-digest");
    // Temporal is a closed port: the arm degraded, next_fire_at absent —
    // the write still succeeded.
    expect(created.status?.nextFireAt).toBeUndefined();
    // The ref org normalized to the schedule's own.
    expect(
      created.spec?.agent?.agentRef?.org ?? "",
    ).toBe(acmeId);
  });

  it("requires metadata.org", async () => {
    const err = await refusal(() => command.create(routineInput({ org: "" })));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe("metadata.org is required for a routine");
  });

  it("refuses a cross-org agent ref BEFORE the agent load (no slug probing)", async () => {
    const err = await refusal(() =>
      command.create(routineInput({ name: "X", agentOrg: "other-org", agentSlug: "secret" })),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(
      `spec.agent.agent_ref.org must match metadata.org — a routine must live in the referenced agent's organization (${otherOrgId})`,
    );
  });

  it("refuses a nonexistent agent with the direct-lookup NOT_FOUND", async () => {
    const err = await refusal(() =>
      command.create(routineInput({ name: "Y", agentSlug: "vanished" })),
    );
    expect(err.code).toBe(Code.NotFound);
  });

  it("refuses a saved fast tier with no model of its own", async () => {
    const input = routineInput({ name: "Fast alone" });
    const err = await refusal(() =>
      command.create({
        ...input,
        spec: {
          ...input.spec,
          agent: { ...input.spec.agent, runConfig: { serviceTier: ServiceTier.FAST } },
        },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("spec.agent.run_config.model_name");
  });

  it("refuses a resource that is a local folder", async () => {
    const input = routineInput({ name: "Local tree" });
    const err = await refusal(() =>
      command.create({
        ...input,
        spec: {
          ...input.spec,
          agent: {
            ...input.spec.agent,
            resources: [
              { name: "repo", resource: { case: "gitRepository", value: { url: "https://github.com/acme/repo" } } },
              { name: "laptop", resource: { case: "localPath", value: { path: "/home/ana/src" } } },
            ],
          },
        },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain(
      "a routine's runs cannot use a folder on someone's machine: name a git repository or a File",
    );
  });

  it("refuses naming a File that does not exist", async () => {
    const input = routineInput({ name: "Unknown file" });
    const err = await refusal(() =>
      command.create({
        ...input,
        spec: {
          ...input.spec,
          agent: {
            ...input.spec.agent,
            resources: [{ resource: { case: "file", value: { fileId: "file_01nosuchfilenosuchfilenos" } } }],
          },
        },
      }),
    );
    expect(err.code).toBe(Code.NotFound);
  });

  it("refuses a Cursor routine that pins no model", async () => {
    const input = routineInput({ name: "Cursor unpinned" });
    const err = await refusal(() =>
      command.create({
        ...input,
        spec: { ...input.spec, agent: { ...input.spec.agent, harness: Harness.CURSOR } },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toMatch(
      /^spec\.agent\.run_config\.model_name must name a pinned model when the run would use the Cursor harness/,
    );
  });

  it("refuses a pinned model the registry does not know", async () => {
    const input = routineInput({ name: "Typo pin" });
    const err = await refusal(() =>
      command.create({
        ...input,
        spec: {
          ...input.spec,
          agent: { ...input.spec.agent, runConfig: { modelName: "no-such-model-anywhere" } },
        },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toMatch(
      /^spec\.agent\.run_config\.model_name: model 'no-such-model-anywhere' is not in the model registry \(native harness\)/,
    );
  });

  it("validates the cron grammar and time zone through the pipeline", async () => {
    expect(
      (await refusal(() => command.create(routineInput({ name: "Z", cron: "@every 5m" })))).code,
    ).toBe(Code.InvalidArgument);
    expect(
      (await refusal(() => command.create(routineInput({ name: "Z", timeZone: "Local" })))).code,
    ).toBe(Code.InvalidArgument);
  });
});

describe("apply — create-or-update with status preserved verbatim", () => {
  it("creates, then re-applies as update WITHOUT resetting runtime status", async () => {
    const applied = await command.apply(routineInput({ name: "Weekly Sync", slug: "weekly-sync" }));
    const id = applied.metadata?.id ?? "";

    // Simulate the clock's runtime writes through the wire-facing store:
    // pause the schedule as the streak would.
    const paused = await pauseDirectly(id);
    expect(paused.status?.pausedReason).not.toBe("");

    // A routine manifest re-apply must never clear the latch or streak.
    const reApplied = await command.apply(
      routineInput({ name: "Weekly Sync", slug: "weekly-sync", cron: "30 8 * * *" }),
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
async function pauseDirectly(id: string): Promise<Routine> {
  return server.store.updateResource(ApiResourceKind.routine, id, RoutineSchema, (live) => {
    if (live.status === undefined) {
      live.status = create(RoutineStatusSchema);
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
    const created = await command.create(routineInput({ name: "Repoint Me", slug: "repoint-me" }));
    const err = await refusal(() =>
      command.update({ resource: {
        ...routineInput({ name: "Repoint Me", slug: "repoint-me", agentSlug: "other" }),
        metadata: created.metadata,
      }, updateMask: { paths: ["*"] } }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(
      `spec.agent.agent_ref is immutable (routine runs ${acmeId}/helper) — create a new routine to run a different agent`,
    );
  });

  it("re-validates cron/tz on update (spec replaced wholesale)", async () => {
    const created = await command.create(routineInput({ name: "Revalidate", slug: "revalidate" }));
    const err = await refusal(() =>
      command.update({ resource: {
        ...routineInput({ name: "Revalidate", slug: "revalidate", cron: "bad" }),
        metadata: created.metadata,
      }, updateMask: { paths: ["*"] } }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("preserves concurrently-written status through the graft", async () => {
    const created = await command.create(routineInput({ name: "Graft", slug: "graft" }));
    const id = created.metadata?.id ?? "";
    await pauseDirectly(id);
    const updated = await command.update({ resource: {
      ...routineInput({ name: "Graft", slug: "graft", cron: "15 7 * * *" }),
      metadata: created.metadata,
    }, updateMask: { paths: ["*"] } });
    // The graft carried the request's spec but answered with the LIVE
    // status the runtime wrote mid-request.
    expect(updated.spec?.cron).toBe("15 7 * * *");
    expect(updated.status?.consecutiveFailures).toBe(2);
    expect(updated.status?.pausedReason).toContain("Paused after 2");
  });

  it("an update keeps a write that lands between its read and its write", async () => {
    const created = await command.create(routineInput({ name: "Race", slug: "race" }));
    const id = created.metadata?.id ?? "";
    expect(created.status?.pausedReason).toBe("");

    const { result: updated, writes } = await writeLandsMidUpdate(
      server.store,
      ApiResourceKind.routine,
      id,
      () => pauseDirectly(id),
      () =>
        command.update({ resource: {
          ...routineInput({ name: "Race", slug: "race", cron: "45 6 * * *" }),
          metadata: created.metadata,
        }, updateMask: { paths: ["*"] } }),
    );

    expect(writes).toBeGreaterThanOrEqual(2);
    for (const routine of [
      updated,
      await server.store.getResource(ApiResourceKind.routine, id, RoutineSchema),
    ]) {
      expect(routine.spec?.cron).toBe("45 6 * * *");
      expect(routine.status?.pausedReason).toContain("Paused after 2");
      expect(routine.status?.consecutiveFailures).toBe(2);
    }
  });
});

describe("resume — the one clearing path", () => {
  it("clears the latch AND the streak atomically and re-arms", async () => {
    const created = await command.create(routineInput({ name: "Resume Me", slug: "resume-me" }));
    const id = created.metadata?.id ?? "";
    await pauseDirectly(id);

    const resumed = await command.resume({ value: id });
    expect(resumed.status?.pausedReason).toBe("");
    expect(resumed.status?.consecutiveFailures).toBe(0);
  });

  it("is an idempotent no-op on a fresh row — no write, no audit bump", async () => {
    const created = await command.create(routineInput({ name: "Fresh", slug: "fresh" }));
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

describe("trigger — the two-level contract", () => {
  it("refuses a missing schedule with NOT_FOUND (level one)", async () => {
    const err = await refusal(() => command.fire({ id: "sch_missing" }));
    expect(err.code).toBe(Code.NotFound);
  });

  it("refuses a disabled schedule with FAILED_PRECONDITION and the byte-pinned copy", async () => {
    await command.create(routineInput({ name: "Disabled", slug: "disabled", enabled: false }));
    const row = await query.getByReference({
      kind: ApiResourceKind.routine,
      org: "acme",
      slug: "disabled",
    });
    const err = await refusal(() => command.fire({ id: row.metadata?.id ?? "" }));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(FIRE_DISABLED_MESSAGE);
  });

  it("relays an infrastructure failure as a CLEAN gRPC error (the engine gate's UNAVAILABLE, re-minted — never NGHTTP2 corruption)", async () => {
    const created = await command.create(routineInput({ name: "Fire Me", slug: "fire-me" }));
    const id = created.metadata?.id ?? "";

    // No engine behind this server: the create pipeline's engine gate
    // refuses Unavailable — an infrastructure failure, propagated as the
    // trigger's OWN error (Go: "Manual trigger's run start failed on
    // infrastructure"). The re-mint matters: echoing the in-process error
    // corrupts HTTP/2 trailers.
    const err = await refusal(() => command.fire({ id }));
    expect(err.code).toBe(Code.Unavailable);
    // No fire happened: no ledger row, no last_fire_at.
    const runs = await query.listFires({ routineId: id });
    expect(runs.entries).toHaveLength(0);
    const after = await query.get({ value: id });
    expect(after.status?.lastFireAt).toBeUndefined();
  });

  it("fires and honestly reports TARGET_MISSING (level two: gRPC success, outcome named)", async () => {
    const created = await command.create(
      routineInput({ name: "Orphan Fire", slug: "orphan-fire", agentSlug: "ephemeral" }),
    );
    const id = created.metadata?.id ?? "";
    const deletedId = await dropAgentRow("ephemeral");
    // Gone and remade: another agent takes the name. The routine holds
    // the gone agent's id, so its fire never runs the new one.
    await agentCommand.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "Ephemeral Remade", org: "acme", slug: "ephemeral" },
      spec: { instructions: "a stranger that took the name" },
    });

    // The fire happened (level two): the deterministic dangling-reference
    // outcome is a SUCCESSFUL fire honestly reported, never an exception.
    const result = await command.fire({ id });
    expect(result.outcome).toBe(RoutineFireOutcome.TARGET_MISSING);
    expect(result.refusalReason).toBe(`target agent ${acmeId}/${deletedId} not found`);
    expect(result.runId).toBe("");
    // The post-fire row: last_fire_at stamped by the handler.
    expect(result.routine?.status?.lastFireAt).toBeDefined();

    // The manual fire left its terminal ledger row.
    const runs = await query.listFires({ routineId: id });
    expect(runs.entries).toHaveLength(1);
    expect(runs.entries[0]?.origin).toBe(RoutineFireOrigin.MANUAL);
    expect(runs.entries[0]?.outcome).toBe(RoutineFireOutcome.TARGET_MISSING);
    expect(runs.entries[0]?.completedAt).toBeDefined();
  });

  it("a PAUSED schedule is triggerable (test-then-resume) and manual fires never feed the streak", async () => {
    const created = await command.create(
      routineInput({ name: "Paused Fire", slug: "paused-fire", agentSlug: "ephemeral-2" }),
    );
    const id = created.metadata?.id ?? "";
    await dropAgentRow("ephemeral-2");
    await pauseDirectly(id);

    // Past ValidateTriggerable (paused ≠ disabled), the fire runs and
    // reports its target-missing outcome.
    const result = await command.fire({ id });
    expect(result.outcome).toBe(RoutineFireOutcome.TARGET_MISSING);
    const after = await query.get({ value: id });
    // The streak is untouched by the manual fire's outcome.
    expect(after.status?.consecutiveFailures).toBe(2);
    expect(after.status?.pausedReason).toContain("Paused after 2");
  });
});

describe("queries — list, listByAgent, listFires", () => {
  it("list filters by org and labels (AND), newest first", async () => {
    await command.create(
      routineInput({ name: "Tagged A", slug: "tagged-a", labels: { team: "ops", tier: "1" } }),
    );
    await command.create(
      routineInput({ name: "Tagged B", slug: "tagged-b", labels: { team: "ops" } }),
    );
    const both = await query.list({ org: "acme", labels: { team: "ops" } });
    expect(both.entries.map((s) => s.metadata?.slug)).toContain("tagged-a");
    expect(both.entries.map((s) => s.metadata?.slug)).toContain("tagged-b");
    // Newest first: tagged-b was created after tagged-a.
    expect(both.entries.findIndex((s) => s.metadata?.slug === "tagged-b")).toBeLessThan(
      both.entries.findIndex((s) => s.metadata?.slug === "tagged-a"),
    );

    const one = await query.list({ org: "acme", labels: { team: "ops", tier: "1" } });
    expect(one.entries.map((s) => s.metadata?.slug)).toEqual(["tagged-a"]);

    const none = await query.list({ org: "other-org", labels: {} });
    expect(none.entries).toHaveLength(0);
  });

  it("listByAgent answers an empty list for an unknown agent id", async () => {
    const result = await query.listByAgent({ agentId: "agt_missing", org: "" });
    expect(result.entries).toHaveLength(0);
    expect(result.entries).toEqual([]);
  });

  it("listByAgent lists the schedules whose agent target holds the agent's id", async () => {
    const agents = createClient(AgentQueryController, transport);
    const helper = await agents.getByReference({
      kind: ApiResourceKind.agent,
      org: "acme",
      slug: "helper",
    });
    const result = await query.listByAgent({ agentId: helper.metadata?.id ?? "", org: "acme" });
    expect(result.entries.length).toBeGreaterThan(0);
    for (const item of result.entries) {
      expect(
        item.spec?.agent?.agentRef?.slug ?? "",
      ).toBe("helper");
    }
  });

  it("listFires answers NOT_FOUND for a missing schedule (never an empty history)", async () => {
    const err = await refusal(() => query.listFires({ routineId: "sch_missing" }));
    expect(err.code).toBe(Code.NotFound);
  });

  it("listFires pages newest-first by token (fire-identity rows via the ledger)", async () => {
    const created = await command.create(routineInput({ name: "Paged Runs", slug: "paged-runs" }));
    const id = created.metadata?.id ?? "";
    // Three fires with distinct nominal times, inserted through the store
    // (a trigger's nominal is "now", so real fires within one second would
    // upsert the same row — the ledger key IS the fire identity).
    for (const hour of ["09", "10", "11"]) {
      await server.store.upsertRoutineFire({
        routineId: id,
        fireId: `fire-${hour}`,
        org: "acme",
        nominalFireTime: `2026-08-25T${hour}:00:00Z`,
        origin: "schedule",
        outcome: "completed",
        reason: "",
        runId: "run_paged",
        recordedAt: `2026-08-25T${hour}:00:00Z`,
        completedAt: `2026-08-25T${hour}:30:00Z`,
      });
    }

    const pageOne = await query.listFires({ routineId: id, pageSize: 2 });
    expect(pageOne.entries).toHaveLength(2);
    expect(pageOne.nextPageToken).not.toBe("");
    // Newest first: 11:00 then 10:00.
    expect(pageOne.entries[0]?.nominalFireTime?.seconds).toBe(
      BigInt(Date.parse("2026-08-25T11:00:00Z") / 1000),
    );

    const pageTwo = await query.listFires({
      routineId: id,
      pageSize: 2,
      pageToken: pageOne.nextPageToken,
    });
    expect(pageTwo.entries).toHaveLength(1);
    expect(pageTwo.nextPageToken).toBe("");
    expect(pageTwo.entries[0]?.nominalFireTime?.seconds).toBe(
      BigInt(Date.parse("2026-08-25T09:00:00Z") / 1000),
    );

    // No size reads the default page, here every fire with no token.
    const defaulted = await query.listFires({ routineId: id });
    expect(defaulted.entries).toHaveLength(3);
    expect(defaulted.nextPageToken).toBe("");
  });
});

describe("listFires — an in-flight row reads its run's live phase", () => {
  it("resolves each started row from its run, and a row whose run is gone or silent stands as recorded", async () => {
    const created = await command.create(routineInput({ name: "Live Runs", slug: "live-runs" }));
    const id = created.metadata?.id ?? "";
    // Each fire's run, written as the run domain leaves it: a terminal
    // phase, still running, or a row with no status yet. aex_live_gone
    // names a run that was deleted.
    const phases: ReadonlyArray<readonly [string, RunPhase | undefined]> = [
      ["aex_live_done", RunPhase.RUN_COMPLETED],
      ["aex_live_failed", RunPhase.RUN_FAILED],
      ["aex_live_cancelled", RunPhase.RUN_CANCELLED],
      ["aex_live_terminated", RunPhase.RUN_TERMINATED],
      ["aex_live_running", RunPhase.RUN_IN_PROGRESS],
      ["aex_live_silent", undefined],
    ];
    for (const [runId, phase] of phases) {
      await server.store.saveResource(
        ApiResourceKind.run,
        runId,
        RunSchema,
        create(RunSchema, {
          metadata: { id: runId, org: acmeId },
          status: phase === undefined ? undefined : { phase },
        }),
      );
    }
    const runIds = [...phases.map(([runId]) => runId), "aex_live_gone"];
    for (const [index, runId] of runIds.entries()) {
      await server.store.upsertRoutineFire({
        routineId: id,
        fireId: `fire-${index}`,
        org: "acme",
        nominalFireTime: `2026-08-26T${String(10 + index).padStart(2, "0")}:00:00Z`,
        origin: "manual",
        outcome: "started",
        reason: "",
        runId,
        recordedAt: "",
        completedAt: "",
      });
    }

    const runs = await query.listFires({ routineId: id });
    const byRun = new Map(runs.entries.map((run) => [run.runId, run]));
    expect(byRun.size).toBe(runIds.length);
    expect(byRun.get("aex_live_done")).toMatchObject({
      outcome: RoutineFireOutcome.COMPLETED,
      reason: "",
    });
    for (const [runId, word] of [
      ["aex_live_failed", "failed"],
      ["aex_live_cancelled", "cancelled"],
      ["aex_live_terminated", "terminated"],
    ] as const) {
      expect(byRun.get(runId)).toMatchObject({
        outcome: RoutineFireOutcome.FAILED,
        reason: `run ${runId} ended ${word}`,
      });
    }
    for (const runId of ["aex_live_running", "aex_live_silent", "aex_live_gone"]) {
      expect(byRun.get(runId)).toMatchObject({
        outcome: RoutineFireOutcome.STARTED,
        reason: "",
      });
    }
  });
});

describe("delete — teardown posture and the ledger cascade", () => {
  it("returns the pre-delete resource and cascades the fire ledger", async () => {
    const created = await command.create(
      routineInput({ name: "Delete Me", slug: "delete-me", agentSlug: "ephemeral-3" }),
    );
    const id = created.metadata?.id ?? "";
    await dropAgentRow("ephemeral-3");
    await command.fire({ id }); // leaves a manual TARGET_MISSING row

    const deleted = await command.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    const err = await refusal(() => query.get({ value: id }));
    expect(err.code).toBe(Code.NotFound);
    // The ledger cascade ran (listFires on the deleted schedule is NOT_FOUND,
    // so assert through the store).
    const total = (await server.store.listRoutineFires(id, undefined, 10)).length;
    expect(total).toBe(0);
  });

  it("goes with its agent: deleting the agent deletes the routine and its fire history", async () => {
    const created = await command.create(
      routineInput({ name: "Goes With Agent", slug: "goes-with-agent", agentSlug: "ephemeral-4" }),
    );
    const id = created.metadata?.id ?? "";
    await server.store.upsertRoutineFire({
      routineId: id,
      fireId: `${id}-fire`,
      org: acmeId,
      nominalFireTime: "2026-10-17T09:00:00Z",
      origin: "schedule",
      outcome: "completed",
      reason: "",
      runId: "",
      recordedAt: "2026-10-17T09:00:01Z",
      completedAt: "2026-10-17T09:00:05Z",
    });
    await deleteAgent("ephemeral-4");

    const err = await refusal(() => query.get({ value: id }));
    expect(err.code).toBe(Code.NotFound);
    expect((await server.store.listRoutineFires(id, undefined, 10)).length).toBe(0);
  });
});

// Round-trip guard: the wire schedule marshals/unmarshals through the
// binary codec the store uses (catches schema drift in the test itself).
it("schedule wire shape round-trips through the binary codec", async () => {
  const created = await command.create(routineInput({ name: "Round Trip", slug: "round-trip" }));
  const bytes = toBinary(RoutineSchema, created);
  expect(fromBinary(RoutineSchema, bytes).metadata?.slug).toBe("round-trip");
});
