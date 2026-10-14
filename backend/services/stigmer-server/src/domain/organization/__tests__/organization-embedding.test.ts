/**
 * Pins an organization's embedding steps (../embedding.ts) one by one, over
 * a store fake, where a fault the composed suite cannot provoke can be:
 *
 *   - PersistEmbedding answers an organization deleted between the load and
 *     the write NotFound, and any other store fault INTERNAL;
 *   - PreserveEmbedding and BuildEmbeddingState answer a chain that reached
 *     them without its loaded row INTERNAL, rather than writing settings
 *     over nothing.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import {
  newBuildEmbeddingStateStep,
  newPersistEmbeddingStep,
  newPreserveEmbeddingStep,
} from "../embedding.js";

const ORG = "org_01jacme";

function orgContext(): RequestContext<typeof OrganizationSchema> {
  return new RequestContext(
    OrganizationSchema,
    create(OrganizationSchema, {
      metadata: { id: ORG, name: "acme", slug: "acme" },
      spec: { embedding: { createAccountsOnSignIn: true } },
    }),
    testCallerIdentity({ identityId: "acc_admin" }),
    ApiResourceKind.organization,
  );
}

/** A store whose one write fails with `fault`. */
function failingStore(fault: Error): Store {
  return {
    updateResource: (): Promise<Organization> => Promise.reject(fault),
  } as unknown as Store;
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

describe("PersistEmbedding", () => {
  it("answers an organization deleted between the load and the write NotFound", async () => {
    const error = await refusal(() =>
      newPersistEmbeddingStep(failingStore(new ResourceNotFoundError(ORG))).execute(orgContext()),
    );
    expect(error.code).toBe(Code.NotFound);
  });

  it("answers any other store fault INTERNAL", async () => {
    const error = await refusal(() =>
      newPersistEmbeddingStep(failingStore(new Error("store unreachable"))).execute(orgContext()),
    );
    expect([error.code, error.rawMessage]).toEqual([Code.Internal, "failed to save organization"]);
  });
});

describe("the steps that read the loaded row", () => {
  it("answers a chain that reached them without it INTERNAL", async () => {
    for (const step of [newPreserveEmbeddingStep(), newBuildEmbeddingStateStep()]) {
      const error = await refusal(() => step.execute(orgContext()));
      expect(error.code, step.name).toBe(Code.Internal);
    }
  });
});
