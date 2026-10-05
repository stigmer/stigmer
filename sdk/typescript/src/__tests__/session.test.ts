/**
 * Unit tests for the hand-written session utilities: the pinned
 * session-context metadata key, the typed-context merge semantics, and
 * `isBuiltInAssistant`, the one reading of whether a session runs the
 * built-in assistant (it names no agent in `spec.agentRef` and pins none in
 * `status.agentId`; a session pinning an agent since deleted is not it).
 */

import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  SESSION_CONTEXT_METADATA_KEY,
  isBuiltInAssistant,
  mergeSessionContext,
} from "../session.js";

describe("SESSION_CONTEXT_METADATA_KEY", () => {
  it("is pinned verbatim to the runner's constant (mirror guard)", () => {
    // Pinned to SESSION_CONTEXT_METADATA_KEY in
    // backend/services/runner/src/shared/session-context.ts. Changing
    // either side alone silently blinds the agent to the embedder's
    // context; change BOTH together.
    expect(SESSION_CONTEXT_METADATA_KEY).toBe("stigmer.ai/session-context");
  });
});

describe("mergeSessionContext", () => {
  it("folds the context into the metadata map under the reserved key", () => {
    expect(mergeSessionContext({ "acme/tenant": "t-1" }, "Role: admin")).toEqual({
      "acme/tenant": "t-1",
      [SESSION_CONTEXT_METADATA_KEY]: "Role: admin",
    });
  });

  it("creates the map when metadata is undefined", () => {
    expect(mergeSessionContext(undefined, "Role: admin")).toEqual({
      [SESSION_CONTEXT_METADATA_KEY]: "Role: admin",
    });
  });

  it("lets the typed field win over a raw entry under the reserved key", () => {
    expect(
      mergeSessionContext(
        { [SESSION_CONTEXT_METADATA_KEY]: "stale raw value" },
        "typed value",
      ),
    ).toEqual({ [SESSION_CONTEXT_METADATA_KEY]: "typed value" });
  });

  it("returns metadata untouched when the context is undefined", () => {
    const metadata = { "acme/tenant": "t-1" };
    expect(mergeSessionContext(metadata, undefined)).toBe(metadata);
  });

  it("returns undefined when both inputs are absent — callers never send an empty map", () => {
    expect(mergeSessionContext(undefined, undefined)).toBeUndefined();
    expect(mergeSessionContext(undefined, "   ")).toBeUndefined();
  });

  it("trims the context before storing (blank means absent)", () => {
    expect(mergeSessionContext(undefined, "  Role: admin  ")).toEqual({
      [SESSION_CONTEXT_METADATA_KEY]: "Role: admin",
    });
  });

  it("does not mutate the caller's metadata map", () => {
    const metadata = { "acme/tenant": "t-1" };
    mergeSessionContext(metadata, "Role: admin");
    expect(metadata).toEqual({ "acme/tenant": "t-1" });
  });
});

describe("isBuiltInAssistant", () => {
  it("is true for a session that names and pins no agent, and before one loads", () => {
    expect(isBuiltInAssistant(create(SessionSchema, { spec: {} }))).toBe(true);
    expect(isBuiltInAssistant(undefined)).toBe(true);
  });

  it("is false for a session that names an agent", () => {
    const session = create(SessionSchema, {
      spec: { agentRef: { org: "acme", slug: "reviewer", kind: ApiResourceKind.agent } },
    });
    expect(isBuiltInAssistant(session)).toBe(false);
  });

  it("is false for a session that pins an agent its spec no longer names", () => {
    const session = create(SessionSchema, { spec: {}, status: { agentId: "agt_1" } });
    expect(isBuiltInAssistant(session)).toBe(false);
  });
});
