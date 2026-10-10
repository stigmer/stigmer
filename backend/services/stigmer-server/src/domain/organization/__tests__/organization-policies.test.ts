/**
 * Pins an organization's policies (../policies.ts) step by step, over an
 * in-memory store and a recording lifecycle, where the order of the row's
 * write and the lifecycle's announcement can be seen:
 *
 *   - create defaults an omitted message to "members may create agents" and
 *     announces the open edge after the row persists; created closed, it
 *     announces nothing;
 *   - update and apply keep the stored policies, whatever the request
 *     carries, and keep "none stored" as none;
 *   - updatePolicies replaces the whole message: a change that closes
 *     agent creation is announced BEFORE the write, one that opens it
 *     AFTER, a change of nothing writes and announces nothing, a row with
 *     no policies announces either way (an edition never wrote its edge),
 *     and a lifecycle fault fails the request: when closing, with the row
 *     unchanged; a store fault on the load or the write answers INTERNAL,
 *     and a failed write announces no opening.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { UpdateOrganizationPoliciesInputSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";

import type {
  OrganizationPoliciesChangedEvent,
  ResourceAuthorizationLifecycle,
} from "../../../extensions/resource-authorization.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import {
  POLICIES_ORGANIZATION_KEY,
  newAnnounceCreatedOrganizationPoliciesStep,
  newChangeOrganizationPoliciesStep,
  newDefaultOrganizationPoliciesStep,
  newLoadOrganizationForPoliciesStep,
  newPreservePoliciesStep,
} from "../policies.js";

const ORG = "org_01jacme";

function organization(open: boolean | undefined): Organization {
  return create(OrganizationSchema, {
    metadata: { id: ORG, name: "acme", slug: "acme" },
    spec: open === undefined ? {} : { policies: { membersCanCreateAgents: open } },
  });
}

/** One stored organization, and the log of writes and announcements in order. */
function rig(
  stored: Organization,
  failAnnounce = false,
  faults: { load?: boolean; save?: boolean } = {},
) {
  const log: string[] = [];
  let row = clone(OrganizationSchema, stored);
  const store = {
    getResource: (kind: ApiResourceKind, id: string) => {
      if (kind !== ApiResourceKind.organization || id !== ORG) {
        return Promise.reject(new ResourceNotFoundError(id));
      }
      if (faults.load === true) {
        return Promise.reject(new Error("store unreachable"));
      }
      return Promise.resolve(clone(OrganizationSchema, row));
    },
    saveResource: (_kind: ApiResourceKind, _id: string, _schema: unknown, saved: Organization) => {
      if (faults.save === true) {
        return Promise.reject(new Error("store unreachable"));
      }
      log.push(`save:${String(saved.spec?.policies?.membersCanCreateAgents)}`);
      row = clone(OrganizationSchema, saved);
      return Promise.resolve();
    },
  } as unknown as Store;
  const lifecycle = {
    onOrganizationPoliciesChanged: (event: OrganizationPoliciesChangedEvent) => {
      log.push(
        `announce:${String(event.before?.membersCanCreateAgents)}->${String(event.after.membersCanCreateAgents)}`,
      );
      return failAnnounce ? Promise.reject(new Error("tuple store down")) : Promise.resolve();
    },
  } as unknown as ResourceAuthorizationLifecycle;
  return { store, lifecycle, log, current: () => row };
}

async function updatePolicies(
  r: ReturnType<typeof rig>,
  open: boolean,
): Promise<Organization> {
  const ctx = new RequestContext(
    UpdateOrganizationPoliciesInputSchema,
    create(UpdateOrganizationPoliciesInputSchema, {
      orgId: ORG,
      policies: { membersCanCreateAgents: open },
    }),
    testCallerIdentity({ identityId: "acc_admin" }),
    ApiResourceKind.organization,
  );
  await newLoadOrganizationForPoliciesStep(r.store).execute(ctx);
  await newChangeOrganizationPoliciesStep(r.store, r.lifecycle).execute(ctx);
  return ctx.get(POLICIES_ORGANIZATION_KEY) as Organization;
}

async function refusal(run: () => unknown): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

function orgContext(org: Organization): RequestContext<typeof OrganizationSchema> {
  return new RequestContext(
    OrganizationSchema,
    org,
    testCallerIdentity({ identityId: "acc_admin" }),
    ApiResourceKind.organization,
  );
}

