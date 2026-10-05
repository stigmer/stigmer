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
 *     faults; every session's and workflow run's sandbox is torn down; the
 *     side-store records of the organization go and another's stay;
 *   - content: kind purges in order, one batch of the first with rows left;
 *   - children: waits while a child row names the organization;
 *   - final: the policy rows, the lifecycle's organization event, the row,
 *     its slug and its mark go, in that order relative to the mark; and a
 *     row already gone still ends with the slug and the mark released.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
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
import type { ConnectedExecutionEngine } from "../../../agentexecution/engine.js";
import {
  ENGINE_DISCONNECTED,
  EngineWorkflowNotFoundError,
} from "../../../agentexecution/engine.js";
import { ENGINE_DISCONNECTED as WORKFLOW_ENGINE_DISCONNECTED } from "../../../workflowexecution/engine.js";
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

async function saveExecution(id: string, org: string, phase: ExecutionPhase) {
  await store.saveResource(
    ApiResourceKind.agent_execution,
    id,
    AgentExecutionSchema,
    create(AgentExecutionSchema, {
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
    await saveExecution("aex_done", ORG, ExecutionPhase.EXECUTION_COMPLETED);
    const calls: string[] = [];
    const stage = newQuiesceStage({
      store,
      logger: silentLogger,
      schedulePurge: kindPurge(ApiResourceKind.schedule, calls, [true, false]),
      agentEngine: () => ENGINE_DISCONNECTED,
      workflowEngine: () => WORKFLOW_ENGINE_DISCONNECTED,
      sandboxLane: noSandboxes,
    });
    expect(await stage.run(context)).toEqual({ more: true });
    expect(await stage.run(context)).toEqual({ more: false });
    expect(calls).toEqual(["schedule", "schedule"]);
  });

  it("terminates a run that may still be live, tolerates one the engine no longer holds, and faults with the engine unreachable", async () => {
    await saveExecution("aex_live", ORG, ExecutionPhase.EXECUTION_IN_PROGRESS);
    await saveExecution("aex_gone", ORG, ExecutionPhase.EXECUTION_PENDING);
    await saveExecution("aex_other", OTHER, ExecutionPhase.EXECUTION_IN_PROGRESS);
    const terminated: string[] = [];
    const deps = {
      store,
      logger: silentLogger,
      schedulePurge: kindPurge(ApiResourceKind.schedule, []),
      workflowEngine: () => WORKFLOW_ENGINE_DISCONNECTED,
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
      await store.signalDedupe.claim(org, "k", "wfe_1", "resume", 60_000);
    }
    const torn: string[] = [];
    const provisioner = {
      async deprovisionSessionSandbox(id: string) {
        torn.push(id);
      },
      async deprovisionWorkflowSandbox(id: string) {
        torn.push(id);
      },
    } as unknown as SandboxProvisioner;
    await newQuiesceStage({
      store,
      logger: silentLogger,
      schedulePurge: kindPurge(ApiResourceKind.schedule, []),
      agentEngine: () => ENGINE_DISCONNECTED,
      workflowEngine: () => WORKFLOW_ENGINE_DISCONNECTED,
      sandboxLane: {
        enabled: true,
        provisioner,
        credentials: {} as never,
      },
    }).run(context);
    expect(torn).toEqual(["ses_1"]);
    expect(await store.signalDedupe.deleteByOrg(ORG)).toBe(0);
    expect(await store.signalDedupe.deleteByOrg(OTHER)).toBe(1);
  });
});

describe("the content stage", () => {
  it("runs the kind purges in order, one batch of the first with rows left", async () => {
    const calls: string[] = [];
    const stage = newContentStage([
      kindPurge(ApiResourceKind.artifact, calls, [true, false]),
      kindPurge(ApiResourceKind.agent, calls),
    ]);
    expect(await stage.run(context)).toEqual({ more: true });
    expect(await stage.run(context)).toEqual({ more: false });
    expect(calls).toEqual(["artifact", "artifact", "agent"]);
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
});
