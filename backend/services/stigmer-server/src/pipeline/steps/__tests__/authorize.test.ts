/**
 * Pins the Authorize step's wire contract (O2, DD-007 §3): the three
 * decision arms (allow proceeds; deny → PERMISSION_DENIED carrying the
 * annotation's byte-pinned error_msg; unavailable → INTERNAL, never a
 * softened denial), the skip arms (internal caller class, is_public,
 * is_skip_authorization, no-config methods), check-target resolution
 * (field_path, static resource_id, absent field = empty id — never a
 * throw), and the mid-chain resolved-id pattern the traced ListVersions
 * handlers port onto.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/command_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { PlatformQueryController } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../../extensions/authorizer.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { RequestContext } from "../../request-context.js";
import {
  AUTHORIZATION_UNAVAILABLE_MESSAGE,
  newAuthorizeStep,
  newPermissiveSingleTeamAuthorizer,
} from "../authorize.js";

/** A fake Authorizer that records every check and answers a fixed arm. */
function fakeAuthorizer(decision: AuthzDecision): {
  authorizer: Authorizer;
  checks: AuthzCheck[];
} {
  const checks: AuthzCheck[] = [];
  return {
    checks,
    authorizer: {
      authorize(_caller, check) {
        checks.push(check);
        return Promise.resolve(decision);
      },
    },
  };
}

function agentCreateCtx() {
  return new RequestContext(
    AgentSchema,
    create(AgentSchema, { metadata: { name: "a", org: "acme" } }),
    testCallerIdentity(),
    ApiResourceKind.agent,
  );
}

describe("decision arms (wire contract, both pinned)", () => {
  it("deny → PERMISSION_DENIED carrying the annotation's byte-pinned error_msg", async () => {
    const { authorizer } = fakeAuthorizer({ kind: "deny", reason: "nope" });
    const step = newAuthorizeStep<typeof AgentSchema>(
      AgentCommandController.method.create,
      authorizer,
    );
    const error = await step
      .execute(agentCreateCtx())
      ?.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
    // The annotation IS the refusal copy (apis/.../agent/v1/command.proto).
    expect((error as ConnectError).rawMessage).toBe(
      "unauthorized to create agent in this organization",
    );
  });

  it("unavailable → INTERNAL with the sanitized static copy — NEVER a softened denial", async () => {
    const { authorizer } = fakeAuthorizer({
      kind: "unavailable",
      cause: new Error("FGA store timeout"),
    });
    const step = newAuthorizeStep<typeof AgentSchema>(
      AgentCommandController.method.create,
      authorizer,
    );
    const error = await step
      .execute(agentCreateCtx())
      ?.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect((error as ConnectError).code).not.toBe(Code.PermissionDenied);
    expect((error as ConnectError).rawMessage).toBe(
      AUTHORIZATION_UNAVAILABLE_MESSAGE,
    );
  });

  it("an Authorizer that THROWS is normalized to the unavailable arm (INTERNAL)", async () => {
    const throwing: Authorizer = {
      authorize() {
        return Promise.reject(new Error("connection refused"));
      },
    };
    const step = newAuthorizeStep<typeof AgentSchema>(
      AgentCommandController.method.create,
      throwing,
    );
    const error = await step
      .execute(agentCreateCtx())
      ?.catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });

  it("allow proceeds (the permissive single-team default allows everything)", async () => {
    const step = newAuthorizeStep<typeof AgentSchema>(
      AgentCommandController.method.create,
      newPermissiveSingleTeamAuthorizer(),
    );
    await expect(step.execute(agentCreateCtx())).resolves.toBeUndefined();
  });

  it("not-found → NOT_FOUND with the load-first chain's copy (the C2 ruling-Q1 arm)", async () => {
    const { authorizer } = fakeAuthorizer({ kind: "not-found" });
    const step = newAuthorizeStep<typeof AgentSchema>(
      AgentCommandController.method.create,
      authorizer,
    );
    const error = await step
      .execute(agentCreateCtx())
      ?.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.NotFound);
    // Exactly what LoadTarget would answer for the missing target — the
    // wire cannot tell which step spoke (stigmer#224 semantics).
    expect((error as ConnectError).rawMessage).toBe(
      "Organization not found: acme",
    );
  });

  it("not-found on a non-resource-scoped check is an authorizer contract bug → INTERNAL", async () => {
    const { authorizer } = fakeAuthorizer({ kind: "not-found" });
    const step = newAuthorizeStep<typeof AgentSchema>(
      AgentCommandController.method.create,
      authorizer,
    );
    // Empty org → the resolved resource id is empty: not-found is
    // meaningless here and must never soften into a NotFound answer.
    const ctx = new RequestContext(
      AgentSchema,
      create(AgentSchema, { metadata: { name: "a", org: "" } }),
      testCallerIdentity(),
      ApiResourceKind.agent,
    );
    const error = await step.execute(ctx)?.catch((e: unknown) => e);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });
});

