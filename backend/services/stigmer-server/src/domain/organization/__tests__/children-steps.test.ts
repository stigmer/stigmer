/**
 * Pins the parent and child organization steps and lookups (../children.ts)
 * against an in-memory store, where a test can make a read or a claim
 * fail: the composed suite beside it (children.test.ts) proves the happy
 * paths and the refusals through the real stack, and cannot reach a fault.
 *
 * What it pins:
 *   - the lookups a composition receives: `findByExternalId` answers a
 *     child only while its claim and its row both name it, and `listIds`
 *     keeps only rows that still name the parent; both leave out a child
 *     being deleted; `isChildOf` and
 *     `childrenOf` answer nothing for an empty or missing organization;
 *     every read fault propagates;
 *   - the getByExternalId lane's read answers one NotFound for every miss
 *     and INTERNAL for a fault;
 *   - a stored row that is not an organization decodes to nothing;
 *   - ValidateChildOrganization answers a parent the Authorizer cannot
 *     find, and a parent the store does not hold, with the one denial
 *     copy, and a read fault INTERNAL;
 *   - ClaimExternalId frees a claim whose holder is gone and is old
 *     enough, keeps a young one, and answers a missing id or a claim
 *     fault INTERNAL;
 *   - the release after a failed create frees a claim whose row never
 *     landed, keeps one whose row did, and logs a fault;
 *   - LinkChildOrganization, PreserveChildLink, RefuseDeletingParent and
 *     ReleaseExternalId answer a fault or a missing loaded row as their
 *     headers say; RefuseDeletingParent counts only children not being
 *     deleted.
 */
import { create, toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationIdSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";

import { createLogger } from "../../../boot/logger.js";
import type { Authorizer, AuthzDecision } from "../../../extensions/authorizer.js";
import type { ResourceAuthorizationLifecycle } from "../../../extensions/resource-authorization.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type {
  ResourceNameEntry,
  ResourceNameKey,
  Store,
} from "../../../store/interface.js";
import {
  CHILD_ORGS_DENIED_MESSAGE,
  EXTERNAL_ID_NAME_KIND,
  childrenOf,
  decodeOrganization,
  getChildByExternalId,
  isChildOf,
  newChildOrganizations,
  newClaimExternalIdStep,
  newLinkChildOrganizationStep,
  newPreserveChildLinkStep,
  newRefuseDeletingParentStep,
  newReleaseExternalIdStep,
  newValidateChildOrganizationStep,
  releaseExternalIdClaimAfterFailure,
} from "../children.js";

const STORE_DOWN = new Error("store down");
const LONG_AGO = "2020-01-01T00:00:00.000Z";

function org(id: string, parentOrg = "", externalId = ""): Organization {
  return create(OrganizationSchema, {
    metadata: { id, name: id },
    spec: { parentOrg, externalId },
  });
}

function entry(
  id: string,
  parentId: string,
  externalId: string,
  claimedAt = LONG_AGO,
): ResourceNameEntry {
  return {
    kind: EXTERNAL_ID_NAME_KIND,
    org: parentId,
    name: externalId,
    id,
    state: "current",
    claimedAt,
    expiresAt: "",
  };
}

interface FakeStore {
  readonly store: Store;
  readonly released: string[];
  readonly claims: string[];
}

/**
 * An in-memory store: organization rows by id (an Error value makes the
 * read of that id fail), the list index's rows for a parent, the name
 * table's answers, and the deletion table.
 */
function fakeStore(
  options: {
    rows?: ReadonlyArray<Organization | { id: string; fault: Error }>;
    indexed?: ReadonlyArray<{ id: string; data: Uint8Array }>;
    queryFault?: Error;
    resolved?: ResourceNameEntry | Error;
    claim?: ReadonlyArray<{ claimed: boolean; entry: ResourceNameEntry } | Error>;
    releaseFault?: Error;
    /** Organizations the deletion table holds, accepted. */
    deleting?: ReadonlyArray<string>;
    /** Organizations the deletion table holds whose delete is still pending. */
    pending?: ReadonlyArray<string>;
  } = {},
): FakeStore {
  const released: string[] = [];
  const claims: string[] = [];
  const rows = new Map<string, Organization | Error>();
  for (const row of options.rows ?? []) {
    if ("fault" in row) {
      rows.set(row.id, row.fault);
    } else {
      rows.set(row.metadata?.id ?? "", row);
    }
  }
  const claimAnswers = [...(options.claim ?? [])];
  const store = {
    async getResource(_kind: ApiResourceKind, id: string) {
      const row = rows.get(id);
      if (row === undefined) {
        throw new ResourceNotFoundError(`organization ${id}`);
      }
      if (row instanceof Error) {
        throw row;
      }
      return row;
    },
    async queryResources() {
      if (options.queryFault !== undefined) {
        throw options.queryFault;
      }
      return options.indexed ?? [];
    },
    organizationDeletions: {
      async isDeleting(org: string) {
        return [...(options.deleting ?? []), ...(options.pending ?? [])].includes(org);
      },
      async list() {
        return [
          ...(options.deleting ?? []).map((org) => ({ org, phase: "accepted" })),
          ...(options.pending ?? []).map((org) => ({ org, phase: "pending" })),
        ];
      },
    },
    resourceNames: {
      async resolve() {
        if (options.resolved instanceof Error) {
          throw options.resolved;
        }
        return options.resolved;
      },
      async claim(key: ResourceNameKey, id: string) {
        claims.push(`${key.org}/${key.name}=${id}`);
        const answer = claimAnswers.shift();
        if (answer instanceof Error) {
          throw answer;
        }
        return answer ?? { claimed: true, entry: entry(id, key.org, key.name) };
      },
      async release(kind: string, parentId: string, id: string) {
        if (options.releaseFault !== undefined) {
          throw options.releaseFault;
        }
        released.push(`${kind}:${parentId}:${id}`);
      },
    },
  } as unknown as Store;
  return { store, released, claims };
}

