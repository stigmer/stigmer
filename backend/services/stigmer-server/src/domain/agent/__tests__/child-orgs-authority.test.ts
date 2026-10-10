/**
 * Pins RequireChildOrgsAuthority (../child-orgs-authority.ts): sharing an
 * agent with child organizations asks the organization's
 * `can_manage_child_orgs` on create and on updateVisibility, so a member
 * who may create and own agents still cannot put one in front of every
 * child organization. Every other level asks nothing; a denial carries the
 * "ask an admin" copy; updateVisibility asks the loaded agent's
 * organization, and a chain that reached it without the loaded row is a
 * fault.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { Authorizer, AuthzCheck, AuthzDecision } from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  CHILD_ORGS_SHARE_DENIED_MESSAGE,
  newRequireChildOrgsAuthorityOnUpdateStep,
  newRequireChildOrgsAuthorityStep,
} from "../child-orgs-authority.js";

const ORG = "org_01jacme";
const LOADED = "loadedAgent";

function recording(decision: AuthzDecision): { authorizer: Authorizer; asked: AuthzCheck[] } {
  const asked: AuthzCheck[] = [];
  return {
    asked,
    authorizer: {
      authorize: (_caller, check) => {
        asked.push(check);
        return Promise.resolve(decision);
      },
    },
  };
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

function createContext(visibility: ApiResourceVisibility) {
  return new RequestContext(
    AgentSchema,
    create(AgentSchema, { metadata: { org: ORG, name: "helper", visibility } }),
    testCallerIdentity({ identityId: "acc_member" }),
    ApiResourceKind.agent,
  );
}

function updateContext(visibility: ApiResourceVisibility, loaded: boolean) {
  const ctx = new RequestContext(
    UpdateVisibilityInputSchema,
    create(UpdateVisibilityInputSchema, { resourceId: "agt_1", visibility }),
    testCallerIdentity({ identityId: "acc_member" }),
    ApiResourceKind.agent,
  );
  if (loaded) {
    ctx.set(LOADED, create(AgentSchema, { metadata: { id: "agt_1", org: ORG } }));
  }
  return ctx;
}

const DENY: AuthzDecision = { kind: "deny", reason: "" };

describe("RequireChildOrgsAuthority on create", () => {
  it("asks can_manage_child_orgs on the organization for a child-organizations level", async () => {
    const { authorizer, asked } = recording({ kind: "allow" });
    await newRequireChildOrgsAuthorityStep(authorizer).execute(
      createContext(ApiResourceVisibility.visibility_child_orgs),
    );
    expect(asked).toEqual([
      {
        permission: IamPermission.can_manage_child_orgs,
        resourceKind: ApiResourceKind.organization,
        resourceId: ORG,
      },
    ]);
  });

  it("refuses a member with the ask-an-admin copy", async () => {
    const { authorizer } = recording(DENY);
    const error = await refusal(() =>
      newRequireChildOrgsAuthorityStep(authorizer).execute(
        createContext(ApiResourceVisibility.visibility_child_orgs),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(CHILD_ORGS_SHARE_DENIED_MESSAGE);
  });

  it("asks nothing for a private or organization-wide agent", async () => {
    const { authorizer, asked } = recording(DENY);
    await newRequireChildOrgsAuthorityStep(authorizer).execute(
      createContext(ApiResourceVisibility.visibility_org),
    );
    await newRequireChildOrgsAuthorityStep(authorizer).execute(
      createContext(ApiResourceVisibility.visibility_private),
    );
    expect(asked).toEqual([]);
  });
});

describe("RequireChildOrgsAuthority on updateVisibility", () => {
  it("asks the loaded agent's organization, and refuses a member", async () => {
    const { authorizer, asked } = recording(DENY);
    const error = await refusal(() =>
      newRequireChildOrgsAuthorityOnUpdateStep(authorizer, LOADED).execute(
        updateContext(ApiResourceVisibility.visibility_child_orgs, true),
      ),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(asked.map((check) => check.resourceId)).toEqual([ORG]);
  });

  it("asks nothing for another level", async () => {
    const { authorizer, asked } = recording(DENY);
    await newRequireChildOrgsAuthorityOnUpdateStep(authorizer, LOADED).execute(
      updateContext(ApiResourceVisibility.visibility_org, true),
    );
    expect(asked).toEqual([]);
  });

  it("answers a chain that reached it without its loaded row INTERNAL", async () => {
    const { authorizer } = recording({ kind: "allow" });
    const error = await refusal(() =>
      newRequireChildOrgsAuthorityOnUpdateStep(authorizer, LOADED).execute(
        updateContext(ApiResourceVisibility.visibility_child_orgs, false),
      ),
    );
    expect(error.code).toBe(Code.Internal);
  });
});