describe("create", () => {
  it("defaults an omitted message to members may create agents, and keeps a declared one", () => {
    const omitted = orgContext(create(OrganizationSchema, { metadata: { name: "acme" } }));
    newDefaultOrganizationPoliciesStep().execute(omitted);
    expect(omitted.newState.spec?.policies?.membersCanCreateAgents).toBe(true);

    const closed = orgContext(organization(false));
    newDefaultOrganizationPoliciesStep().execute(closed);
    expect(closed.newState.spec?.policies?.membersCanCreateAgents).toBe(false);
  });

  it("announces the open edge after the row persists, and nothing for a closed organization", async () => {
    const open = rig(organization(true));
    await newAnnounceCreatedOrganizationPoliciesStep(open.lifecycle).execute(
      orgContext(organization(true)),
    );
    expect(open.log).toEqual(["announce:undefined->true"]);

    const closed = rig(organization(false));
    await newAnnounceCreatedOrganizationPoliciesStep(closed.lifecycle).execute(
      orgContext(organization(false)),
    );
    expect(closed.log).toEqual([]);
  });

  it("fails the create when the announcement fails", async () => {
    const r = rig(organization(true), true);
    const error = await refusal(() =>
      newAnnounceCreatedOrganizationPoliciesStep(r.lifecycle).execute(
        orgContext(organization(true)),
      ),
    );
    expect(error.code).toBe(Code.Internal);
  });
});

describe("update and apply keep the stored policies", () => {
  it("ignores a policy the request carries", () => {
    const ctx = orgContext(organization(true));
    ctx.set(EXISTING_RESOURCE_KEY, organization(false));
    newPreservePoliciesStep().execute(ctx);
    expect(ctx.newState.spec?.policies?.membersCanCreateAgents).toBe(false);
  });

  it("keeps a row with no stored policies without any", () => {
    const ctx = orgContext(organization(false));
    ctx.set(EXISTING_RESOURCE_KEY, organization(undefined));
    newPreservePoliciesStep().execute(ctx);
    expect(ctx.newState.spec?.policies).toBeUndefined();
  });

  it("answers an update that reached it without its loaded row INTERNAL", async () => {
    const error = await refusal(() =>
      newPreservePoliciesStep().execute(orgContext(organization(true))),
    );
    expect(error.code).toBe(Code.Internal);
  });
});

describe("updatePolicies", () => {
  it("announces a closing change before the write", async () => {
    const r = rig(organization(true));
    const changed = await updatePolicies(r, false);
    expect(r.log).toEqual(["announce:true->false", "save:false"]);
    expect(changed.spec?.policies?.membersCanCreateAgents).toBe(false);
  });

  it("announces an opening change after the write", async () => {
    const r = rig(organization(false));
    await updatePolicies(r, true);
    expect(r.log).toEqual(["save:true", "announce:false->true"]);
  });

  it("writes and announces nothing for a change of nothing", async () => {
    const r = rig(organization(true));
    await updatePolicies(r, true);
    expect(r.log).toEqual([]);
  });

  it("announces either way for a row stored with no policies", async () => {
    const opening = rig(organization(undefined));
    await updatePolicies(opening, true);
    expect(opening.log).toEqual(["save:true", "announce:undefined->true"]);

    const closing = rig(organization(undefined));
    await updatePolicies(closing, false);
    expect(closing.log).toEqual(["announce:undefined->false", "save:false"]);
  });

  it("fails a closing change with the row unchanged when the announcement fails", async () => {
    const r = rig(organization(true), true);
    const error = await refusal(() => updatePolicies(r, false));
    expect(error.code).toBe(Code.Internal);
    expect(r.current().spec?.policies?.membersCanCreateAgents).toBe(true);
  });

  it("answers a store fault on the load INTERNAL, not NotFound", async () => {
    const r = rig(organization(true), false, { load: true });
    const error = await refusal(() => updatePolicies(r, false));
    expect(error.code).toBe(Code.Internal);
    expect(r.log).toEqual([]);
  });

  it("answers a store fault on the write INTERNAL, and announces no opening it did not make", async () => {
    const r = rig(organization(false), false, { save: true });
    const error = await refusal(() => updatePolicies(r, true));
    expect(error.code).toBe(Code.Internal);
    expect(r.log).toEqual([]);
  });

  it("answers a missing organization NotFound", async () => {
    const r = rig(organization(true));
    const ctx = new RequestContext(
      UpdateOrganizationPoliciesInputSchema,
      create(UpdateOrganizationPoliciesInputSchema, {
        orgId: "org_missing",
        policies: { membersCanCreateAgents: true },
      }),
      testCallerIdentity({ identityId: "acc_admin" }),
      ApiResourceKind.organization,
    );
    const error = await refusal(() => newLoadOrganizationForPoliciesStep(r.store).execute(ctx));
    expect(error.code).toBe(Code.NotFound);
  });
});
