/**
 * Pins the AuthorizeResolvedTarget step's contract: a thin shell around the
 * shared evaluation over the questions a PURE resolver names. Every target
 * reaches the Authorizer as exactly the three fields of a check (never the
 * copy); the questions are asked in the resolver's order and the first
 * refusal answers; an empty list asks nothing; a throwing resolver surfaces
 * as the chain's Internal, never as an admitted request; deny carries the
 * target's copy, not-found the load-first NOT_FOUND, unavailable INTERNAL;
 * the `internal` class alone skips, and a propagated in-process caller does
 * not (that arm is a resolver's to model, never the step's). The step runs
 * under the shared name by default and under a caller-supplied frozen name
 * for the lanes that predate it.
 *
 * Also pins `loadedTargetAsMethod`: the reads' resolver asks the sibling
 * `get` annotation about the LOADED row's id — the `get`'s kind,
 * permission and byte-pinned copy, the loader's id — and is a no-op when
 * that `get` is itself a skip, so a read by reference is never stricter
 * than the read by id and never laxer. A missing loaded row is a thrown
 * invariant, not an empty answer.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { RequestContext } from "../../request-context.js";
import {
  AUTHORIZATION_UNAVAILABLE_MESSAGE,
  type AuthorizationTarget,
} from "../authorize.js";
import {
  AUTHORIZE_RESOLVED_TARGET_STEP,
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
} from "../authorize-resolved-target.js";
import { TARGET_RESOURCE_KEY } from "../load-target.js";

function fakeAuthorizer(decide: (check: AuthzCheck) => AuthzDecision): {
  authorizer: Authorizer;
  checks: AuthzCheck[];
} {
  const checks: AuthzCheck[] = [];
  return {
    checks,
    authorizer: {
      authorize(_caller, check) {
        checks.push(check);
        return Promise.resolve(decide(check));
      },
    },
  };
}

const allow = (): AuthzDecision => ({ kind: "allow" });

async function captureError(
  run: () => void | Promise<void>,
): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the step to reject");
}

const ORG_QUESTION: AuthorizationTarget = {
  permission: IamPermission.can_create_agent_instance,
  resourceKind: ApiResourceKind.organization,
  resourceId: "acme",
  deniedMessage: "unauthorized to create agent instance in this organization",
};

const PARENT_QUESTION: AuthorizationTarget = {
  permission: IamPermission.can_create_instance,
  resourceKind: ApiResourceKind.agent,
  resourceId: "agt_01parent",
  deniedMessage: "You don't have permission to create instances of this agent",
};

function agentCtx(caller = testCallerIdentity()) {
  return new RequestContext(
    AgentSchema,
    create(AgentSchema, { metadata: { name: "a", org: "acme" } }),
    caller,
    ApiResourceKind.agent,
  );
}

describe("AuthorizeResolvedTarget — the step shell", () => {
  it("runs under the shared name by default and under a frozen name when a folded lane supplies one", () => {
    const { authorizer } = fakeAuthorizer(allow);
    expect(newAuthorizeResolvedTargetStep(authorizer, () => []).name).toBe(
      AUTHORIZE_RESOLVED_TARGET_STEP,
    );
    expect(
      newAuthorizeResolvedTargetStep(
        authorizer,
        () => [],
        "AuthorizeResolvedPlugin",
      ).name,
    ).toBe("AuthorizeResolvedPlugin");
  });

  it("asks nothing when the resolver answers an empty list", async () => {
    const { authorizer, checks } = fakeAuthorizer(() => ({
      kind: "deny",
      reason: "would have refused",
    }));
    await newAuthorizeResolvedTargetStep(authorizer, () => []).execute(
      agentCtx(),
    );
    expect(checks).toEqual([]);
  });

  it("asks each question in the resolver's order, as a bare check without the copy", async () => {
    const { authorizer, checks } = fakeAuthorizer(allow);
    await newAuthorizeResolvedTargetStep(authorizer, () => [
      ORG_QUESTION,
      PARENT_QUESTION,
    ]).execute(agentCtx());
    expect(checks).toEqual([
      {
        permission: IamPermission.can_create_agent_instance,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
      {
        permission: IamPermission.can_create_instance,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_01parent",
      },
    ]);
  });

  it("the first refusal answers, with THAT question's copy, and later questions are never asked", async () => {
    const { authorizer, checks } = fakeAuthorizer((check) =>
      check.resourceKind === ApiResourceKind.organization
        ? { kind: "deny", reason: "" }
        : allow(),
    );
    const error = await captureError(() =>
      newAuthorizeResolvedTargetStep(authorizer, () => [
        ORG_QUESTION,
        PARENT_QUESTION,
      ]).execute(agentCtx()),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(ORG_QUESTION.deniedMessage);
    expect(checks).toHaveLength(1);
  });

  it("not-found answers the load-first NOT_FOUND for the target", async () => {
    const { authorizer } = fakeAuthorizer(() => ({ kind: "not-found" }));
    const error = await captureError(() =>
      newAuthorizeResolvedTargetStep(authorizer, () => [
        PARENT_QUESTION,
      ]).execute(agentCtx()),
    );
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toContain("agt_01parent");
  });

  it("unavailable is INTERNAL with the sanitized copy", async () => {
    const { authorizer } = fakeAuthorizer(() => ({
      kind: "unavailable",
      cause: new Error("backend down"),
    }));
    const error = await captureError(() =>
      newAuthorizeResolvedTargetStep(authorizer, () => [
        PARENT_QUESTION,
      ]).execute(agentCtx()),
    );
    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(AUTHORIZATION_UNAVAILABLE_MESSAGE);
  });

  it("a resolver that throws surfaces its error; a broken chain invariant never admits the request", async () => {
    const { authorizer, checks } = fakeAuthorizer(allow);
    await expect(
      newAuthorizeResolvedTargetStep(authorizer, () => {
        throw new Error("parent not found in context");
      }).execute(agentCtx()),
    ).rejects.toThrow("parent not found in context");
    expect(checks).toEqual([]);
  });

  it("the internal class alone skips; a propagated in-process caller is still asked", async () => {
    const denying = fakeAuthorizer(() => ({ kind: "deny", reason: "" }));
    await newAuthorizeResolvedTargetStep(denying.authorizer, () => [
      PARENT_QUESTION,
    ]).execute(agentCtx(testCallerIdentity({ callerClass: "internal" })));
    expect(denying.checks).toEqual([]);

    const error = await captureError(() =>
      newAuthorizeResolvedTargetStep(denying.authorizer, () => [
        PARENT_QUESTION,
      ]).execute(
        agentCtx(
          testCallerIdentity({ callerClass: "user", origin: "in-process" }),
        ),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
  });
});

function referenceCtx(loaded?: unknown) {
  const ctx = new RequestContext(
    ApiResourceReferenceSchema,
    create(ApiResourceReferenceSchema, { org: "acme", slug: "helper" }),
    testCallerIdentity(),
    ApiResourceKind.agent,
  );
  if (loaded !== undefined) {
    ctx.set(TARGET_RESOURCE_KEY, loaded);
  }
  return ctx;
}

describe("loadedTargetAsMethod — a read by reference asks what its get asks", () => {
  it("names the get annotation's kind, permission and copy on the LOADED row's id", async () => {
    const { authorizer, checks } = fakeAuthorizer(() => ({
      kind: "deny",
      reason: "",
    }));
    const loaded = create(AgentSchema, {
      metadata: { id: "agt_01loaded", name: "helper", org: "acme" },
    });
    const error = await captureError(() =>
      newAuthorizeResolvedTargetStep(
        authorizer,
        loadedTargetAsMethod(AgentQueryController.method.get),
      ).execute(referenceCtx(loaded)),
    );
    expect(checks).toEqual([
      {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_01loaded",
      },
    ]);
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe("unauthorized to get agent");
  });

  it("is a no-op when the method it is keyed on is itself a skip — never stricter than the annotation it mirrors", async () => {
    // Keyed on a skip descriptor (the reference RPC's own), the resolver
    // answers nothing: the annotation, not the step, owns the skip arms.
    const { authorizer, checks } = fakeAuthorizer(() => ({
      kind: "deny",
      reason: "",
    }));
    const loaded = create(AgentSchema, {
      metadata: { id: "agt_01loaded", name: "helper", org: "acme" },
    });
    await newAuthorizeResolvedTargetStep(
      authorizer,
      loadedTargetAsMethod(AgentQueryController.method.getByReference),
    ).execute(referenceCtx(loaded));
    expect(checks).toEqual([]);
  });

  it("a missing loaded row is a thrown invariant, never an empty answer", async () => {
    const { authorizer, checks } = fakeAuthorizer(allow);
    await expect(
      newAuthorizeResolvedTargetStep(
        authorizer,
        loadedTargetAsMethod(AgentQueryController.method.get),
      ).execute(referenceCtx()),
    ).rejects.toThrow(TARGET_RESOURCE_KEY);
    expect(checks).toEqual([]);
  });
});
