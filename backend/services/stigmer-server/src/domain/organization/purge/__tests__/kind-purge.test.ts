/**
 * Pins the kind purge (../kind-purge.ts) over a real SQLite store opened
 * with the server's list indexes.
 *
 * What it pins:
 *   - only the organization's rows go, read by keyset scan for a kind with
 *     no list index (past a full page) and through the index for one with
 *     it; a row with no id fails the batch;
 *   - a batch removes at most its limit and answers whether rows are left;
 *   - the steps see the loaded row and its id, as the delete chain's
 *     steps do after their load;
 *   - every removed row's policy rows are revoked through the grant path,
 *     and a fault there fails the batch;
 *   - a kind that names its organization elsewhere (`belongsTo`, an API
 *     key's bound organization) and one read through a port (`rows`).
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiKeySchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { ApiResourceRef } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import { silentLogger } from "../../../../extensions/__tests__/composed-support.js";
import type { OrganizationPurgeTarget } from "../../../../extensions/organization-purge.js";
import { serverActingFor } from "../../../../pipeline/interceptors/auth.js";
import type { PipelineStep } from "../../../../pipeline/pipeline.js";
import { RESOURCE_ID_KEY, newDeleteResourceStep } from "../../../../pipeline/steps/delete.js";
import { EXISTING_RESOURCE_KEY } from "../../../../pipeline/steps/load-existing.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import { newApiKeyPurge } from "../../../apikey/purge.js";
import { sessionListIndex } from "../../../session/list-index.js";
import { newKindPurge } from "../kind-purge.js";
import type { KindPurgeDeps } from "../kind-purge.js";

const ORG: OrganizationPurgeTarget = {
  id: "org_01kpurgepurgepurgepurgepurg",
  parentOrg: "",
};
const OTHER = "org_01kotherotherotherotherothe";
const CALLER = serverActingFor("organization-purge");

let fx: TempStore;
let revoked: ApiResourceRef[];
let deps: KindPurgeDeps;

beforeEach(() => {
  fx = tempStore();
  revoked = [];
  deps = {
    store: fx.store,
    logger: silentLogger,
    grantPath: {
      async cleanupResource(ref) {
        revoked.push(ref);
      },
    },
  };
});

afterEach(async () => {
  await fx.cleanup();
});

type AgentDelete = typeof AgentCommandController.method.delete.input;

async function saveAgent(id: string, org: string): Promise<void> {
  await fx.store.saveResource(
    ApiResourceKind.agent,
    id,
    AgentSchema,
    create(AgentSchema, { metadata: { id, org } }),
  );
}

async function ids(kind: ApiResourceKind): Promise<string[]> {
  return (await fx.store.findResourcesRawOrderedAfter(kind, "", 100)).map(
    (row) => row.id,
  );
}

function agentPurge(steps: ReadonlyArray<PipelineStep<AgentDelete>> = []) {
  return newKindPurge(deps, {
    kind: ApiResourceKind.agent,
    schema: AgentSchema,
    input: AgentCommandController.method.delete.input,
    steps: [...steps, newDeleteResourceStep(fx.store)],
  });
}

describe("newKindPurge", () => {
  it("removes the organization's rows only, in batches, answering whether more are left", async () => {
    await saveAgent("agt_a1", ORG.id);
    await saveAgent("agt_a2", ORG.id);
    await saveAgent("agt_a3", ORG.id);
    await saveAgent("agt_b1", OTHER);
    const purge = agentPurge();

    expect(await purge.purge(ORG, CALLER, 2)).toEqual({ more: true });
    expect(await purge.holdsAny(ORG)).toBe(true);
    expect(await purge.purge(ORG, CALLER, 2)).toEqual({ more: false });
    expect(await purge.holdsAny(ORG)).toBe(false);
    expect(await ids(ApiResourceKind.agent)).toEqual(["agt_b1"]);
    expect(revoked.map((ref) => `${ref.kind}:${ref.id}`).sort()).toEqual([
      "agent:agt_a1",
      "agent:agt_a2",
      "agent:agt_a3",
    ]);
  });

  it("hands each step the loaded row and its id, as the delete chain's load does", async () => {
    await saveAgent("agt_a1", ORG.id);
    const seen: string[] = [];
    const purge = agentPurge([
      {
        name: "Record",
        execute(ctx) {
          const row = ctx.get(EXISTING_RESOURCE_KEY) as { metadata?: { org: string } };
          seen.push(`${String(ctx.get(RESOURCE_ID_KEY))}@${row.metadata?.org ?? ""}`);
          expect(ctx.apiResourceKind).toBe(ApiResourceKind.agent);
          expect(ctx.callerIdentity).toBe(CALLER);
        },
      },
    ]);
    await purge.purge(ORG, CALLER);
    expect(seen).toEqual([`agt_a1@${ORG.id}`]);
  });

  it("fails the batch when a policy revocation faults", async () => {
    await saveAgent("agt_a1", ORG.id);
    const purge = newKindPurge(
      {
        ...deps,
        grantPath: {
          cleanupResource: () => Promise.reject(new Error("policy store down")),
        },
      },
      {
        kind: ApiResourceKind.agent,
        schema: AgentSchema,
        input: AgentCommandController.method.delete.input,
        steps: [newDeleteResourceStep(fx.store)],
      },
    );
    await expect(purge.purge(ORG, CALLER)).rejects.toThrow("policy store down");
  });

  it("reads an indexed kind through its list index", async () => {
    for (const [id, org] of [
      ["ses_a1", ORG.id],
      ["ses_b1", OTHER],
    ] as const) {
      await fx.store.saveResource(
        ApiResourceKind.session,
        id,
        SessionSchema,
        create(SessionSchema, { metadata: { id, org } }),
      );
    }
    const purge = newKindPurge(deps, {
      kind: ApiResourceKind.session,
      schema: SessionSchema,
      input: SessionCommandController.method.delete.input,
      listIndex: sessionListIndex,
      steps: [newDeleteResourceStep(fx.store)],
    });
    expect(await purge.purge(ORG, CALLER)).toEqual({ more: false });
    expect(await ids(ApiResourceKind.session)).toEqual(["ses_b1"]);
  });

  it("reads a kind through a port when the spec says so", async () => {
    await saveAgent("agt_a1", ORG.id);
    const asked: string[] = [];
    const purge = newKindPurge(deps, {
      kind: ApiResourceKind.agent,
      schema: AgentSchema,
      input: AgentCommandController.method.delete.input,
      rows: async (org, limit) => {
        asked.push(`${org.id}/${limit}`);
        return asked.length === 1
          ? [create(AgentSchema, { metadata: { id: "agt_a1", org: org.id } })]
          : [];
      },
      steps: [newDeleteResourceStep(fx.store)],
    });
    expect(await purge.purge(ORG, CALLER, 5)).toEqual({ more: false });
    expect(asked).toEqual([`${ORG.id}/6`]);
    expect(await ids(ApiResourceKind.agent)).toEqual([]);
  });

  it("reads past a full keyset page to find the organization's rows", async () => {
    // One page more than the scan reads at once, the organization's row last.
    for (let i = 0; i < 200; i++) {
      await saveAgent(`agt_b${String(i).padStart(3, "0")}`, OTHER);
    }
    await saveAgent("agt_z", ORG.id);
    expect(await agentPurge().purge(ORG, CALLER)).toEqual({ more: false });
    expect(await agentPurge().holdsAny(ORG)).toBe(false);
  });

  it("refuses a row with no id, which nothing could delete", async () => {
    await fx.store.saveResource(
      ApiResourceKind.agent,
      "agt_keyed",
      AgentSchema,
      create(AgentSchema, { metadata: { org: ORG.id } }),
    );
    await expect(agentPurge().purge(ORG, CALLER)).rejects.toThrow(
      "a agent row with no id cannot be purged",
    );
  });
});

describe("the API key purge", () => {
  it("removes the keys bound to the organization and keeps unbound keys and keys bound elsewhere", async () => {
    for (const [id, boundOrg] of [
      ["key_a", ORG.id],
      ["key_b", OTHER],
      ["key_c", ""],
    ] as const) {
      await fx.store.saveResource(
        ApiResourceKind.api_key,
        id,
        ApiKeySchema,
        create(ApiKeySchema, { metadata: { id }, spec: { boundOrg } }),
      );
    }
    const purge = newApiKeyPurge({ ...deps, authorizationLifecycle: undefined });
    expect(await purge.purge(ORG, CALLER)).toEqual({ more: false });
    expect(await ids(ApiResourceKind.api_key)).toEqual(["key_b", "key_c"]);
  });
});
