/**
 * Pins the Environment's purge (../purge.ts) over a real SQLite store
 * opened with the server's list indexes, and its place in the core purge
 * inventory (boot/organization-purge.ts CORE_PURGED_KINDS).
 *
 * What it pins:
 *   - every Environment of the organization being deleted goes, with its
 *     name released and its grant rows revoked, even while an agent, a
 *     routine and the organization's default still name it (the delete
 *     chain's refusal is not a purge step: they go with the organization);
 *   - another organization's Environment stays, its name held;
 *   - the core purge inventory lists the kind.
 */
import { create } from "@bufbuild/protobuf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { RoutineSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceRef } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";

import { CORE_PURGED_KINDS } from "../../../boot/organization-purge.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { OrganizationPurgeTarget } from "../../../extensions/organization-purge.js";
import { serverActingFor } from "../../../pipeline/interceptors/auth.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { newEnvironmentPurge } from "../purge.js";

const ORG: OrganizationPurgeTarget = { id: "org_01kenvpurgeenvpurgeenvpurge", parentOrg: "" };
const OTHER = "org_01kenvotherenvotherenvothe";
const CALLER = serverActingFor("organization-purge");
const NOW = "2026-10-18T00:00:00Z";

let fx: TempStore;
let revoked: ApiResourceRef[];

beforeEach(() => {
  fx = tempStore();
  revoked = [];
});

afterEach(async () => {
  await fx.cleanup();
});

async function saveEnvironment(id: string, org: string, slug: string): Promise<void> {
  await fx.store.saveResource(
    ApiResourceKind.environment,
    id,
    EnvironmentSchema,
    create(EnvironmentSchema, { metadata: { id, org, slug, name: slug } }),
  );
  await fx.store.resourceNames.claim({ kind: "environment", org, name: slug }, id, NOW);
}

describe("newEnvironmentPurge", () => {
  it("removes the organization's Environments, named or not, with their names and grants, and keeps another's", async () => {
    await saveEnvironment("env_01named", ORG.id, "named");
    await saveEnvironment("env_01loose", ORG.id, "loose");
    await saveEnvironment("env_01theirs", OTHER, "named");
    await fx.store.saveResource(
      ApiResourceKind.agent,
      "agt_01uses",
      AgentSchema,
      create(AgentSchema, {
        metadata: { id: "agt_01uses", org: ORG.id, slug: "uses" },
        spec: { environmentRef: { kind: ApiResourceKind.environment, org: ORG.id, id: "env_01named" } },
      }),
    );
    await fx.store.saveResource(
      ApiResourceKind.routine,
      "rtn_01uses",
      RoutineSchema,
      create(RoutineSchema, {
        metadata: { id: "rtn_01uses", org: ORG.id, slug: "uses" },
        spec: { agent: { environmentRef: { kind: ApiResourceKind.environment, org: ORG.id, id: "env_01named" } } },
      }),
    );
    await fx.store.saveResource(
      ApiResourceKind.organization,
      ORG.id,
      OrganizationSchema,
      create(OrganizationSchema, {
        metadata: { id: ORG.id, slug: "purged" },
        spec: { preferences: { defaultEnvironmentRef: { kind: ApiResourceKind.environment, id: "env_01named" } } },
      }),
    );
    const purge = newEnvironmentPurge({
      store: fx.store,
      logger: silentLogger,
      grantPath: {
        async cleanupResource(ref) {
          revoked.push(ref);
        },
      },
      authorizationLifecycle: undefined,
    });
    expect(purge.kind).toBe(ApiResourceKind.environment);
    expect(await purge.holdsAny(ORG)).toBe(true);

    expect(await purge.purge(ORG, CALLER)).toEqual({ more: false });

    expect(await purge.holdsAny(ORG)).toBe(false);
    const left = await fx.store.findResourcesRawOrderedAfter(ApiResourceKind.environment, "", 100);
    expect(left.map((row) => row.id)).toEqual(["env_01theirs"]);
    expect(await fx.store.resourceNames.current("environment", ORG.id, "env_01named")).toBeUndefined();
    expect(await fx.store.resourceNames.current("environment", ORG.id, "env_01loose")).toBeUndefined();
    expect((await fx.store.resourceNames.current("environment", OTHER, "env_01theirs"))?.name).toBe("named");
    expect(revoked.map((ref) => `${ref.kind}:${ref.id}`).sort()).toEqual([
      "environment:env_01loose",
      "environment:env_01named",
    ]);
  });

  it("is listed in the core purge inventory", () => {
    expect(CORE_PURGED_KINDS.has(ApiResourceKind.environment)).toBe(true);
  });
});
