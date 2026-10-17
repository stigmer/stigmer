/**
 * Pins the two guards that keep a routine from outliving its agent
 * (cascade.ts), step by step over a real SQLite store and a recording
 * clock:
 *   - CascadeDeleteRoutines removes every routine of the agent in its own
 *     organization, scheduled or not: the row, its names, its Temporal
 *     artifact (through the clock, best-effort) and its fire ledger; a
 *     routine of another agent, or of another organization naming the
 *     agent, is left; a teardown that fails is logged and the delete goes
 *     on; with no clock wired nothing is torn down and the rows still go;
 *   - a chain that never loaded the agent is a broken invariant and throws;
 *   - EnsureRoutineAgentStillExists, after a create, reads the agent again:
 *     present, the routine stays; deleted meanwhile, the routine, its
 *     artifact and its ledger go and the create answers NOT_FOUND naming
 *     the agent by id.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { RoutineSchema } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import type { Routine } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newCascadeDeleteRoutinesStep, newEnsureRoutineAgentStillExistsStep } from "../cascade.js";
import type { RoutineClock } from "../clock.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let temp: TempStore | undefined;

afterEach(async () => {
  await temp?.cleanup();
  temp = undefined;
});

function recordingClock(failTeardown = false): RoutineClock & { readonly toreDown: string[] } {
  const toreDown: string[] = [];
  return {
    toreDown,
    ensureAndRecord: () => Promise.resolve(undefined),
    teardown: (id) => {
      toreDown.push(id);
      return failTeardown ? Promise.reject(new Error("engine away")) : Promise.resolve();
    },
  };
}

async function seedAgent(store: Store, id: string, org: string): Promise<void> {
  await namingSaves(store).saveResource(
    ApiResourceKind.agent,
    id,
    AgentSchema,
    create(AgentSchema, { metadata: { id, org, slug: id.replaceAll("_", "-"), name: id } }),
  );
}

function routine(id: string, org: string, agentId: string, cron?: string): Routine {
  return create(RoutineSchema, {
    metadata: { id, org, slug: id.replaceAll("_", "-"), name: id },
    spec: {
      cron,
      timeZone: "UTC",
      enabled: true,
      agent: { agentRef: { kind: ApiResourceKind.agent, org, id: agentId }, message: "Go." },
    },
  });
}

async function seedRoutine(store: Store, row: Routine): Promise<void> {
  const id = row.metadata!.id;
  await namingSaves(store).saveResource(ApiResourceKind.routine, id, RoutineSchema, row);
  await store.upsertRoutineFire({
    routineId: id,
    fireId: `${id}-fire`,
    org: row.metadata!.org,
    nominalFireTime: "2026-08-20T00:00:00Z",
    origin: "schedule",
    outcome: "completed",
    reason: "",
    runId: "",
    recordedAt: "2026-08-20T00:00:01Z",
    completedAt: "2026-08-20T00:00:05Z",
  });
}

async function exists(store: Store, id: string): Promise<boolean> {
  return store.getResource(ApiResourceKind.routine, id, RoutineSchema).then(
    () => true,
    (error: unknown) => {
      if (error instanceof ResourceNotFoundError) {
        return false;
      }
      throw error;
    },
  );
}

function deleteContext(agentId: string, org: string) {
  const ctx = new RequestContext(
    AgentCommandController.method.delete.input,
    create(AgentCommandController.method.delete.input, { value: agentId }),
    testCallerIdentity(),
    ApiResourceKind.agent,
  );
  ctx.set(EXISTING_RESOURCE_KEY, create(AgentSchema, { metadata: { id: agentId, org, slug: "helper" } }));
  return ctx;
}

describe("CascadeDeleteRoutines", () => {
  it("removes the agent's routines in its organization with their artifacts and fire history, and leaves the rest", async () => {
    temp = tempStore();
    const store = temp.store;
    await seedRoutine(store, routine("rtn_scheduled", "org_acme", "agt_1", "0 9 * * *"));
    await seedRoutine(store, routine("rtn_on_demand", "org_acme", "agt_1"));
    await seedRoutine(store, routine("rtn_other_agent", "org_acme", "agt_2", "0 9 * * *"));
    await seedRoutine(store, routine("rtn_other_org", "org_globex", "agt_1", "0 9 * * *"));
    const clock = recordingClock();

    await newCascadeDeleteRoutinesStep({ store, logger: silentLogger, authorizationLifecycle: undefined, clock: () => clock }).execute(
      deleteContext("agt_1", "org_acme"),
    );

    expect(await exists(store, "rtn_scheduled")).toBe(false);
    expect(await exists(store, "rtn_on_demand")).toBe(false);
    expect(clock.toreDown.sort()).toEqual(["rtn_on_demand", "rtn_scheduled"]);
    expect(await store.listRoutineFires("rtn_scheduled", undefined, 10)).toEqual([]);
    expect(await exists(store, "rtn_other_agent")).toBe(true);
    expect(await exists(store, "rtn_other_org")).toBe(true);
  });

  it("goes on when a teardown fails, and removes the rows when no clock is wired", async () => {
    temp = tempStore();
    const store = temp.store;
    await seedRoutine(store, routine("rtn_a", "org_acme", "agt_1", "0 9 * * *"));
    const failing = recordingClock(true);
    await newCascadeDeleteRoutinesStep({ store, logger: silentLogger, authorizationLifecycle: undefined, clock: () => failing }).execute(
      deleteContext("agt_1", "org_acme"),
    );
    expect(await exists(store, "rtn_a")).toBe(false);

    await seedRoutine(store, routine("rtn_b", "org_acme", "agt_1", "0 9 * * *"));
    await newCascadeDeleteRoutinesStep({ store, logger: silentLogger, authorizationLifecycle: undefined, clock: () => undefined }).execute(
      deleteContext("agt_1", "org_acme"),
    );
    expect(await exists(store, "rtn_b")).toBe(false);
  });

  it("throws when the chain never loaded the agent", async () => {
    temp = tempStore();
    const ctx = new RequestContext(
      AgentCommandController.method.delete.input,
      create(AgentCommandController.method.delete.input, { value: "agt_1" }),
      testCallerIdentity(),
      ApiResourceKind.agent,
    );
    await expect(
      newCascadeDeleteRoutinesStep({ store: temp.store, logger: silentLogger, authorizationLifecycle: undefined, clock: () => undefined }).execute(ctx),
    ).rejects.toThrow(/LoadExistingForDelete must run first/);
  });
});

describe("EnsureRoutineAgentStillExists", () => {
  function createContext(row: Routine) {
    return new RequestContext(RoutineSchema, row, testCallerIdentity(), ApiResourceKind.routine);
  }

  it("keeps a routine whose agent is still there", async () => {
    temp = tempStore();
    const store = temp.store;
    await seedAgent(store, "agt_1", "org_acme");
    const row = routine("rtn_kept", "org_acme", "agt_1", "0 9 * * *");
    await seedRoutine(store, row);
    const clock = recordingClock();
    await newEnsureRoutineAgentStillExistsStep({ store, logger: silentLogger, authorizationLifecycle: undefined, clock: () => clock }).execute(
      createContext(row),
    );
    expect(await exists(store, "rtn_kept")).toBe(true);
    expect(clock.toreDown).toEqual([]);
  });

  it("removes a routine whose agent was deleted while it was created, and answers NOT_FOUND naming the agent", async () => {
    temp = tempStore();
    const store = temp.store;
    const row = routine("rtn_orphan", "org_acme", "agt_gone", "0 9 * * *");
    await seedRoutine(store, row);
    const clock = recordingClock();
    let failure: unknown;
    try {
      await newEnsureRoutineAgentStillExistsStep({ store, logger: silentLogger, authorizationLifecycle: undefined, clock: () => clock }).execute(
        createContext(row),
      );
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.NotFound);
    expect((failure as ConnectError).rawMessage).toContain("agt_gone");
    expect(await exists(store, "rtn_orphan")).toBe(false);
    expect(clock.toreDown).toEqual(["rtn_orphan"]);
    expect(await store.listRoutineFires("rtn_orphan", undefined, 10)).toEqual([]);
  });
});
