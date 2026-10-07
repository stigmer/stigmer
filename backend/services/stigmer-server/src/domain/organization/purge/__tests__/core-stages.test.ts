/**
 * Pins the core's purge stages (../core-stages.ts) over a real SQLite
 * store opened with the server's list indexes, engines and a sandbox
 * provisioner that record what they are asked.
 *
 * What it pins:
 *   - quiesce: the schedule purge runs first and its `more` ends the call;
 *     an organization with no run that may still be live passes with no
 *     engine; a run that may still be live is terminated, a run the engine
 *     no longer holds is fine, and with the engine unreachable the stage
 *     faults; every session's sandbox is torn down; the
 *     side-store records of the organization go and another's stay;
 *   - content: kind purges in order, one batch of the first with rows left;
 *   - children: waits while a child row names the organization, deleting
 *     with it a child no delete marked and leaving a pending child's
 *     delete to it;
 *   - quiesce reads every page of runs, and any engine fault other than
 *     a run the engine no longer holds fails the stage;
 *   - final: its sweeps (quiesce, the units' stages and content again) to
 *     their end first, and a sweep that waits leaves it to a later pass
 *     with nothing final done; then the policy rows, the lifecycle's organization event, the row,
 *     its slug and its mark go, in that order relative to the mark; a
 *     row already gone still ends with the slug and the mark released; a
 *     row that cannot be read fails the stage.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { LIST_INDEXES } from "../../../../boot/list-indexes.js";
import { silentLogger } from "../../../../extensions/__tests__/composed-support.js";
import type { OrganizationPurgeContext } from "../../../../extensions/organization-purge.js";
import type { ResourceDeletedEvent } from "../../../../extensions/resource-authorization.js";
import { serverActingFor } from "../../../../pipeline/interceptors/auth.js";
import type { SandboxLane } from "../../../../sandbox/lane.js";
import type { SandboxProvisioner } from "../../../../sandbox/provisioner.js";
import { SqliteStore } from "../../../../store/sqlite/store.js";
import type { ConnectedExecutionEngine } from "../../../agentrun/engine.js";
import {
  ENGINE_DISCONNECTED,
  EngineWorkflowNotFoundError,
} from "../../../agentrun/engine.js";
import type { IamPolicyGrantPath } from "../../../iampolicy/grant-path.js";
import { ORGANIZATION_NAME_KIND } from "../../names.js";
import {
  ENGINE_UNREACHABLE_FOR_PURGE,
  newChildrenStage,
  newContentStage,
  newFinalStage,
  newQuiesceStage,
} from "../core-stages.js";
import type { KindPurge } from "../kind-purge.js";

const ORG = "org_01kpurgepurgepurgepurgepurg";
const OTHER = "org_01kotherotherotherotherothe";

let dir: string;
let store: SqliteStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "purge-stages-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: LIST_INDEXES,
  });
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

const context: OrganizationPurgeContext = {
  org: { id: ORG, parentOrg: "" },
  logger: silentLogger,
  caller: serverActingFor("organization-purge"),
  rows: { ids: () => Promise.reject(new Error("no core stage reads rows")) },
};

function kindPurge(
  kind: ApiResourceKind,
  calls: string[],
  more: boolean[] = [],
): KindPurge {
  return {
    kind,
    async purge() {
      calls.push(ApiResourceKind[kind]);
      return { more: more.shift() ?? false };
    },
    async holdsAny() {
      return false;
    },
  };
}

async function saveExecution(id: string, org: string, phase: RunPhase) {
  await store.saveResource(
    ApiResourceKind.agent_run,
    id,
    AgentRunSchema,
    create(AgentRunSchema, {
      metadata: { id, org, name: id },
      status: { phase },
    }),
  );
}

function recordingEngine(terminated: string[], missing: ReadonlySet<string> = new Set()) {
  return () => ({
    connected: true as const,
    engine: {
      async terminateWorkflow(id: string) {
        if (missing.has(id)) {
          throw new EngineWorkflowNotFoundError(id);
        }
        terminated.push(id);
      },
    } as unknown as ConnectedExecutionEngine,
  });
}

const noSandboxes: SandboxLane = { enabled: false };

describe("the quiesce stage", () => {
  it("passes with no engine when nothing may still be running, and ends a call while schedules are left", async () => {
    await saveExecution("aex_done", ORG, RunPhase.RUN_COMPLETED);
    const calls: string[] = [];
    const stage = newQuiesceStage({
      store,
      logger: silentLogger,
      schedulePurge: kindPurge(ApiResourceKind.schedule, calls, [true, false]),
      agentEngine: () => ENGINE_DISCONNECTED,
      sandboxLane: noSandboxes,
    });
    expect(await stage.run(context)).toEqual({ more: true });
    expect(await stage.run(context)).toEqual({ more: false });
    expect(calls).toEqual(["schedule", "schedule"]);
  });

  it("terminates a run that may still be live, tolerates one the engine no longer holds, and faults with the engine unreachable", async () => {
    await saveExecution("aex_live", ORG, RunPhase.RUN_IN_PROGRESS);
    await saveExecution("aex_gone", ORG, RunPhase.RUN_PENDING);
    await saveExecution("aex_other", OTHER, RunPhase.RUN_IN_PROGRESS);
    const terminated: string[] = [];
    const deps = {
      store,
      logger: silentLogger,
      schedulePurge: kindPurge(ApiResourceKind.schedule, []),
      sandboxLane: noSandboxes,
    };
    await newQuiesceStage({
      ...deps,
      agentEngine: recordingEngine(terminated, new Set(["aex_gone"])),
    }).run(context);
    expect(terminated).toEqual(["aex_live"]);
    await expect(
      newQuiesceStage({ ...deps, agentEngine: () => ENGINE_DISCONNECTED }).run(
        context,
      ),
    ).rejects.toThrow(ENGINE_UNREACHABLE_FOR_PURGE);
  });

  it("tears down every session's sandbox and removes the organization's side-store records", async () => {
    await store.saveResource(
      ApiResourceKind.session,
      "ses_1",
      SessionSchema,
      create(SessionSchema, { metadata: { id: "ses_1", org: ORG, name: "s" } }),
    );
    for (const org of [ORG, OTHER]) {
      await store.pendingOAuthStates.save({
        state: `state-${org}`,
        codeVerifier: "verifier",
        clientId: "client",
        clientSecret: "",
        tokenEndpoint: "https://issuer.example.com/token",
        mcpServerId: "mcps_1",
        identityAccountId: "ida_1",
        targetEnvVar: "TOKEN",
        authMethod: "mcp_oauth",
        tokenAuthMethod: "",
        redirectUri: "https://console.example.com/callback",
        org,
        createdAt: 0,
      });
    }
    const torn: string[] = [];
    const provisioner = {
      async deprovisionSessionSandbox(id: string) {
        torn.push(id);
      },
    } as unknown as SandboxProvisioner;
    await newQuiesceStage({
      store,
      logger: silentLogger,
      schedulePurge: kindPurge(ApiResourceKind.schedule, []),
      agentEngine: () => ENGINE_DISCONNECTED,
      sandboxLane: {
        enabled: true,
        provisioner,
        credentials: {} as never,
      },
    }).run(context);
    expect(torn).toEqual(["ses_1"]);
    expect(await store.pendingOAuthStates.deleteByOrg(ORG)).toBe(0);
    expect(await store.pendingOAuthStates.deleteByOrg(OTHER)).toBe(1);
  });
});

describe("the quiesce stage's other runs", () => {
  const base = () => ({
    store,
    logger: silentLogger,
    schedulePurge: kindPurge(ApiResourceKind.schedule, []),
    agentEngine: () => ENGINE_DISCONNECTED,
    sandboxLane: noSandboxes,
  });

  it("reads every page of the organization's runs", async () => {
    for (let i = 0; i < 201; i++) {
      await saveExecution(`aex_${String(i).padStart(3, "0")}`, ORG, RunPhase.RUN_COMPLETED);
    }
    const terminated: string[] = [];
    await saveExecution("aex_zlive", ORG, RunPhase.RUN_IN_PROGRESS);
    await newQuiesceStage({
      ...base(),
      agentEngine: recordingEngine(terminated),
    }).run(context);
    expect(terminated).toEqual(["aex_zlive"]);
  });

  it("fails the stage on an agent engine fault that is not a missing workflow", async () => {
    await saveExecution("aex_live", ORG, RunPhase.RUN_IN_PROGRESS);
    await expect(
      newQuiesceStage({
        ...base(),
        agentEngine: () => ({
          connected: true as const,
          engine: {
            terminateWorkflow: () => Promise.reject(new Error("engine refused")),
          } as unknown as ConnectedExecutionEngine,
        }),
      }).run(context),
    ).rejects.toThrow("engine refused");
  });
});

describe("the content stage", () => {
  it("runs the kind purges in order, one batch of the first with rows left", async () => {
    const calls: string[] = [];
    const stage = newContentStage([
      kindPurge(ApiResourceKind.memory, calls, [true, false]),
      kindPurge(ApiResourceKind.agent, calls),
    ]);
    expect(await stage.run(context)).toEqual({ more: true });
    expect(await stage.run(context)).toEqual({ more: false });
    expect(calls).toEqual(["memory", "memory", "agent"]);
  });
});

describe("the children stage", () => {
  it("waits while a child names the organization", async () => {
    await store.saveResource(
      ApiResourceKind.organization,
      OTHER,
      OrganizationSchema,
      create(OrganizationSchema, {
        metadata: { id: OTHER, name: "child" },
        spec: { parentOrg: ORG },
      }),
    );
    const stage = newChildrenStage(store);
    expect(await stage.run(context)).toEqual({ more: true, wait: true });
    await store.deleteResource(ApiResourceKind.organization, OTHER);
    expect(await stage.run(context)).toEqual({ more: false });
  });

  it("deletes a child no delete marked with its parent, and leaves a pending child's delete to it", async () => {
    const PENDING = "org_01kpendingpendingpendingpen";
    for (const child of [OTHER, PENDING]) {
      await store.saveResource(
        ApiResourceKind.organization,
        child,
        OrganizationSchema,
        create(OrganizationSchema, { metadata: { id: child, name: child }, spec: { parentOrg: ORG } }),
      );
    }
    await store.organizationDeletions.mark(PENDING, new Date().toISOString());
    await newChildrenStage(store).run(context);
    expect((await store.organizationDeletions.get(OTHER))?.phase).toBe("accepted");
    expect((await store.organizationDeletions.get(PENDING))?.phase).toBe("pending");
  });
});

describe("the final stage", () => {
  function rig() {
    const order: string[] = [];
    const grantPath = {
      async cleanupResource(ref: { kind: string; id: string }) {
        order.push(`policies:${ref.id}`);
      },
    } as unknown as IamPolicyGrantPath;
    const events: ResourceDeletedEvent[] = [];
    const stage = newFinalStage({
      store,
      logger: silentLogger,
      grantPath,
      lifecycle: {
        async onResourceCreated() {},
        async onResourceDeleted(event) {
          events.push(event);
        },
        async onVisibilityChanged() {},
      },
    });
    return { stage, order, events };
  }

  it("removes the policies, the row, the slug and the mark", async () => {
    await store.saveResource(
      ApiResourceKind.organization,
      ORG,
      OrganizationSchema,
      create(OrganizationSchema, { metadata: { id: ORG, name: "acme", slug: "acme" } }),
    );
    const now = new Date().toISOString();
    await store.resourceNames.claim(
      { kind: ORGANIZATION_NAME_KIND, org: "", name: "acme" },
      ORG,
      now,
    );
    await store.organizationDeletions.mark(ORG, now);
    await store.organizationDeletions.accept(ORG, now);
    const { stage, order, events } = rig();
    expect(await stage.run(context)).toEqual({ more: false });
    expect(order).toEqual([`policies:${ORG}`]);
    expect(events.map((event) => [event.kind, event.resourceId])).toEqual([
      [ApiResourceKind.organization, ORG],
    ]);
    await expect(
      store.getResource(ApiResourceKind.organization, ORG, OrganizationSchema),
    ).rejects.toThrow();
    expect(
      await store.resourceNames.current(ORGANIZATION_NAME_KIND, "", ORG),
    ).toBeUndefined();
    expect(await store.organizationDeletions.isDeleting(ORG)).toBe(false);
  });

  it("sweeps the search entries and fire-ledger rows that name the organization", async () => {
    await store.upsertSearchIndex(ApiResourceKind.agent, "agt_left", {
      name: "left behind",
      description: "",
      tags: "",
      org: ORG,
      visibility: "visibility_private",
      createdAt: 1_700_000_000,
    });
    await store.upsertScheduleRun({
      scheduleId: "sch_left",
      org: ORG,
      nominalFireTime: "2026-08-20T00:00:00Z",
      origin: "cron",
      outcome: "started",
      reason: "",
      executionId: "",
      recordedAt: "2026-08-20T00:00:01Z",
      completedAt: "",
    });
    const { stage } = rig();
    await stage.run(context);
    expect(await store.deleteSearchIndexByOrg(ORG)).toBe(0);
    expect((await store.listScheduleRuns("sch_left", 0, 0)).total).toBe(0);
  });

  it("runs its sweeps to their end before anything final", async () => {
    const order: string[] = [];
    const answers = [true, true, false];
    const stage = newFinalStage({
      store,
      logger: silentLogger,
      grantPath: {
        async cleanupResource() {
          order.push("policies");
        },
      } as unknown as IamPolicyGrantPath,
      lifecycle: undefined,
      sweepFirst: [
        {
          name: "content-again",
          async run() {
            order.push("sweep");
            return { more: answers.shift() ?? false };
          },
        },
      ],
    });
    await stage.run(context);
    expect(order).toEqual(["sweep", "sweep", "sweep", "policies"]);
  });

  it("leaves itself to a later pass when a sweep waits, with nothing final done", async () => {
    const order: string[] = [];
    const stage = newFinalStage({
      store,
      logger: silentLogger,
      grantPath: {
        async cleanupResource() {
          order.push("policies");
        },
      } as unknown as IamPolicyGrantPath,
      lifecycle: undefined,
      sweepFirst: [
        {
          name: "unit-waits",
          async run() {
            order.push("sweep");
            return { more: true, wait: true };
          },
        },
      ],
    });
    expect(await stage.run(context)).toEqual({ more: true, wait: true });
    expect(order).toEqual(["sweep"]);
  });

  it("finishes when the row is already gone", async () => {
    const now = new Date().toISOString();
    await store.resourceNames.claim(
      { kind: ORGANIZATION_NAME_KIND, org: "", name: "acme" },
      ORG,
      now,
    );
    await store.organizationDeletions.mark(ORG, now);
    await store.organizationDeletions.accept(ORG, now);
    const { stage } = rig();
    expect(await stage.run(context)).toEqual({ more: false });
    expect(
      await store.resourceNames.current(ORGANIZATION_NAME_KIND, "", ORG),
    ).toBeUndefined();
    expect(await store.organizationDeletions.isDeleting(ORG)).toBe(false);
  });

  it("fails the stage when the organization's row cannot be read", async () => {
    vi.spyOn(store, "getResource").mockRejectedValueOnce(new Error("store down"));
    const { stage } = rig();
    await expect(stage.run(context)).rejects.toThrow("store down");
  });
});

