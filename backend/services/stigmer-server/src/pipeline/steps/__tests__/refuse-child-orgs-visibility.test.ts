/**
 * Pins the refusal of visibility_child_orgs in a child organization
 * (../validate-visibility.ts) against an in-memory organization row, so
 * the update step and the read faults are reachable: the create chains
 * and the composed suite (domain/organization/__tests__/children.test.ts)
 * prove the create path through the real stack.
 *
 * What it pins:
 *   - the update step refuses raising a child's blueprint to
 *     visibility_child_orgs and admits its parent's, asking nothing for
 *     any other level;
 *   - an update step that ran without a loaded row naming its
 *     organization answers INTERNAL;
 *   - the create step passes a request with no metadata;
 *   - the shared check leaves a missing organization to the lane and
 *     answers a read fault INTERNAL.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { RequestContext } from "../../request-context.js";
import {
  CHILD_ORGS_VISIBILITY_IN_CHILD_MESSAGE,
  newRefuseChildOrgsVisibilityInChildStep,
  newRefuseChildOrgsVisibilityInChildUpdateStep,
  refuseChildOrgsVisibilityInChild,
} from "../validate-visibility.js";

const LOADED_KEY = "loadedAgent";
const STORE_DOWN = new Error("store down");

/** Organization rows by id: org_child is a child of org_parent; org_down's read fails. */
function organizations(): { store: Store; reads: string[] } {
  const reads: string[] = [];
  const store = {
    async getResource(_kind: ApiResourceKind, id: string) {
      reads.push(id);
      if (id === "org_down") {
        throw STORE_DOWN;
      }
      if (id === "org_child") {
        return create(OrganizationSchema, { metadata: { id }, spec: { parentOrg: "org_parent" } });
      }
      if (id === "org_parent") {
        return create(OrganizationSchema, { metadata: { id } });
      }
      throw new ResourceNotFoundError(`organization ${id}`);
    },
  } as unknown as Store;
  return { store, reads };
}

function updateIn(org: string | undefined, visibility: ApiResourceVisibility) {
  const ctx = new RequestContext(
    UpdateVisibilityInputSchema,
    create(UpdateVisibilityInputSchema, { resourceId: "agt_1", visibility }),
    testCallerIdentity(),
    ApiResourceKind.agent,
  );
  if (org !== undefined) {
    ctx.set(LOADED_KEY, create(AgentSchema, { metadata: { id: "agt_1", org } }));
  }
  return ctx;
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

describe("RefuseChildOrgsVisibilityInChildUpdate", () => {
  it("refuses raising a child's blueprint to visibility_child_orgs and admits its parent's", async () => {
    const { store } = organizations();
    const step = newRefuseChildOrgsVisibilityInChildUpdateStep(store, LOADED_KEY);
    const error = await refusal(() =>
      step.execute(updateIn("org_child", ApiResourceVisibility.visibility_child_orgs)),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(CHILD_ORGS_VISIBILITY_IN_CHILD_MESSAGE);
    await step.execute(updateIn("org_parent", ApiResourceVisibility.visibility_child_orgs));
  });

  it("asks nothing for any other level", async () => {
    const { store, reads } = organizations();
    await newRefuseChildOrgsVisibilityInChildUpdateStep(store, LOADED_KEY).execute(
      updateIn("org_child", ApiResourceVisibility.visibility_org),
    );
    expect(reads).toEqual([]);
  });

  it("answers a run without a loaded row naming its organization INTERNAL", async () => {
    const { store } = organizations();
    const step = newRefuseChildOrgsVisibilityInChildUpdateStep(store, LOADED_KEY);
    for (const org of [undefined, ""]) {
      const error = await refusal(() =>
        step.execute(updateIn(org, ApiResourceVisibility.visibility_child_orgs)),
      );
      expect(error.code, String(org)).toBe(Code.Internal);
    }
  });
});

describe("RefuseChildOrgsVisibilityInChild and the shared check", () => {
  it("passes a create that carries no metadata", async () => {
    const { store, reads } = organizations();
    await newRefuseChildOrgsVisibilityInChildStep<typeof AgentSchema>(store).execute(
      new RequestContext(AgentSchema, create(AgentSchema), testCallerIdentity(), ApiResourceKind.agent),
    );
    expect(reads).toEqual([]);
  });

  it("leaves a missing organization to the lane and answers a read fault INTERNAL", async () => {
    const { store } = organizations();
    await refuseChildOrgsVisibilityInChild(store, "org_gone", ApiResourceVisibility.visibility_child_orgs);
    const error = await refusal(() =>
      refuseChildOrgsVisibilityInChild(store, "org_down", ApiResourceVisibility.visibility_child_orgs),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toContain("failed to read the owning organization");
  });
});
