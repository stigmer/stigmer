/**
 * Pins the per-request server-stamped reserved-label record (parity entry
 * 20260830.05, the Java ServerStampedReservedLabels port): recording
 * accumulates across calls, reads never invent, and the record is
 * request-scoped — a second context sees nothing.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { RequestContext } from "../../request-context.js";
import {
  recordServerStampedReservedLabels,
  serverStampedReservedLabels,
} from "../server-stamped-reserved-labels.js";

const USER: CallerIdentity = {
  identityId: "ida_alice",
  callerClass: "user",
  issuer: "stigmer",
  rawToken: "tok",
};

function ctx(): RequestContext<typeof AgentSchema> {
  return new RequestContext(
    AgentSchema,
    create(AgentSchema, { metadata: { name: "a" } }),
    USER,
    ApiResourceKind.agent,
  );
}

describe("serverStampedReservedLabels", () => {
  it("answers empty when nothing was recorded", () => {
    expect(serverStampedReservedLabels(ctx()).size).toBe(0);
  });

  it("accumulates recorded keys across calls", () => {
    const c = ctx();
    recordServerStampedReservedLabels(c, "stigmer.ai/workflow-execution-id");
    recordServerStampedReservedLabels(c, "stigmer.ai/workflow-task");
    const stamped = serverStampedReservedLabels(c);
    expect(stamped.has("stigmer.ai/workflow-execution-id")).toBe(true);
    expect(stamped.has("stigmer.ai/workflow-task")).toBe(true);
    expect(stamped.size).toBe(2);
  });

  it("is request-scoped — a second context sees nothing", () => {
    const first = ctx();
    recordServerStampedReservedLabels(first, "stigmer.ai/x");
    expect(serverStampedReservedLabels(ctx()).size).toBe(0);
  });
});
