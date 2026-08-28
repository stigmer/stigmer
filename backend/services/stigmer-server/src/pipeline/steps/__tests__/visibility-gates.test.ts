/**
 * Pins the PUBLIC-visibility operator gates (C2 Stage 3, the Java
 * PublicVisibilityEscalationPolicy port): the create door fires only on a
 * new state declaring PUBLIC, the update door only on an ESCALATION to
 * public (re-asserting stored public passes), both answer the Java deny
 * copy on denial and pass under the permissive default (OSS
 * byte-identity), internal callers skip, and a missing loaded target is
 * a loud wiring fault.
 */
import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { RequestContext } from "../../request-context.js";
import { newPermissiveSingleTeamAuthorizer } from "../authorize.js";
import {
  newAuthorizeVisibilityTransitionStep,
  newGuardPublicVisibilityStep,
  PUBLIC_VISIBILITY_DENY_MESSAGE,
} from "../visibility-gates.js";

const USER: CallerIdentity = {
  identityId: "ida_alice",
  callerClass: "user",
  issuer: "stigmer",
  rawToken: "tok",
};

const TARGET_KEY = "updateVisibilityAgent";

function denying(observed?: AuthzCheck[]): Authorizer {
  return {
    authorize: (_caller, check) => {
      observed?.push(check);
      return Promise.resolve({ kind: "deny", reason: "" });
    },
  };
}

function createCtx(
  visibility: ApiResourceVisibility,
): RequestContext<typeof AgentSchema> {
  return new RequestContext(
    AgentSchema,
    create(AgentSchema, { metadata: { name: "a", visibility } }),
    USER,
    ApiResourceKind.agent,
  );
}

type UvDesc = typeof AgentCommandController.method.updateVisibility.input;

function updateCtx(
  requested: ApiResourceVisibility,
  stored: ApiResourceVisibility | undefined,
): RequestContext<UvDesc> {
  const ctx = new RequestContext(
    AgentCommandController.method.updateVisibility.input,
    create(UpdateVisibilityInputSchema, {
      resourceId: "agt_1",
      visibility: requested,
    }),
    USER,
    ApiResourceKind.agent,
  );
  if (stored !== undefined) {
    ctx.set(
      TARGET_KEY,
      create(AgentSchema, { metadata: { visibility: stored } }),
    );
  }
  return ctx;
}

describe("GuardPublicVisibility (the create door)", () => {
  it("denies a PUBLIC create for non-operators with the Java copy", async () => {
    const step = newGuardPublicVisibilityStep<typeof AgentSchema>(denying());
    const error = await step
      .execute(createCtx(ApiResourceVisibility.visibility_public))
      ?.catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
    expect((error as ConnectError).rawMessage).toBe(
      PUBLIC_VISIBILITY_DENY_MESSAGE,
    );
  });

  it("non-public creates never reach the Authorizer (the lazy contract)", async () => {
    const observed: AuthzCheck[] = [];
    const step = newGuardPublicVisibilityStep<typeof AgentSchema>(
      denying(observed),
    );
    await step.execute(createCtx(ApiResourceVisibility.visibility_org));
    expect(observed).toEqual([]);
  });

  it("the permissive default allows public creates (OSS byte-identity)", async () => {
    const step = newGuardPublicVisibilityStep<typeof AgentSchema>(
      newPermissiveSingleTeamAuthorizer(),
    );
    await expect(
      Promise.resolve(
        step.execute(createCtx(ApiResourceVisibility.visibility_public)),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("AuthorizeVisibilityTransition (the update door)", () => {
  it("denies escalation to public with the operator check", async () => {
    const observed: AuthzCheck[] = [];
    const step = newAuthorizeVisibilityTransitionStep<UvDesc>(
      TARGET_KEY,
      denying(observed),
    );
    const error = await step
      .execute(
        updateCtx(
          ApiResourceVisibility.visibility_public,
          ApiResourceVisibility.visibility_org,
        ),
      )
      ?.catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
    expect((error as ConnectError).rawMessage).toBe(
      PUBLIC_VISIBILITY_DENY_MESSAGE,
    );
    expect(observed).toEqual([
      {
        permission: IamPermission.can_set_public_visibility,
        resourceKind: ApiResourceKind.platform,
        resourceId: "stigmer",
      },
    ]);
  });

  it("re-asserting a stored PUBLIC is not an escalation", async () => {
    const step = newAuthorizeVisibilityTransitionStep<UvDesc>(
      TARGET_KEY,
      denying(),
    );
    await expect(
      Promise.resolve(
        step.execute(
          updateCtx(
            ApiResourceVisibility.visibility_public,
            ApiResourceVisibility.visibility_public,
          ),
        ),
      ),
    ).resolves.toBeUndefined();
  });

  it("non-public targets never reach the Authorizer", async () => {
    const observed: AuthzCheck[] = [];
    const step = newAuthorizeVisibilityTransitionStep<UvDesc>(
      TARGET_KEY,
      denying(observed),
    );
    await step.execute(
      updateCtx(
        ApiResourceVisibility.visibility_org,
        ApiResourceVisibility.visibility_public,
      ),
    );
    expect(observed).toEqual([]);
  });

  it("a missing loaded target is a loud wiring fault, never a silent pass", async () => {
    const step = newAuthorizeVisibilityTransitionStep<UvDesc>(
      TARGET_KEY,
      denying(),
    );
    const error = await step
      .execute(updateCtx(ApiResourceVisibility.visibility_public, undefined))
      ?.catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });
});
