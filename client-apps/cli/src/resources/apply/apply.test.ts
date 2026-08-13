// Unit tests for the shared apply core's declared-visibility follow-up
// (oss#573). Plain updates preserve stored visibility on both editions, so
// the apply RPC's response carries the STORED level; when a manifest
// declares a different one, the core must land it through the guarded
// updateVisibility RPC — or warn when the kind has no such door.

import { create, type Message } from "@bufbuild/protobuf";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { UpdateVisibilityInput } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { describe, expect, it } from "vitest";
import { applyMessage } from "./apply.js";
import type { ApplyHandler, ControllerFn } from "./handlers.js";

// The controller accessor is only ever forwarded to handler methods, which
// these tests stub out — a throwing dummy proves nothing else touches it.
const controller: ControllerFn = () => {
  throw new Error("unexpected controller access");
};

function agent(visibility: ApiResourceVisibility, id = "agent-1") {
  return create(AgentSchema, {
    metadata: { id, name: "a", org: "acme", visibility },
    spec: { instructions: "i" },
  });
}

interface HandlerOptions {
  applyReturns: Message;
  updateVisibility?: (input: UpdateVisibilityInput) => Promise<Message>;
}

function handlerWith(opts: HandlerOptions): { handler: ApplyHandler; calls: UpdateVisibilityInput[] } {
  const calls: UpdateVisibilityInput[] = [];
  const handler: ApplyHandler = {
    kind: ApiResourceKind.agent,
    displayName: "Agent",
    schema: AgentSchema,
    applyOrder: 3,
    apply: () => Promise.resolve(opts.applyReturns),
    ...(opts.updateVisibility !== undefined && {
      updateVisibility: (_c: ControllerFn, input: UpdateVisibilityInput) => {
        calls.push(input);
        return opts.updateVisibility!(input);
      },
    }),
  };
  return { handler, calls };
}

describe("applyMessage declared-visibility follow-up", () => {
  it("lands a declared level the update preserved away, and reflects it on the outcome", async () => {
    // Server preserved stored org; manifest declares public.
    const { handler, calls } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_org),
      updateVisibility: () => Promise.resolve(agent(ApiResourceVisibility.visibility_public)),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_public), "acme", false);

    expect(calls).toHaveLength(1);
    expect(calls[0].resourceId).toBe("agent-1");
    expect(calls[0].visibility).toBe(ApiResourceVisibility.visibility_public);
    expect(outcome.warning).toBeUndefined();
    const appliedMeta = (outcome.applied as { metadata?: { visibility?: ApiResourceVisibility } })?.metadata;
    expect(appliedMeta?.visibility).toBe(ApiResourceVisibility.visibility_public);
  });

  it("skips the follow-up when the manifest omits visibility", async () => {
    const { handler, calls } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_org),
      updateVisibility: () => Promise.reject(new Error("must not be called")),
    });

    const outcome = await applyMessage(
      controller,
      handler,
      agent(ApiResourceVisibility.api_resource_visibility_unspecified),
      "acme",
      false,
    );

    expect(calls).toHaveLength(0);
    expect(outcome.warning).toBeUndefined();
  });

  it("skips the follow-up when the server already matches (idempotent re-apply)", async () => {
    const { handler, calls } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_public),
      updateVisibility: () => Promise.reject(new Error("must not be called")),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_public), "acme", false);

    expect(calls).toHaveLength(0);
    expect(outcome.warning).toBeUndefined();
  });

  it("warns instead of silently swallowing a diff on kinds without the RPC", async () => {
    const { handler } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_private),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_public), "acme", false);

    expect(outcome.warning).toMatch(/visibility cannot be changed declaratively/);
    expect(outcome.warning).toMatch(/stored value is kept/);
  });

  it("fails loudly when the guarded door rejects, naming the partial state", async () => {
    // e.g. the default-instance FAILED_PRECONDITION or an unsupported level.
    const { handler } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_org),
      updateVisibility: () => Promise.reject(new Error("default instances do not have their own visibility")),
    });

    await expect(
      applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_public), "acme", false),
    ).rejects.toThrow(/spec applied, but the manifest's visibility change was rejected/);
  });

  it("does not follow up in dry-run mode", async () => {
    const { handler, calls } = handlerWith({
      applyReturns: agent(ApiResourceVisibility.visibility_org),
      updateVisibility: () => Promise.reject(new Error("must not be called")),
    });

    const outcome = await applyMessage(controller, handler, agent(ApiResourceVisibility.visibility_public), "acme", true);

    expect(calls).toHaveLength(0);
    expect(outcome.applied).toBeUndefined();
  });
});
