/**
 * Pins the delete's own steps (../deletion.ts) over a real SQLite store,
 * and the two interleavings of a delete racing a child create under the
 * same parent (https://github.com/stigmer/stigmer/issues/1917), each
 * chain's steps run by hand at the reads that race.
 *
 * What it pins:
 *   - MarkDeleting has one winner; the loser answers the not-found copy;
 *   - AcceptPurge accepts a pending mark and kicks the purge, and fails
 *     when the mark is no longer pending;
 *   - unmarkAfterFailure removes the request's own pending mark and
 *     nothing else;
 *   - an organization update that loaded the row before the mark and
 *     writes it after cannot erase the mark (it is not on the row);
 *   - the child create that persists before the delete's mark is seen by
 *     the delete's second RefuseDeletingParent; the one that persists after
 *     sees its parent's mark, deletes itself and answers
 *     ORGANIZATION_PARENT_DELETING. In neither order is a child left live
 *     under a parent being deleted.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationIdSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/io_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { newPersistStep } from "../../../pipeline/steps/persist.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { ORGANIZATION_HAS_CHILDREN, newRefuseDeletingParentStep } from "../children.js";
import {
  ORGANIZATION_PARENT_DELETING,
  newAcceptPurgeStep,
  newMarkDeletingStep,
  newRefuseParentDeletingStep,
  unmarkAfterFailure,
} from "../deletion.js";

const PARENT = "org_01kparentparentparentparent";
const CHILD = "org_01kchildchildchildchildchi";

let dir: string;
let store: SqliteStore;
let kicked: string[];
const purge = {
  kick(org: string) {
    kicked.push(org);
  },
};

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "org-deletion-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: LIST_INDEXES,
  });
  kicked = [];
  await store.saveResource(
    ApiResourceKind.organization,
    PARENT,
    OrganizationSchema,
    parentRow(),
  );
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

function parentRow(): Organization {
  return create(OrganizationSchema, { metadata: { id: PARENT, name: "acme" } });
}

function deleteContext(organization: Organization) {
  const ctx = new RequestContext(
    OrganizationIdSchema,
    create(OrganizationIdSchema, { value: organization.metadata?.id ?? "" }),
    testCallerIdentity(),
    ApiResourceKind.organization,
  );
  ctx.set(EXISTING_RESOURCE_KEY, organization);
  return ctx;
}

function childCreateContext() {
  return new RequestContext(
    OrganizationSchema,
    create(OrganizationSchema, {
      metadata: { id: CHILD, name: "cust" },
      spec: { parentOrg: PARENT },
    }),
    testCallerIdentity(),
    ApiResourceKind.organization,
  );
}

function reasonOf(error: ConnectError): string | undefined {
  return error.findDetails(ErrorInfoSchema)[0]?.reason;
}

async function refusal(
  run: () => Promise<void> | void,
): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

describe("the delete's own steps", () => {
  it("MarkDeleting has one winner; the loser answers not found", async () => {
    await newMarkDeletingStep(store).execute(deleteContext(parentRow()));
    const lost = await refusal(() =>
      newMarkDeletingStep(store).execute(deleteContext(parentRow())),
    );
    expect(lost.code).toBe(Code.NotFound);
    expect(lost.rawMessage).toBe(`Organization not found: ${PARENT}`);
  });

  it("AcceptPurge accepts a pending mark and kicks the purge, and fails once the mark is gone", async () => {
    const ctx = deleteContext(parentRow());
    await newMarkDeletingStep(store).execute(ctx);
    await newAcceptPurgeStep(store, purge).execute(ctx);
    expect((await store.organizationDeletions.get(PARENT))?.phase).toBe(
      "accepted",
    );
    expect(kicked).toEqual([PARENT]);
    const again = await refusal(() =>
      newAcceptPurgeStep(store, purge).execute(deleteContext(parentRow())),
    );
    expect(again.code).toBe(Code.Internal);
  });

  it("an organization update that loaded the row before the mark and writes after it leaves the organization deleting", async () => {
    // The update's load, then the delete's mark, then the update's write of
    // what it loaded: the mark is not on the row, so the write cannot erase it.
    const loaded = await store.getResource(
      ApiResourceKind.organization,
      PARENT,
      OrganizationSchema,
    );
    await newMarkDeletingStep(store).execute(deleteContext(parentRow()));
    loaded.metadata = { ...loaded.metadata!, name: "acme, updated" };
    await store.saveResource(
      ApiResourceKind.organization,
      PARENT,
      OrganizationSchema,
      loaded,
    );
    expect(await store.organizationDeletions.isDeleting(PARENT)).toBe(true);
  });

  it("unmarkAfterFailure removes the request's own pending mark, and only that", async () => {
    const unmarked = deleteContext(parentRow());
    await unmarkAfterFailure(store, silentLogger, unmarked);
    await newMarkDeletingStep(store).execute(unmarked);
    await unmarkAfterFailure(store, silentLogger, unmarked);
    expect(await store.organizationDeletions.isDeleting(PARENT)).toBe(false);

    const accepted = deleteContext(parentRow());
    await newMarkDeletingStep(store).execute(accepted);
    await newAcceptPurgeStep(store, purge).execute(accepted);
    await unmarkAfterFailure(store, silentLogger, accepted);
    expect(await store.organizationDeletions.isDeleting(PARENT)).toBe(true);

    const notMine = deleteContext(parentRow());
    await unmarkAfterFailure(store, silentLogger, notMine);
    expect(await store.organizationDeletions.isDeleting(PARENT)).toBe(true);
  });
});

describe("a delete racing a child create (stigmer#1917)", () => {
  it("a child persisted before the mark is seen by the delete's second check, which unmarks", async () => {
    const del = deleteContext(parentRow());
    const created = childCreateContext();
    await newRefuseDeletingParentStep(store).execute(del);
    // The create's own check passed (its parent was live); it persists now.
    await newPersistStep(store).execute(created);
    await newMarkDeletingStep(store).execute(del);
    const refused = await refusal(() =>
      newRefuseDeletingParentStep(store).execute(del),
    );
    await unmarkAfterFailure(store, silentLogger, del);
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(reasonOf(refused)).toBe(ORGANIZATION_HAS_CHILDREN);
    expect(await store.organizationDeletions.isDeleting(PARENT)).toBe(false);
    await newRefuseParentDeletingStep(store, purge).execute(created);
    expect(await store.organizationDeletions.isDeleting(CHILD)).toBe(false);
  });

  it("a child persisted after the mark sees it and is deleted with its parent", async () => {
    const del = deleteContext(parentRow());
    const created = childCreateContext();
    await newRefuseDeletingParentStep(store).execute(del);
    await newMarkDeletingStep(store).execute(del);
    // The delete's second check runs before the child's row lands.
    await newRefuseDeletingParentStep(store).execute(del);
    await newPersistStep(store).execute(created);
    const refused = await refusal(() =>
      newRefuseParentDeletingStep(store, purge).execute(created),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(reasonOf(refused)).toBe(ORGANIZATION_PARENT_DELETING);
    expect((await store.organizationDeletions.get(CHILD))?.phase).toBe(
      "accepted",
    );
    expect(kicked).toEqual([CHILD]);
  });
});
