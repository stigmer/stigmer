/**
 * Pins the edition-neutral half of the tuple-lifecycle seam: the visibility
 * shape policy and its set-diff
 * (re-pinning the Java VisibilityTupleReconcilerTest transition matrix),
 * the run-audience policy of a workflow instance's execution visibility,
 * and the config-driven creation-event resolution
 * (CreateAuthorizationTuplesStepV2's scope/owner/parent semantics,
 * including every failure arm), and the one delete cleanup every delete
 * chain and every cascade hands its deleted resource to: best-effort, a
 * driver's failure logged and never raised. The driver-facing behavior of
 * the steps themselves, the cascades' cleanup included, is pinned end to
 * end in extensions/__tests__/extension-composition.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OwnerAttributionType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type {
  ResourceAuthorizationLifecycle,
  ResourceDeletedEvent,
} from "../../../extensions/resource-authorization.js";
import {
  cleanUpDeletedResource,
  diffVisibilityShapes,
  executionAudienceShapes,
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
  it("agent (blueprint with org floor): org / platform expansions", () => {
    expect([
      ...visibilityShapesFor(ApiResourceKind.agent, V.visibility_org),
    ]).toEqual(["org-viewer"]);
    expect(
      [
        ...visibilityShapesFor(ApiResourceKind.agent, V.visibility_platform),
      ].sort(),
    ).toEqual(["org-viewer", "platform-viewer"]);
    expect([
      ...visibilityShapesFor(ApiResourceKind.agent, V.visibility_private),
    ]).toEqual([]);
  });

  it("the retired public level expands to nothing for every kind — no wildcard shape exists", () => {
    for (const kind of [
      ApiResourceKind.agent,
      ApiResourceKind.workflow_instance,
      ApiResourceKind.plugin,
      ApiResourceKind.session,
    ]) {
      expect([...visibilityShapesFor(kind, V.visibility_public)]).toEqual([]);
    }
  });

  it("session (no visibility config): every level yields nothing, silently", () => {
    expect([
      ...visibilityShapesFor(ApiResourceKind.session, V.visibility_org),
    ]).toEqual([]);
    expect([
      ...visibilityShapesFor(ApiResourceKind.session, V.visibility_platform),
    ]).toEqual([]);
  });

  it("agent_instance supports org but never platform (tenant isolation)", () => {
    expect([
      ...visibilityShapesFor(
        ApiResourceKind.agent_instance,
        V.visibility_platform,
      ),
    ]).toEqual([]);
  });
});

describe("executionAudienceShapes (a workflow instance's run audience)", () => {
  it("ORGANIZATION names the organization's viewers", () => {
    expect([
      ...executionAudienceShapes(WorkflowExecutionVisibility.organization),
    ]).toEqual(["org-viewer"]);
  });

  it("PRIVATE and the unset level name nobody, so each run stays its triggerer's", () => {
    expect([
      ...executionAudienceShapes(WorkflowExecutionVisibility.private),
    ]).toEqual([]);
    expect([
      ...executionAudienceShapes(WorkflowExecutionVisibility.unspecified),
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

  it("unspecified→platform creates the platform shape + the org floor", () => {
    const diff = diffVisibilityShapes(
      agent,
      V.api_resource_visibility_unspecified,
      V.visibility_platform,
    );
    expect([...diff.shapesToCreate].sort()).toEqual([
      "org-viewer",
      "platform-viewer",
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

  it("platform→org deletes ONLY the platform shape — the shared org floor stays untouched", () => {
    const diff = diffVisibilityShapes(
      agent,
      V.visibility_platform,
      V.visibility_org,
    );
    expect(diff.shapesToCreate).toEqual([]);
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

describe("cleanUpDeletedResource (the delete cleanup every chain and cascade shares)", () => {
  const event: ResourceDeletedEvent = {
    kind: ApiResourceKind.agent_instance,
    resourceId: "ain_cleanup_subject",
    orgId: "acme",
    caller,
  };

  function lifecycleDeleting(
    onResourceDeleted: (event: ResourceDeletedEvent) => Promise<void>,
  ): ResourceAuthorizationLifecycle {
    return {
      onResourceCreated: () => Promise.resolve(),
      onResourceDeleted,
      onVisibilityChanged: () => Promise.resolve(),
    };
  }

  it("hands the composed driver the deleted resource's event", async () => {
    const seen: ResourceDeletedEvent[] = [];
    await cleanUpDeletedResource(
      lifecycleDeleting(async (deleted) => {
        seen.push(deleted);
      }),
      logger,
      event,
    );
    expect(seen).toEqual([event]);
  });

  it("does nothing when no driver is composed", async () => {
    await expect(
      cleanUpDeletedResource(undefined, logger, event),
    ).resolves.toBeUndefined();
  });

  it("logs a driver's failure and never raises it, so the delete it serves still succeeds", async () => {
    const warnings: Array<{
      message: string;
      fields: Record<string, unknown>;
    }> = [];
    const capturing = {
      debug() {},
      info() {},
      warn(message: string, fields?: Record<string, unknown>) {
        warnings.push({ message, fields: fields ?? {} });
      },
      error() {},
    };
    await cleanUpDeletedResource(
      lifecycleDeleting(() => Promise.reject(new Error("fga is down"))),
      capturing,
      event,
    );
    expect(warnings).toEqual([
      {
        message:
          "authorization cleanup failed — orphaned IAM policies may remain",
        fields: {
          kind: "AgentInstance",
          resourceId: "ain_cleanup_subject",
          error: "fga is down",
        },
      },
    ]);
  });
});
