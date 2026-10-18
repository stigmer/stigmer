/**
 * Pins how the Environment's steps answer a chain built wrong and a store
 * that fails, which no composed server produces:
 *
 *   - `chainResult` hands back what a chain left, and answers INTERNAL,
 *     naming what was missing, when the chain left nothing;
 *   - GuardEnvironmentUnreferenced answers INTERNAL when run without a
 *     loaded target, and when the store cannot list what names the
 *     Environment or read its organization; an organization that no longer
 *     exists holds nothing;
 *   - the visibility update's load answers NOT_FOUND for a missing row and
 *     INTERNAL for a store fault, and its persist the same for a row gone
 *     since the load and for a failed write.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { EnvironmentSchema } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";

import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { newLoadEnvironmentForVisibilityUpdateStep, newPersistEnvironmentVisibilityStep } from "../controller.js";
import { chainResult, newGuardEnvironmentUnreferencedStep } from "../steps.js";

const ENVIRONMENT = create(EnvironmentSchema, { metadata: { id: "env_01box", org: "org_acme", slug: "box" } });

/** A store answering only what a test names; anything else is a test mistake. */
function storeWith(methods: Partial<Record<"listResources" | "getResource" | "updateResource", (...args: unknown[]) => Promise<unknown>>>): Store {
  return methods as unknown as Store;
}

async function codeOf(work: void | Promise<void>): Promise<ConnectError> {
  try {
    await work;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

function deleteContext(loaded: boolean): RequestContext<typeof EnvironmentCommandController.method.delete.input> {
  const ctx = new RequestContext(
    EnvironmentCommandController.method.delete.input,
    create(EnvironmentCommandController.method.delete.input, { value: "env_01box" }),
    testCallerIdentity(),
    ApiResourceKind.environment,
  );
  if (loaded) ctx.set(EXISTING_RESOURCE_KEY, ENVIRONMENT);
  return ctx;
}

function visibilityContext(): RequestContext<typeof EnvironmentCommandController.method.updateVisibility.input> {
  return new RequestContext(
    EnvironmentCommandController.method.updateVisibility.input,
    create(EnvironmentCommandController.method.updateVisibility.input, {
      resourceId: "env_01box",
      visibility: ApiResourceVisibility.visibility_private,
    }),
    testCallerIdentity(),
    ApiResourceKind.environment,
  );
}

describe("chainResult", () => {
  it("hands back what the chain left", () => {
    expect(chainResult<string>("left", "the value")).toBe("left");
    expect(chainResult<boolean>(false, "the decision")).toBe(false);
  });

  it("answers INTERNAL, naming what was missing, when the chain left nothing", () => {
    expect(() => chainResult(undefined, "Environment list")).toThrow(
      expect.objectContaining({ code: Code.Internal, rawMessage: "Environment list not found in context" }),
    );
  });
});

describe("GuardEnvironmentUnreferenced", () => {
  it("answers INTERNAL when the chain loaded no target", async () => {
    const refused = await codeOf(newGuardEnvironmentUnreferencedStep(storeWith({})).execute(deleteContext(false)));
    expect(refused.code).toBe(Code.Internal);
    expect(refused.rawMessage).toBe("the loaded Environment not found in context");
  });

  it("answers INTERNAL when the store cannot list what names the Environment", async () => {
    const store = storeWith({ listResources: async () => Promise.reject(new Error("disk unreadable")) });
    const refused = await codeOf(newGuardEnvironmentUnreferencedStep(store).execute(deleteContext(true)));
    expect(refused.code).toBe(Code.Internal);
    expect(refused.rawMessage).toBe("failed to read what names the environment");
  });

  it("holds nothing for an organization that no longer exists", async () => {
    const store = storeWith({
      listResources: async () => [],
      getResource: async () => Promise.reject(new ResourceNotFoundError("organization org_acme")),
    });
    await expect(newGuardEnvironmentUnreferencedStep(store).execute(deleteContext(true))).resolves.toBeUndefined();
  });

  it("answers INTERNAL when the store cannot read the organization", async () => {
    const store = storeWith({
      listResources: async () => [],
      getResource: async () => Promise.reject(new Error("disk unreadable")),
    });
    const refused = await codeOf(newGuardEnvironmentUnreferencedStep(store).execute(deleteContext(true)));
    expect(refused.code).toBe(Code.Internal);
    expect(refused.rawMessage).toBe("failed to read what names the environment");
  });
});

describe("the visibility update's load and persist", () => {
  it("load answers NOT_FOUND for a missing row and INTERNAL for a store fault", async () => {
    const missing = storeWith({ getResource: async () => Promise.reject(new ResourceNotFoundError("environment env_01box")) });
    expect((await codeOf(newLoadEnvironmentForVisibilityUpdateStep(missing).execute(visibilityContext()))).code).toBe(Code.NotFound);
    const faulty = storeWith({ getResource: async () => Promise.reject(new Error("disk unreadable")) });
    const refused = await codeOf(newLoadEnvironmentForVisibilityUpdateStep(faulty).execute(visibilityContext()));
    expect(refused.code).toBe(Code.Internal);
    expect(refused.rawMessage).toBe("failed to load environment");
  });

  it("persist answers NOT_FOUND for a row gone since the load and INTERNAL for a failed write", async () => {
    const persistWith = async (failure: Error): Promise<ConnectError> => {
      const store = storeWith({
        getResource: async () => ENVIRONMENT,
        updateResource: async () => Promise.reject(failure),
      });
      const ctx = visibilityContext();
      await newLoadEnvironmentForVisibilityUpdateStep(store).execute(ctx);
      return codeOf(newPersistEnvironmentVisibilityStep(store).execute(ctx));
    };
    expect((await persistWith(new ResourceNotFoundError("environment env_01box"))).code).toBe(Code.NotFound);
    const refused = await persistWith(new Error("disk full"));
    expect(refused.code).toBe(Code.Internal);
    expect(refused.rawMessage).toBe("failed to save environment");
  });
});