function indexedRow(organization: Organization) {
  return {
    id: organization.metadata?.id ?? "",
    data: toBinary(OrganizationSchema, organization),
  };
}

function capturingLogger() {
  const lines: string[] = [];
  return {
    logger: createLogger({
      level: "error",
      pretty: false,
      write: (line) => lines.push(line),
    }),
    lines,
  };
}

function createContext(organization: Organization) {
  return new RequestContext(
    OrganizationSchema,
    organization,
    testCallerIdentity(),
    ApiResourceKind.organization,
  );
}

function deleteContext(loaded: Organization | undefined) {
  const ctx = new RequestContext(
    OrganizationIdSchema,
    create(OrganizationIdSchema),
    testCallerIdentity(),
    ApiResourceKind.organization,
  );
  if (loaded !== undefined) {
    ctx.set(EXISTING_RESOURCE_KEY, loaded);
  }
  return ctx;
}

function authorizerAnswering(decision: AuthzDecision): Authorizer {
  return { authorize: () => Promise.resolve(decision) };
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
  throw new Error("expected the call to fail");
}

describe("the child-organization lookups", () => {
  it("findByExternalId answers a child only while its claim and its row both name it", async () => {
    const child = org("org_c", "org_p", "cust-1");
    const found = await newChildOrganizations(
      fakeStore({ rows: [child], resolved: entry("org_c", "org_p", "cust-1") }).store,
    ).findByExternalId("org_p", "cust-1");
    expect(found?.metadata?.id).toBe("org_c");

    const misses: Array<[string, FakeStore]> = [
      ["no claim", fakeStore({ rows: [child] })],
      ["a claim whose row is gone", fakeStore({ resolved: entry("org_c", "org_p", "cust-1") })],
      [
        "a row that names another parent",
        fakeStore({ rows: [org("org_c", "org_q", "cust-1")], resolved: entry("org_c", "org_p", "cust-1") }),
      ],
      [
        "a row that names another external id",
        fakeStore({ rows: [org("org_c", "org_p", "cust-2")], resolved: entry("org_c", "org_p", "cust-1") }),
      ],
    ];
    for (const [label, rig] of misses) {
      expect(
        await newChildOrganizations(rig.store).findByExternalId("org_p", "cust-1"),
        label,
      ).toBeUndefined();
    }
    expect(
      await newChildOrganizations(
        fakeStore({ rows: [child], resolved: entry("org_c", "org_p", "cust-1"), deleting: ["org_c"] }).store,
      ).findByExternalId("org_p", "cust-1"),
      "a child being deleted",
    ).toBeUndefined();
    const empty = newChildOrganizations(fakeStore({ rows: [child] }).store);
    expect(await empty.findByExternalId("", "cust-1")).toBeUndefined();
    expect(await empty.findByExternalId("org_p", "")).toBeUndefined();
  });

  it("findByExternalId lets a fault in the name table or the row read propagate", async () => {
    await expect(
      newChildOrganizations(fakeStore({ resolved: STORE_DOWN }).store).findByExternalId("org_p", "cust-1"),
    ).rejects.toBe(STORE_DOWN);
    await expect(
      newChildOrganizations(
        fakeStore({ rows: [{ id: "org_c", fault: STORE_DOWN }], resolved: entry("org_c", "org_p", "cust-1") }).store,
      ).findByExternalId("org_p", "cust-1"),
    ).rejects.toBe(STORE_DOWN);
  });

  it("listIds keeps only the indexed rows that still name the parent, and skips a row that is not an organization", async () => {
    const rig = fakeStore({
      indexed: [
        indexedRow(org("org_c1", "org_p")),
        indexedRow(org("org_x", "org_q")),
        { id: "org_bad", data: new Uint8Array([0xff, 0xff, 0xff]) },
        indexedRow(org("org_c2", "org_p")),
      ],
    });
    expect(await newChildOrganizations(rig.store).listIds("org_p")).toEqual(["org_c1", "org_c2"]);
    expect(await childrenOf(rig.store, "")).toEqual([]);
    const deleting = fakeStore({
      indexed: [indexedRow(org("org_c1", "org_p")), indexedRow(org("org_c2", "org_p"))],
      deleting: ["org_c2"],
    });
    expect(await newChildOrganizations(deleting.store).listIds("org_p"), "a child being deleted is left out").toEqual([
      "org_c1",
    ]);
  });

  it("isChildOf answers false for an empty, self or missing organization, and lets a fault propagate", async () => {
    const rig = fakeStore({ rows: [org("org_c", "org_p"), { id: "org_down", fault: STORE_DOWN }] });
    expect(await isChildOf(rig.store, "org_c", "org_p")).toBe(true);
    expect(await isChildOf(rig.store, "org_c", "org_q")).toBe(false);
    expect(await isChildOf(rig.store, "", "org_p")).toBe(false);
    expect(await isChildOf(rig.store, "org_p", "org_p")).toBe(false);
    expect(await isChildOf(rig.store, "org_gone", "org_p")).toBe(false);
    await expect(isChildOf(rig.store, "org_down", "org_p")).rejects.toBe(STORE_DOWN);
  });

  it("decodes a row that is not an organization to nothing", () => {
    expect(decodeOrganization(new Uint8Array([0xff, 0xff, 0xff]))).toBeUndefined();
    expect(decodeOrganization(toBinary(OrganizationSchema, org("org_c")))?.metadata?.id).toBe("org_c");
  });
});

