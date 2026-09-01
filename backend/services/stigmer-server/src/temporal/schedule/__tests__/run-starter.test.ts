/**
 * Pins the RunStarter against Go's runstarter_test.go: the deterministic
 * execution name (THE idempotency key, byte-pinned on both editions), the
 * fire-context message rendering (the model's only "today"), the
 * owner-vs-platform clamps, the find-before-create idempotency, the
 * refusal-code partition, and the execution-request shape.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalMode,
  ServiceTier,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { ScheduleTemporalConfig } from "../config.js";
import {
  RunStarter,
  SCHEDULE_ID_LABEL_KEY,
  SESSION_SUBJECT_PREFIX,
  clampedRunBound,
  composeMessage,
  scheduledExecutionName,
} from "../run-starter.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const NOMINAL = new Date("2026-08-25T09:30:00Z");

describe("scheduledExecutionName — THE idempotency key (byte-pinned)", () => {
  it("lowercases the id, maps underscores to hyphens, appends the 20060102t150405z time", () => {
    expect(scheduledExecutionName("SCH_01ABC", NOMINAL)).toBe(
      "sch-01abc-20260825t093000z",
    );
  });

  it("truncates the nominal time to whole seconds", () => {
    expect(scheduledExecutionName("sch_x", new Date("2026-08-25T09:30:00.999Z"))).toBe(
      "sch-x-20260825t093000z",
    );
  });

  it("every character is slug-shaped (the name IS the execution's slug)", () => {
    expect(scheduledExecutionName("sch_01ABC", NOMINAL)).toMatch(/^[a-z0-9-]+$/);
  });
});

function scheduleWith(overrides?: {
  message?: string;
  timeZone?: string;
  harness?: Harness;
  modelName?: string;
  maxToolRounds?: number;
  maxCostUsd?: number;
  serviceTier?: ServiceTier;
  agentSlug?: string;
  slug?: string;
}): Schedule {
  return create(ScheduleSchema, {
    metadata: { id: "sch_01test", org: "acme", slug: overrides?.slug ?? "daily" },
    spec: {
      cron: "0 9 * * *",
      timeZone: overrides?.timeZone ?? "Asia/Kolkata",
      enabled: true,
      target: {
        case: "agent",
        value: {
          agentRef: { slug: overrides?.agentSlug ?? "helper" },
          message: overrides?.message ?? "Do the morning rounds",
          harness: overrides?.harness ?? Harness.UNSPECIFIED,
          runConfig: {
            modelName: overrides?.modelName ?? "",
            maxToolRounds: overrides?.maxToolRounds ?? 0,
            maxCostUsd: overrides?.maxCostUsd ?? 0,
            serviceTier: overrides?.serviceTier ?? ServiceTier.UNSPECIFIED,
          },
        },
      },
    },
  });
}

describe("composeMessage — the fire-context line (byte contract)", () => {
  it("renders 'Monday, 2006-01-02 15:04' in the schedule's zone with the zone-name echo", () => {
    // 2026-08-25T09:30:00Z is 15:00 IST on Tuesday 2026-08-25.
    expect(composeMessage(scheduleWith(), NOMINAL)).toBe(
      "Do the morning rounds\n\n(Scheduled fire time: Tuesday, 2026-08-25 15:00 (Asia/Kolkata))",
    );
  });

  it("an empty zone renders in UTC and echoes 'UTC' (Go LoadLocation(''))", () => {
    expect(composeMessage(scheduleWith({ timeZone: "" }), NOMINAL)).toBe(
      "Do the morning rounds\n\n(Scheduled fire time: Tuesday, 2026-08-25 09:30 (UTC))",
    );
  });

  it("an unloadable zone degrades to UTC (a slightly wrong-timezone reminder beats a dead fire)", () => {
    expect(composeMessage(scheduleWith({ timeZone: "Mars/Olympus" }), NOMINAL)).toBe(
      "Do the morning rounds\n\n(Scheduled fire time: Tuesday, 2026-08-25 09:30 (UTC))",
    );
  });

  it("uses h23 hours (Go's 15 layout: 00-23, never 24)", () => {
    const midnight = new Date("2026-08-25T00:05:00Z");
    expect(composeMessage(scheduleWith({ timeZone: "UTC" }), midnight)).toContain(
      "Tuesday, 2026-08-25 00:05 (UTC)",
    );
  });
});

describe("clampedRunBound — min(owner, platform), zero = unset", () => {
  it.each([
    [0, 20, 20], // owner unset → platform
    [5, 20, 5], // both set → lower wins
    [50, 20, 20], // owner cannot raise past the platform
    [5, 0, 5], // platform unset → owner stands
    [0, 0, 0], // both unset
    [-1, 20, 20], // negative reads as unset
  ])("owner=%d platform=%d → %d", (owner, platform, want) => {
    expect(clampedRunBound(owner, platform)).toBe(want);
  });
});

describe("RunStarter.startRun — against a real store", () => {
  let dir: string;
  let store: SqliteStore;

  const config = new ScheduleTemporalConfig(
    "schedule_stigmer",
    60,
    24,
    5,
    60,
    true,
    5,
    20,
    1.0,
    90,
  );

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "run-starter-test-"));
    store = SqliteStore.open(path.join(dir, "test.db"));
    await store.saveResource(
      ApiResourceKind.agent,
      "agt_01helper",
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_01helper", org: "acme", slug: "helper" },
      }),
    );
    await store.saveResource(
      ApiResourceKind.schedule,
      "sch_01test",
      ScheduleSchema,
      scheduleWith(),
    );
  });

  afterAll(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function starter(create_: (execution: AgentExecution) => Promise<AgentExecution>) {
    return new RunStarter({
      store,
      config,
      executions: { create: create_ },
      logger: silentLogger,
    });
  }

  it("shapes the execution request: name, org, label, UNATTENDED, subject prefix, fire-context message", async () => {
    let seen: AgentExecution | undefined;
    const runStarter = starter(async (execution) => {
      seen = execution;
      return create(AgentExecutionSchema, {
        metadata: { id: "aex_01new", org: "acme" },
      });
    });

    const outcome = await runStarter.startRun(scheduleWith(), NOMINAL);
    expect(outcome).toEqual({
      kind: "started",
      executionId: "aex_01new",
      alreadyExisted: false,
    });

    expect(seen?.apiVersion).toBe("agentic.stigmer.ai/v1");
    expect(seen?.kind).toBe("AgentExecution");
    expect(seen?.metadata?.name).toBe("sch-01test-20260825t093000z");
    expect(seen?.metadata?.org).toBe("acme");
    expect(seen?.metadata?.labels[SCHEDULE_ID_LABEL_KEY]).toBe("sch_01test");
    expect(seen?.spec?.agentId).toBe("agt_01helper");
    expect(seen?.spec?.message).toContain("(Scheduled fire time: ");
    expect(seen?.spec?.sessionSpec?.subject).toBe(`${SESSION_SUBJECT_PREFIX}daily`);
    expect(seen?.spec?.executionConfig?.approvalMode).toBe(ApprovalMode.UNATTENDED);
    // Platform profile applies when the owner set nothing.
    expect(seen?.spec?.executionConfig?.maxToolRounds).toBe(20);
    expect(seen?.spec?.executionConfig?.maxCostUsd).toBe(1.0);
    // Unset tier/model stay unset (never stamped).
    expect(seen?.spec?.executionConfig?.modelName).toBe("");
    expect(seen?.spec?.executionConfig?.serviceTier).toBe(ServiceTier.UNSPECIFIED);

    // Success stamped last_execution_id on the row.
    const row = await store.getResource(
      ApiResourceKind.schedule,
      "sch_01test",
      ScheduleSchema,
    );
    expect(row.status?.lastExecutionId).toBe("aex_01new");
  });

  it("finds an existing execution by the deterministic name instead of creating (idempotent retry)", async () => {
    await store.saveResource(
      ApiResourceKind.agent_execution,
      "aex_01prior",
      AgentExecutionSchema,
      create(AgentExecutionSchema, {
        metadata: {
          id: "aex_01prior",
          org: "acme",
          slug: scheduledExecutionName("sch_01test", NOMINAL),
        },
      }),
    );
    const runStarter = starter(async () => {
      throw new Error("create must not be called on the idempotent path");
    });
    const outcome = await runStarter.startRun(scheduleWith(), NOMINAL);
    expect(outcome).toEqual({
      kind: "started",
      executionId: "aex_01prior",
      alreadyExisted: true,
    });
    await store.deleteResource(ApiResourceKind.agent_execution, "aex_01prior");
  });

  // The scheduleFireCaller seam (stigmer-cloud#572): composed → every
  // create carries the per-fire minted caller; absent → the create
  // carries none (the internal lane, byte-identical); mint failure → an
  // infrastructure throw the tick retries; the idempotent path never
  // mints (a found winner needs no credential).
  describe("fire-caller mint (stigmer-cloud#572)", () => {
    const mintedCaller = {
      identityId: "ida_schedule_acct",
      callerClass: "schedule",
      issuer: "stigmer",
      rawToken: "minted.jwt",
    };

    it("propagates the minted caller to the create, minting per (org, scheduleId)", async () => {
      const mintCalls: Array<{ org: string; scheduleId: string }> = [];
      let seenCaller: unknown = "unset";
      const runStarter = new RunStarter({
        store,
        config,
        executions: {
          create: async (_execution, fireCaller) => {
            seenCaller = fireCaller;
            return create(AgentExecutionSchema, {
              metadata: { id: "aex_01minted", org: "acme" },
            });
          },
        },
        fireCallerMint: {
          mintFireCaller: async (org, scheduleId) => {
            mintCalls.push({ org, scheduleId });
            return mintedCaller;
          },
        },
        logger: silentLogger,
      });

      const outcome = await runStarter.startRun(scheduleWith(), NOMINAL);
      expect(outcome).toEqual({
        kind: "started",
        executionId: "aex_01minted",
        alreadyExisted: false,
      });
      expect(mintCalls).toEqual([{ org: "acme", scheduleId: "sch_01test" }]);
      expect(seenCaller).toBe(mintedCaller);
    });

    it("passes no caller when no mint is composed (the OSS internal lane)", async () => {
      let seenCaller: unknown = "unset";
      const runStarter = new RunStarter({
        store,
        config,
        executions: {
          create: async (_execution, fireCaller) => {
            seenCaller = fireCaller;
            return create(AgentExecutionSchema, {
              metadata: { id: "aex_01plain", org: "acme" },
            });
          },
        },
        logger: silentLogger,
      });
      const outcome = await runStarter.startRun(scheduleWith(), NOMINAL);
      expect(outcome.kind).toBe("started");
      expect(seenCaller).toBeUndefined();
    });

    it("throws (retryable) when the mint fails — never a silent internal fallback", async () => {
      const runStarter = new RunStarter({
        store,
        config,
        executions: {
          create: async () => {
            throw new Error("create must not run when the mint failed");
          },
        },
        fireCallerMint: {
          mintFireCaller: async () => {
            throw new Error("account provisioning unavailable");
          },
        },
        logger: silentLogger,
      });
      await expect(runStarter.startRun(scheduleWith(), NOMINAL)).rejects.toThrow(
        /mint schedule fire caller for sch_01test: account provisioning unavailable/,
      );
    });

    it("never mints on the idempotent path (the winner needs no credential)", async () => {
      await store.saveResource(
        ApiResourceKind.agent_execution,
        "aex_01winner",
        AgentExecutionSchema,
        create(AgentExecutionSchema, {
          metadata: {
            id: "aex_01winner",
            org: "acme",
            slug: scheduledExecutionName("sch_01test", NOMINAL),
          },
        }),
      );
      const runStarter = new RunStarter({
        store,
        config,
        executions: {
          create: async () => {
            throw new Error("create must not run on the idempotent path");
          },
        },
        fireCallerMint: {
          mintFireCaller: async () => {
            throw new Error("mint must not run on the idempotent path");
          },
        },
        logger: silentLogger,
      });
      const outcome = await runStarter.startRun(scheduleWith(), NOMINAL);
      expect(outcome).toEqual({
        kind: "started",
        executionId: "aex_01winner",
        alreadyExisted: true,
      });
      await store.deleteResource(ApiResourceKind.agent_execution, "aex_01winner");
    });
  });

  it("answers targetMissing with the byte-pinned copy when the agent is gone", async () => {
    const runStarter = starter(async () => {
      throw new Error("unreachable");
    });
    const outcome = await runStarter.startRun(
      scheduleWith({ agentSlug: "vanished" }),
      NOMINAL,
    );
    expect(outcome).toEqual({
      kind: "targetMissing",
      reason: "target agent acme/vanished not found",
    });
  });

  it("refuses via the model-pinning launch backstop for a pre-rule cursor row", async () => {
    const runStarter = starter(async () => {
      throw new Error("unreachable");
    });
    const outcome = await runStarter.startRun(
      scheduleWith({ harness: Harness.CURSOR, modelName: "" }),
      NOMINAL,
    );
    expect(outcome.kind).toBe("refused");
    if (outcome.kind === "refused") {
      expect(outcome.reason).toContain("stigmer/stigmer#362");
    }
  });

  it.each([
    Code.FailedPrecondition,
    Code.PermissionDenied,
    Code.NotFound,
    Code.InvalidArgument,
    Code.ResourceExhausted,
  ])("maps the launch-gate code %s to a refused outcome (the streak counts it)", async (code) => {
    const runStarter = starter(async () => {
      throw new ConnectError("gate refused this run", code);
    });
    const outcome = await runStarter.startRun(scheduleWith(), NOMINAL);
    expect(outcome).toEqual({ kind: "refused", reason: "gate refused this run" });
  });

  it("rethrows infrastructure codes so the activity retries", async () => {
    const runStarter = starter(async () => {
      throw new ConnectError("store exploded", Code.Internal);
    });
    await expect(runStarter.startRun(scheduleWith(), NOMINAL)).rejects.toThrow(
      "store exploded",
    );
  });

  it("re-finds the winner on AlreadyExists from the session duplicate check", async () => {
    // The pre-check misses (no row yet); create refuses AlreadyExists and
    // the winner row lands concurrently (the session auto-create race the
    // Go comment describes) — the starter must re-read the winner.
    const raceNominal = new Date("2026-08-26T09:30:00Z");
    let calls = 0;
    const runStarter = starter(async () => {
      calls++;
      await store.saveResource(
        ApiResourceKind.agent_execution,
        "aex_01winner",
        AgentExecutionSchema,
        create(AgentExecutionSchema, {
          metadata: {
            id: "aex_01winner",
            org: "acme",
            slug: scheduledExecutionName("sch_01test", raceNominal),
          },
        }),
      );
      throw new ConnectError("duplicate", Code.AlreadyExists);
    });
    const outcome = await runStarter.startRun(scheduleWith(), raceNominal);
    expect(calls).toBe(1);
    expect(outcome).toEqual({
      kind: "started",
      executionId: "aex_01winner",
      alreadyExisted: true,
    });
    await store.deleteResource(ApiResourceKind.agent_execution, "aex_01winner");
  });

  it("clamps owner run bounds by the platform profile and stamps owner-set tier/model", async () => {
    let seen: AgentExecution | undefined;
    const runStarter = starter(async (execution) => {
      seen = execution;
      return create(AgentExecutionSchema, { metadata: { id: "aex_01x", org: "acme" } });
    });
    await runStarter.startRun(
      scheduleWith({
        maxToolRounds: 50, // above the platform 20 → clamped
        maxCostUsd: 0.25, // below the platform 1.00 → stands
        modelName: " gpt-x ",
        serviceTier: ServiceTier.FAST,
      }),
      new Date("2026-08-27T09:30:00Z"),
    );
    expect(seen?.spec?.executionConfig?.maxToolRounds).toBe(20);
    expect(seen?.spec?.executionConfig?.maxCostUsd).toBe(0.25);
    expect(seen?.spec?.executionConfig?.modelName).toBe("gpt-x");
    expect(seen?.spec?.executionConfig?.serviceTier).toBe(ServiceTier.FAST);
  });
});
