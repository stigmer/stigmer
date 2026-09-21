/**
 * Pins the create lane's authorization questions (steps.ts,
 * resolveInstanceCreateTargets): a personal instance asks the
 * organization's bar (can_create_agent_instance on metadata.org) and then
 * the parent's (can_create_instance on the agent), each with its own copy;
 * a default instance the server composed in-process for the parent's
 * organization asks nothing; a labelled request that arrived on the wire,
 * or that names another organization, takes the personal bar in full; a
 * missing parent is a thrown chain invariant, never an open lane.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import {
  DEFAULT_INSTANCE_LABEL,
  RESERVED_LABEL_TRUE,
} from "../../../pipeline/apiresource-labels.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import {
  INSTANCE_ORGANIZATION_DENIED_MESSAGE,
  INSTANCE_PARENT_DENIED_MESSAGE,
  PARENT_AGENT_KEY,
  resolveInstanceCreateTargets,
} from "../steps.js";

const parent = create(AgentSchema, {
  metadata: { id: "agt_01parent", name: "helper", org: "acme" },
});

function ctxFor(
  org: string,
  caller: CallerIdentity,
  labels: Record<string, string> = {},
  stashParent = true,
) {
  const ctx = new RequestContext(
    AgentInstanceSchema,
    create(AgentInstanceSchema, {
      metadata: { name: "mine", org, labels },
      spec: { agentId: parent.metadata!.id },
    }),
    caller,
    ApiResourceKind.agent_instance,
  );
  if (stashParent) {
    ctx.set(PARENT_AGENT_KEY, parent);
  }
  return ctx;
}

const DEFAULT_LABELS = { [DEFAULT_INSTANCE_LABEL]: RESERVED_LABEL_TRUE };

describe("resolveInstanceCreateTargets", () => {
  it("a personal instance asks the organization's bar first, then the parent's, each with its own copy", () => {
    expect(
      resolveInstanceCreateTargets(ctxFor("acme", testCallerIdentity())),
    ).toEqual([
      {
        permission: IamPermission.can_create_agent_instance,
        resourceKind: ApiResourceKind.organization,
        resourceId: "acme",
        deniedMessage: INSTANCE_ORGANIZATION_DENIED_MESSAGE,
      },
      {
        permission: IamPermission.can_create_instance,
        resourceKind: ApiResourceKind.agent,
        resourceId: "agt_01parent",
        deniedMessage: INSTANCE_PARENT_DENIED_MESSAGE,
      },
    ]);
  });

  it("a cross-org personal instance asks about ITS organization, not the parent's (the marketplace case)", () => {
    const [orgBar] = resolveInstanceCreateTargets(
      ctxFor("consumer-org", testCallerIdentity()),
    );
    expect(orgBar?.resourceId).toBe("consumer-org");
  });

  it("a default instance the server composed in-process for the parent's organization asks nothing", () => {
    expect(
      resolveInstanceCreateTargets(
        ctxFor(
          "acme",
          testCallerIdentity({ callerClass: "user", origin: "in-process" }),
          DEFAULT_LABELS,
        ),
      ),
    ).toEqual([]);
    expect(
      resolveInstanceCreateTargets(
        ctxFor(
          "acme",
          testCallerIdentity({ callerClass: "channel", origin: "in-process" }),
          DEFAULT_LABELS,
        ),
      ),
    ).toEqual([]);
  });

  it("the label alone buys nothing: a labelled request from the wire takes the personal bar in full, the machine class included", () => {
    expect(
      resolveInstanceCreateTargets(
        ctxFor("acme", testCallerIdentity(), DEFAULT_LABELS),
      ),
    ).toHaveLength(2);
    expect(
      resolveInstanceCreateTargets(
        ctxFor(
          "acme",
          testCallerIdentity({ callerClass: "machine" }),
          DEFAULT_LABELS,
        ),
      ),
    ).toHaveLength(2);
  });

  it("a labelled in-process request for another organization is not a default instance to this step", () => {
    expect(
      resolveInstanceCreateTargets(
        ctxFor(
          "other-org",
          testCallerIdentity({ callerClass: "user", origin: "in-process" }),
          DEFAULT_LABELS,
        ),
      ),
    ).toHaveLength(2);
  });

  it("a missing parent is a broken chain invariant and throws", () => {
    expect(() =>
      resolveInstanceCreateTargets(
        ctxFor("acme", testCallerIdentity(), {}, false),
      ),
    ).toThrow("parent agent not found in context");
  });
});