describe("the getByExternalId lane's read", () => {
  it("answers one NotFound for every miss and INTERNAL for a fault", async () => {
    const miss = await refusal(() => getChildByExternalId(fakeStore().store, "org_p", "cust-1"));
    expect(miss.code).toBe(Code.NotFound);

    const fault = await refusal(() =>
      getChildByExternalId(fakeStore({ resolved: STORE_DOWN }).store, "org_p", "cust-1"),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toContain("failed to find the child organization");
  });
});

describe("ValidateChildOrganization", () => {
  const allow = authorizerAnswering({ kind: "allow" });

  it("answers a parent the Authorizer cannot find with the denial copy, as one the caller may not manage", async () => {
    const error = await refusal(() =>
      newValidateChildOrganizationStep(fakeStore().store, authorizerAnswering({ kind: "not-found" })).execute(
        createContext(org("org_new", "org_p")),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(CHILD_ORGS_DENIED_MESSAGE);
  });

  it("answers a parent the store does not hold with the denial copy, and a read fault INTERNAL", async () => {
    const missing = await refusal(() =>
      newValidateChildOrganizationStep(fakeStore().store, allow).execute(createContext(org("org_new", "org_p"))),
    );
    expect(missing.code).toBe(Code.PermissionDenied);
    expect(missing.rawMessage).toBe(CHILD_ORGS_DENIED_MESSAGE);

    const fault = await refusal(() =>
      newValidateChildOrganizationStep(
        fakeStore({ rows: [{ id: "org_p", fault: STORE_DOWN }] }).store,
        allow,
      ).execute(createContext(org("org_new", "org_p"))),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toContain("failed to read the parent organization");
  });
});

describe("ClaimExternalId", () => {
  it("frees a claim whose holder is gone and old enough, then claims the id", async () => {
    const rig = fakeStore({
      claim: [{ claimed: false, entry: entry("org_gone", "org_p", "cust-1") }],
    });
    await newClaimExternalIdStep(rig.store).execute(createContext(org("org_new", "org_p", "cust-1")));
    expect(rig.released).toEqual([`${EXTERNAL_ID_NAME_KIND}:org_p:org_gone`]);
    expect(rig.claims).toEqual(["org_p/cust-1=org_new", "org_p/cust-1=org_new"]);
  });

  it("keeps a young claim, whose create may not have stored its row yet, and refuses AlreadyExists", async () => {
    const rig = fakeStore({
      claim: [{ claimed: false, entry: entry("org_racing", "org_p", "cust-1", new Date().toISOString()) }],
    });
    const error = await refusal(() =>
      newClaimExternalIdStep(rig.store).execute(createContext(org("org_new", "org_p", "cust-1"))),
    );
    expect(error.code).toBe(Code.AlreadyExists);
    expect(rig.released).toEqual([]);
  });

  it("answers a create with no minted id, and a claim fault, INTERNAL", async () => {
    const unminted = await refusal(() =>
      newClaimExternalIdStep(fakeStore().store).execute(createContext(org("", "org_p", "cust-1"))),
    );
    expect(unminted.code).toBe(Code.Internal);

    const fault = await refusal(() =>
      newClaimExternalIdStep(fakeStore({ claim: [STORE_DOWN] }).store).execute(
        createContext(org("org_new", "org_p", "cust-1")),
      ),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toContain("failed to claim the organization's external id");
  });
});

describe("the release after a failed create", () => {
  async function claimedContext(rig: FakeStore) {
    const ctx = createContext(org("org_new", "org_p", "cust-1"));
    await newClaimExternalIdStep(rig.store).execute(ctx);
    return ctx;
  }

  it("frees the claim when the child's row never landed, and keeps it when it did", async () => {
    const unstored = fakeStore();
    const { logger } = capturingLogger();
    await releaseExternalIdClaimAfterFailure(unstored.store, logger, await claimedContext(unstored));
    expect(unstored.released).toEqual([`${EXTERNAL_ID_NAME_KIND}:org_p:org_new`]);

    const stored = fakeStore({ rows: [org("org_new", "org_p", "cust-1")] });
    await releaseExternalIdClaimAfterFailure(stored.store, logger, await claimedContext(stored));
    expect(stored.released).toEqual([]);

    // A create that claimed nothing has nothing to release.
    const unclaimed = fakeStore();
    await releaseExternalIdClaimAfterFailure(unclaimed.store, logger, createContext(org("org_new")));
    expect(unclaimed.released).toEqual([]);
  });

  it("logs a release fault and leaves the claim for the next one to free", async () => {
    const rig = fakeStore({ releaseFault: STORE_DOWN });
    const { logger, lines } = capturingLogger();
    await releaseExternalIdClaimAfterFailure(rig.store, logger, await claimedContext(rig));
    expect(lines.join("\n")).toContain("its external id claim could not be released");
  });
});

describe("the link, update and delete steps", () => {
  it("LinkChildOrganization answers a lifecycle fault INTERNAL", async () => {
    const lifecycle = {
      onChildOrganizationLinked: () => Promise.reject(STORE_DOWN),
    } as unknown as ResourceAuthorizationLifecycle;
    const error = await refusal(() =>
      newLinkChildOrganizationStep(lifecycle).execute(createContext(org("org_c", "org_p"))),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toContain("failed to link the child organization");
  });

  it("PreserveChildLink answers an update that reached it without its loaded row INTERNAL", async () => {
    const error = await refusal(() => newPreserveChildLinkStep().execute(createContext(org("org_c"))));
    expect(error.code).toBe(Code.Internal);
  });

  it("RefuseDeletingParent answers a missing loaded row and an index fault INTERNAL", async () => {
    const unloaded = await refusal(() =>
      newRefuseDeletingParentStep<typeof OrganizationIdSchema>(fakeStore().store).execute(
        deleteContext(undefined),
      ),
    );
    expect(unloaded.code).toBe(Code.Internal);

    const fault = await refusal(() =>
      newRefuseDeletingParentStep<typeof OrganizationIdSchema>(
        fakeStore({ queryFault: STORE_DOWN }).store,
      ).execute(deleteContext(org("org_p"))),
    );
    expect(fault.code).toBe(Code.Internal);
    expect(fault.rawMessage).toContain("failed to read the organization's child organizations");
  });

  it("RefuseDeletingParent refuses a parent with a live child and passes one whose children are all being deleted", async () => {
    const indexed = [indexedRow(org("org_c1", "org_p")), indexedRow(org("org_c2", "org_p"))];
    const live = await refusal(() =>
      newRefuseDeletingParentStep<typeof OrganizationIdSchema>(
        fakeStore({ indexed, deleting: ["org_c1"] }).store,
      ).execute(deleteContext(org("org_p"))),
    );
    expect(live.code).toBe(Code.FailedPrecondition);
    await newRefuseDeletingParentStep<typeof OrganizationIdSchema>(
      fakeStore({ indexed, deleting: ["org_c1", "org_c2"] }).store,
    ).execute(deleteContext(org("org_p")));
    const pending = await refusal(() =>
      newRefuseDeletingParentStep<typeof OrganizationIdSchema>(
        fakeStore({ indexed, deleting: ["org_c1"], pending: ["org_c2"] }).store,
      ).execute(deleteContext(org("org_p"))),
    );
    expect(pending.code, "a child whose own delete may still be refused").toBe(Code.FailedPrecondition);
  });

  it("ReleaseExternalId logs a release fault and lets the delete stand", async () => {
    const { logger, lines } = capturingLogger();
    await newReleaseExternalIdStep<typeof OrganizationIdSchema>(
      fakeStore({ releaseFault: STORE_DOWN }).store,
      logger,
    ).execute(deleteContext(org("org_c", "org_p", "cust-1")));
    expect(lines.join("\n")).toContain("its external id could not be released");
  });
});
