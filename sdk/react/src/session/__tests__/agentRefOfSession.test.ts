/**
 * Pins how the console reads the agent a session names: straight from
 * `spec.agentRef`, without its version (the pin lives on status), and
 * `null` for the built-in assistant.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { agentRefOfSession, isSameAgent } from "../agentRefOfSession";

describe("agentRefOfSession", () => {
  it("reads the session's agent reference without its version", () => {
    const session = create(SessionSchema, {
      spec: { agentRef: { org: "org_1", slug: "reviewer", version: "v2", kind: ApiResourceKind.agent } },
    });
    expect(agentRefOfSession(session)).toEqual({
      org: "org_1",
      slug: "reviewer",
      kind: ApiResourceKind.agent,
    });
  });

  it("is null for a session that names no agent, and before it loads", () => {
    expect(agentRefOfSession(create(SessionSchema, { spec: {} }))).toBeNull();
    expect(agentRefOfSession(null)).toBeNull();
  });
});

describe("isSameAgent", () => {
  it("compares organization and slug, ignoring the version", () => {
    expect(isSameAgent({ org: "o", slug: "a", version: "v1" }, { org: "o", slug: "a" })).toBe(true);
    expect(isSameAgent({ org: "o", slug: "a" }, { org: "o", slug: "b" })).toBe(false);
    expect(isSameAgent(null, null)).toBe(true);
    expect(isSameAgent({ org: "o", slug: "a" }, null)).toBe(false);
  });
});
