/**
 * Pins the edition-neutral half of the C2 tuple-lifecycle seam
 * (20260827.10, ruling Q2): the visibility shape policy and its set-diff
 * (re-pinning the Java VisibilityTupleReconcilerTest transition matrix),
 * and the config-driven creation-event resolution
 * (CreateAuthorizationTuplesStepV2's scope/owner/parent semantics,
 * including every failure arm). The driver-facing behavior of the steps
 * themselves is pinned end to end in
 * extensions/__tests__/extension-composition.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  diffVisibilityShapes,
  resolveResourceCreatedEvent,
  visibilityShapesFor,
} from "../authorization-tuples.js";

const logger = createLogger({ level: "error", pretty: false, write: () => {} });

const caller: CallerIdentity = {
  identityId: "ida_test_creator",
  callerClass: "user",
  issuer: "",
  rawToken: "",
};

const V = ApiResourceVisibility;

describe("visibilityShapesFor (the reconciler's level→shape policy)", () => {
  it("agent (blueprint with org floor): org / public / platform expansions", () => {
    expect([
      ...visibilityShapesFor(ApiResourceKind.agent, V.visibility_org),
    ]).toEqual(["org-viewer"]);
    expect(
      [
        ...visibilityShapesFor(ApiResourceKind.agent, V.visibility_public),
      ].sort(),
    ).toEqual(["org-viewer", "public-viewer"]);
    expect(
      [
        ...visibilityShapesFor(ApiResourceKind.agent, V.visibility_platform),
      ].sort(),
    ).toEqual(["org-viewer", "platform-viewer"]);
    expect([
      ...visibilityShapesFor(ApiResourceKind.agent, V.visibility_private),
    ]).toEqual([]);
  });

  it("workflow_instance (no org floor): public expands to the wildcard shape alone", () => {
    expect([
      ...visibilityShapesFor(
        ApiResourceKind.workflow_instance,
        V.visibility_public,
      ),
    ]).toEqual(["public-viewer"]);
  });

  it("session (no visibility config): every level yields nothing, silently", () => {
    expect([
      ...visibilityShapesFor(ApiResourceKind.session, V.visibility_public),
    ]).toEqual([]);
    expect([
      ...visibilityShapesFor(ApiResourceKind.session, V.visibility_org),
    ]).toEqual([]);
  });

  it("agent_instance supports org+public but never platform (tenant isolation)", () => {
    expect([
      ...visibilityShapesFor(
        ApiResourceKind.agent_instance,
        V.visibility_platform,
      ),
    ]).toEqual([]);
  });
});

describe("diffVisibilityShapes (the reconciler's transition matrix, re-pinned)", () => {
  const agent = ApiResourceKind.agent;

  it("same level is a no-op", () => {
    const diff = diffVisibilityShapes(
      agent,
      V.visibility_org,
      V.visibility_org,
    );
    expect(diff.shapesToCreate).toEqual([]);
    expect(diff.shapesToDelete).toEqual([]);
  });

  it("unspecified→public creates public + the org floor", () => {
    const diff = diffVisibilityShapes(
      agent,
      V.api_resource_visibility_unspecified,
      V.visibility_public,
    );
    expect([...diff.shapesToCreate].sort()).toEqual([
      "org-viewer",
      "public-viewer",
    ]);
    expect(diff.shapesToDelete).toEqual([]);
  });

  it("org→private deletes the org shape (the shipped stale-tuple bug's pin)", () => {
    const diff = diffVisibilityShapes(
      agent,
      V.visibility_org,
      V.visibility_private,
    );
    expect(diff.shapesToCreate).toEqual([]);
    expect(diff.shapesToDelete).toEqual(["org-viewer"]);
  });

  it("public→org deletes ONLY the wildcard — the shared org shape stays untouched", () => {
    const diff = diffVisibilityShapes(
      agent,
      V.visibility_public,
      V.visibility_org,
    );
    expect(diff.shapesToCreate).toEqual([]);
    expect(diff.shapesToDelete).toEqual(["public-viewer"]);
  });

  it("platform→public swaps the family shape and never touches the org floor", () => {
    const diff = diffVisibilityShapes(
      agent,
      V.visibility_platform,
      V.visibility_public,
    );
    expect(diff.shapesToCreate).toEqual(["public-viewer"]);
    expect(diff.shapesToDelete).toEqual(["platform-viewer"]);
  });

  it("platform→private deletes both the family shape and the floor", () => {
    const diff = diffVisibilityShapes(
      agent,
      V.visibility_platform,
      V.visibility_private,
    );
    expect(diff.shapesToCreate).toEqual([]);
    expect([...diff.shapesToDelete].sort()).toEqual([
      "org-viewer",
      "platform-viewer",
    ]);
  });
});

describe("resolveResourceCreatedEvent (the config-driven creation resolution)", () => {
  it("agent: ORGANIZATION scope link + DIRECT owner + creation visibility shapes", () => {
    const agent = create(AgentSchema, {
      metadata: {
        id: "agt_1",
        org: "acme",
        visibility: V.visibility_org,
      },
    });
    const event = resolveResourceCreatedEvent(
      ApiResourceKind.agent,
      agent,
      caller,
      logger,
    );
    expect(event).toBeDefined();
    expect(event?.parentLinks).toEqual([
      {
        relation: "organization",
        parentKind: ApiResourceKind.organization,
        parentId: "acme",
      },
    ]);
    expect(event?.ownerAttribution).toBe(OwnerAttributionType.DIRECT);
    expect(event?.requiresCreatorTuple).toBe(false);
    expect(event?.visibilityShapes).toEqual(["org-viewer"]);
    expect(event?.caller.identityId).toBe("ida_test_creator");
  });

  it("organization: OWNER_ONLY — owner attribution without any scope link", () => {
    const org = create(OrganizationSchema, {
      metadata: { id: "acme", org: "" },
    });
    const event = resolveResourceCreatedEvent(
      ApiResourceKind.organization,
      org,
      caller,
      logger,
    );
    expect(event?.parentLinks).toEqual([]);
    expect(event?.ownerAttribution).toBe(OwnerAttributionType.DIRECT);
  });

  it("environment: the one requires_creator_tuple kind", () => {
    const env = create(EnvironmentSchema, {
      metadata: { id: "env_1", org: "acme" },
    });
    const event = resolveResourceCreatedEvent(
      ApiResourceKind.environment,
      env,
      caller,
      logger,
    );
    expect(event?.requiresCreatorTuple).toBe(true);
  });

  it("agent_execution: PARENT scope resolves the session link from spec.session_id, owner INHERITED", () => {
    const execution = create(AgentExecutionSchema, {
      metadata: { id: "aexec_1", org: "acme" },
      spec: { sessionId: "ses_parent" },
    });
    const event = resolveResourceCreatedEvent(
      ApiResourceKind.agent_execution,
      execution,
      caller,
      logger,
    );
    expect(event?.parentLinks).toEqual([
      {
        relation: "session",
        parentKind: ApiResourceKind.session,
        parentId: "ses_parent",
      },
    ]);
    expect(event?.ownerAttribution).toBe(OwnerAttributionType.INHERITED);
  });

  it("agent_execution with no session id fails the request (Java's missing-parent arm)", () => {
    const execution = create(AgentExecutionSchema, {
      metadata: { id: "aexec_2", org: "acme" },
    });
    expect(() =>
      resolveResourceCreatedEvent(
        ApiResourceKind.agent_execution,
        execution,
        caller,
        logger,
      ),
    ).toThrowError(/failed to create authorization tuples/);
  });

  it("agent_instance: org scope link PLUS the additional agent parent from spec.agent_id", () => {
    const instance = create(AgentInstanceSchema, {
      metadata: { id: "agi_1", org: "acme" },
      spec: { agentId: "agt_parent" },
    });
    const event = resolveResourceCreatedEvent(
      ApiResourceKind.agent_instance,
      instance,
      caller,
      logger,
    );
    expect(event?.parentLinks).toEqual([
      {
        relation: "organization",
        parentKind: ApiResourceKind.organization,
        parentId: "acme",
      },
      {
        relation: "agent",
        parentKind: ApiResourceKind.agent,
        parentId: "agt_parent",
      },
    ]);
  });

  it("memory: owner NONE — the subject additional parent is the only principal-bearing link", () => {
    const memory = create(MemorySchema, {
      metadata: { id: "mem_1", org: "acme" },
      spec: { subjectIdentityAccountId: "ida_subject" },
    });
    const event = resolveResourceCreatedEvent(
      ApiResourceKind.memory,
      memory,
      caller,
      logger,
    );
    expect(event?.ownerAttribution).toBe(OwnerAttributionType.NONE);
    expect(event?.parentLinks).toContainEqual({
      relation: "subject",
      parentKind: ApiResourceKind.identity_account,
      parentId: "ida_subject",
    });
  });

  it("NONE-scoped kinds resolve to no event at all (Java's early return)", () => {
    const platform = create(OrganizationSchema, {
      metadata: { id: "stigmer" },
    });
    expect(
      resolveResourceCreatedEvent(
        ApiResourceKind.platform,
        platform,
        caller,
        logger,
      ),
    ).toBeUndefined();
  });

  it("ORGANIZATION scope with a blank org fails the request", () => {
    const agent = create(AgentSchema, {
      metadata: { id: "agt_orgless", org: "" },
    });
    expect(() =>
      resolveResourceCreatedEvent(ApiResourceKind.agent, agent, caller, logger),
    ).toThrowError(/failed to create authorization tuples/);
  });
});
