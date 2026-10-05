/**
 * Pins the organization lanes that list organizations (controller.ts
 * `find`, `findMyOrganizations` with and without a directory, and
 * `listChildOrgs`) against the deleting rule: an organization being deleted
 * is left out of every list, its row still standing, and a deletion table
 * that cannot be read answers INTERNAL with the lane's fixed copy, never a
 * list that might hold it. The registered handlers run on an in-process
 * router over a real SQLite store; the directory is a fake.
 */
import { create } from "@bufbuild/protobuf";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
} from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { createLogger } from "../../../boot/logger.js";
import type { OrganizationDirectory } from "../../../extensions/organization-directory.js";
import { buildInterceptorChain } from "../../../pipeline/chain.js";
import { createInProcessCallerInterceptor } from "../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { registerOrganizationServices } from "../controller.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const LIVE = "org_01kliveliveliveliveliveliv0";
const DELETING = "org_01kdeletingdeletingdeleting";
const PARENT = "org_01kparentparentparentparent";

let temp: TempStore;

beforeEach(async () => {
  temp = tempStore();
  for (const [id, parentOrg] of [
    [LIVE, PARENT],
    [DELETING, PARENT],
    [PARENT, ""],
  ] as const) {
    await temp.store.saveResource(
      ApiResourceKind.organization,
      id,
      OrganizationSchema,
      create(OrganizationSchema, { metadata: { id, name: id }, spec: { parentOrg } }),
    );
  }
  await temp.store.organizationDeletions.mark(DELETING, new Date().toISOString());
});

afterEach(async () => {
  await temp.cleanup();
});

function query(
  directory?: OrganizationDirectory,
): Client<typeof OrganizationQueryController> {
  const transport = createRouterTransport(
    (router) =>
      registerOrganizationServices(router, {
        store: temp.store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        gateSteps: new Map(),
        grantPath: {} as never,
        authorizationLifecycle: undefined,
        organizationDirectory: directory,
        orgLimit: undefined,
        purge: { kick: () => {} },
      }),
    {
      router: {
        interceptors: buildInterceptorChain(silentLogger, createInProcessCallerInterceptor()),
      },
    },
  );
  return createClient(OrganizationQueryController, transport);
}

async function codeOf(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

function idsOf(entries: ReadonlyArray<{ metadata?: { id: string } }>): string[] {
  return entries.map((entry) => entry.metadata?.id ?? "").sort();
}

describe("the organization lists, with an organization being deleted", () => {
  it("find leaves it out", async () => {
    const listed = await query().find({ org: PARENT });
    expect(idsOf(listed.entries)).toEqual([LIVE, PARENT].sort());
  });

  it("findMyOrganizations leaves it out, with no directory and through one", async () => {
    expect(idsOf((await query().findMyOrganizations({})).entries)).toEqual(
      [LIVE, PARENT].sort(),
    );
    const directory: OrganizationDirectory = {
      refusesEnumeration: false,
      listMyOrganizationIds: () => Promise.resolve([LIVE, DELETING]),
    };
    expect(idsOf((await query(directory).findMyOrganizations({})).entries)).toEqual([LIVE]);
  });

  it("listChildOrgs leaves it out", async () => {
    const listed = await query().listChildOrgs({ org: PARENT, pageSize: 10 });
    expect(idsOf(listed.entries)).toEqual([LIVE]);
  });

  it("answers INTERNAL, never a list, when the deletion table cannot be read", async () => {
    const down = () =>
      vi
        .spyOn(temp.store.organizationDeletions, "list")
        .mockRejectedValueOnce(new Error("store down"));
    down();
    const found = await codeOf(() => query().find({ org: PARENT }));
    expect([found.code, found.rawMessage]).toEqual([Code.Internal, "failed to list organizations"]);
    down();
    const mine = await codeOf(() => query().findMyOrganizations({}));
    expect([mine.code, mine.rawMessage]).toEqual([Code.Internal, "failed to list organizations"]);
    down();
    const children = await codeOf(() => query().listChildOrgs({ org: PARENT, pageSize: 10 }));
    expect([children.code, children.rawMessage]).toEqual([
      Code.Internal,
      "failed to list child organizations",
    ]);
  });
});