describe("skip arms (the authorizer is never consulted)", () => {
  function denyAll() {
    return fakeAuthorizer({ kind: "deny", reason: "must not be called" });
  }

  it("internal caller class = the in-process authorization skip (ruling Q4)", async () => {
    const { authorizer, checks } = denyAll();
    const step = newAuthorizeStep<typeof AgentSchema>(
      AgentCommandController.method.create,
      authorizer,
    );
    const ctx = new RequestContext(
      AgentSchema,
      create(AgentSchema, { metadata: { name: "a", org: "acme" } }),
      testCallerIdentity({ callerClass: "internal" }),
      ApiResourceKind.agent,
    );
    await expect(step.execute(ctx)).resolves.toBeUndefined();
    expect(checks).toHaveLength(0);
  });

  it("is_public methods skip (getServerInfo)", async () => {
    const { authorizer, checks } = denyAll();
    const step = newAuthorizeStep(
      PlatformQueryController.method.getServerInfo,
      authorizer,
    );
    const ctx = new RequestContext(
      PlatformQueryController.method.getServerInfo.input,
      create(PlatformQueryController.method.getServerInfo.input),
      testCallerIdentity(),
    );
    await expect(step.execute(ctx)).resolves.toBeUndefined();
    expect(checks).toHaveLength(0);
  });

  it("is_skip_authorization methods skip (agentexecution create — handler-owned checks)", async () => {
    const { authorizer, checks } = denyAll();
    const step = newAuthorizeStep<typeof AgentExecutionSchema>(
      AgentExecutionCommandController.method.create,
      authorizer,
    );
    const ctx = new RequestContext(
      AgentExecutionSchema,
      create(AgentExecutionSchema),
      testCallerIdentity(),
      ApiResourceKind.agent_execution,
    );
    await expect(step.execute(ctx)).resolves.toBeUndefined();
    expect(checks).toHaveLength(0);
  });

  it("methods with NO config skip (uploadAttachment — storage_key is the capability)", async () => {
    const { authorizer, checks } = denyAll();
    const method = AgentExecutionCommandController.method.uploadAttachment;
    const step = newAuthorizeStep(method, authorizer);
    const ctx = new RequestContext(
      method.input,
      create(method.input),
      testCallerIdentity(),
    );
    await expect(step.execute(ctx)).resolves.toBeUndefined();
    expect(checks).toHaveLength(0);
  });
});

describe("check-target resolution (never a throw — byte-identity)", () => {
  it("field_path resolves through the request (metadata.org)", async () => {
    const { authorizer, checks } = fakeAuthorizer({ kind: "allow" });
    const step = newAuthorizeStep<typeof AgentSchema>(
      AgentCommandController.method.create,
      authorizer,
    );
    await step.execute(agentCreateCtx());
    expect(checks).toEqual([
      {
        permission: IamPermission.can_create_agent,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
      },
    ]);
  });

  it("an absent field resolves to the EMPTY id — the check still reaches the authorizer", async () => {
    const { authorizer, checks } = fakeAuthorizer({ kind: "allow" });
    const step = newAuthorizeStep<typeof AgentSchema>(
      AgentCommandController.method.create,
      authorizer,
    );
    const ctx = new RequestContext(
      AgentSchema,
      create(AgentSchema), // no metadata at all
      testCallerIdentity(),
      ApiResourceKind.agent,
    );
    await expect(step.execute(ctx)).resolves.toBeUndefined();
    expect(checks[0].resourceId).toBe("");
  });

  it("a static resource_id wins over any request field (platform RPCs)", async () => {
    const { authorizer, checks } = fakeAuthorizer({ kind: "allow" });
    const method = IamPolicyCommandController.method.cleanupResourcePolicies;
    const step = newAuthorizeStep(method, authorizer);
    const ctx = new RequestContext(
      method.input,
      create(method.input),
      testCallerIdentity(),
    );
    await step.execute(ctx);
    expect(checks).toEqual([
      {
        permission: IamPermission.can_bootstrap_iam,
        resourceKind: ApiResourceKind.platform,
        resourceId: "stigmer",
      },
    ]);
  });
});

describe("mid-chain resolved-id checks (the ListVersions pattern)", () => {
  it("a later step authorizes against the id a LOAD step resolved — deny maps to the wire", async () => {
    // The pattern: position 1 authorized the request-shaped check; a
    // mid-chain step re-checks against the RESOLVED resource once loading
    // established what is actually being read. The two traced
    // ListVersions handlers port onto exactly this shape (blueprint §5b).
    const { authorizer, checks } = fakeAuthorizer({
      kind: "deny",
      reason: "caller cannot read the resolved skill",
    });
    const ctx = new RequestContext(
      AgentSchema,
      create(AgentSchema, { metadata: { name: "a", org: "acme" } }),
      testCallerIdentity(),
      ApiResourceKind.agent,
    );
    ctx.set("resolvedId", "skl_01resolved");

    const midChainCheck = async () => {
      const decision = await authorizer.authorize(ctx.callerIdentity, {
        permission: IamPermission.can_view,
        resourceKind: ApiResourceKind.skill,
        resourceId: ctx.get("resolvedId") as string,
      });
      if (decision.kind === "deny") {
        throw new ConnectError(decision.reason, Code.PermissionDenied);
      }
    };

    const error = await midChainCheck().catch((e: unknown) => e);
    expect(checks[0].resourceId).toBe("skl_01resolved");
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
  });
});
