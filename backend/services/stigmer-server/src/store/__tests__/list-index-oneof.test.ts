/**
 * Pins the list index's field reader through a oneof (../list-index.ts): a
 * oneof member is held under its oneof as `{ case, value }`, not under its
 * own name, so a key declared on `spec.session_id` must read the turn's
 * session through `target` — and read nothing when the oneof holds the
 * other member or nothing. Without it every turn's `session` key reads
 * empty and listBySession answers no turns.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { declareListIndex, field, listIndexFactsOf } from "../list-index.js";

const turns = declareListIndex({
  kind: ApiResourceKind.agent_run,
  schema: AgentRunSchema,
  revision: 1,
  keys: { session: field("spec.session_id") },
});

describe("a list key on a oneof member", () => {
  it("reads the member the oneof holds", () => {
    const turn = create(AgentRunSchema, {
      metadata: { org: "org_a" },
      spec: { target: { case: "sessionId", value: "ses_1" } },
    });
    expect(listIndexFactsOf(turns, turn).keys).toEqual([
      { key: "session", value: "ses_1" },
    ]);
  });

  it("reads nothing when the oneof holds the other member", () => {
    const turn = create(AgentRunSchema, {
      metadata: { org: "org_a" },
      spec: { target: { case: "sessionSpec", value: {} } },
    });
    expect(listIndexFactsOf(turns, turn).keys).toEqual([]);
  });

  it("reads nothing when the oneof is unset", () => {
    const turn = create(AgentRunSchema, {
      metadata: { org: "org_a" },
      spec: {},
    });
    expect(listIndexFactsOf(turns, turn).keys).toEqual([]);
  });
});
