/**
 * Pins the driver-neutral half of the public-visibility data migration
 * (public-visibility-retired.ts): the frozen kind table is exactly the
 * seven kinds that could hold the level, a public row is moved to org with
 * every other byte it carried intact (an unknown field a newer release
 * wrote included), a row at any other level is left alone (undefined, so
 * the driver never rewrites bytes it did not change; a row with no
 * metadata holds no level and is one of these), and bytes that do not
 * decode are a thrown fault, never a skipped row.
 * The drivers' replay tests pin the SQL around this function.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import {
  LEVEL_AFTER_RETIREMENT,
  PUBLIC_ROW_KINDS_AT_RETIREMENT,
  movePublicRowToOrg,
} from "../public-visibility-retired.js";

const AGENT = PUBLIC_ROW_KINDS_AT_RETIREMENT[0]!;

function agentBytes(visibility: ApiResourceVisibility): Uint8Array {
  return toBinary(
    AgentSchema,
    create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: {
        id: "agt_1",
        name: "Public Agent",
        slug: "public-agent",
        org: "acme",
        visibility,
        labels: { team: "platform" },
      },
      spec: { instructions: "a conformant instruction body" },
    }),
  );
}

/** `bytes` followed by one field this schema does not declare (a newer release's). */
function withUnknownField(bytes: Uint8Array): Uint8Array {
  const trailer = new BinaryWriter()
    .tag(4093, WireType.LengthDelimited)
    .string("written by a release this one does not know")
    .finish();
  const joined = new Uint8Array(bytes.length + trailer.length);
  joined.set(bytes, 0);
  joined.set(trailer, bytes.length);
  return joined;
}

describe("the frozen kind table", () => {
  it("is exactly the seven kinds that could hold the level, by the enum names the drivers store", () => {
    expect(PUBLIC_ROW_KINDS_AT_RETIREMENT.map((entry) => entry.kind)).toEqual([
      "agent",
      "skill",
      "mcp_server",
      "agent_instance",
      "workflow",
      "workflow_instance",
      "plugin",
    ]);
    expect(AGENT.schema).toBe(AgentSchema);
    expect(PUBLIC_ROW_KINDS_AT_RETIREMENT[1]!.schema).toBe(SkillSchema);
  });
});

describe("movePublicRowToOrg", () => {
  it("moves a public row to org and changes nothing else", () => {
    const moved = movePublicRowToOrg(
      AGENT,
      agentBytes(ApiResourceVisibility.visibility_public),
    );
    expect(moved).toBeDefined();
    const after = fromBinary(AgentSchema, moved!);
    expect(after.metadata?.visibility).toBe(LEVEL_AFTER_RETIREMENT);
    expect(after.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_org,
    );
    // Every other byte: the moved row re-encodes to exactly the bytes an
    // org row with the same content encodes to.
    expect(moved).toEqual(agentBytes(ApiResourceVisibility.visibility_org));
  });

  it("keeps an unknown field a newer release wrote through the round trip", () => {
    const moved = movePublicRowToOrg(
      AGENT,
      withUnknownField(agentBytes(ApiResourceVisibility.visibility_public)),
    );
    expect(moved).toEqual(
      withUnknownField(agentBytes(ApiResourceVisibility.visibility_org)),
    );
  });

  it("leaves a row at any other level alone", () => {
    for (const level of [
      ApiResourceVisibility.api_resource_visibility_unspecified,
      ApiResourceVisibility.visibility_private,
      ApiResourceVisibility.visibility_org,
      ApiResourceVisibility.visibility_platform,
    ]) {
      expect(movePublicRowToOrg(AGENT, agentBytes(level))).toBeUndefined();
    }
  });

  it("leaves a message with no metadata alone — it holds no level", () => {
    expect(
      movePublicRowToOrg(
        AGENT,
        toBinary(AgentSchema, create(AgentSchema, { kind: "Agent" })),
      ),
    ).toBeUndefined();
  });

  it("refuses bytes that do not decode as the kind", () => {
    expect(() =>
      movePublicRowToOrg(AGENT, new Uint8Array([0xff, 0xff, 0xff])),
    ).toThrow();
  });
});
