/**
 * Pins the frozen sub-agent shape (../frozen-sub-agent.ts) the data
 * migrations read the retired AgentSpec field 6 through:
 *   - a sub-agent written field by field in its wire numbers, the way an
 *     earlier release wrote it inside an agent, reads back whole: name,
 *     description, instructions, skills, model override and both tool
 *     lists, in order, several per agent;
 *   - the live AgentSpec keeps the field as an unknown field through a
 *     decode and an encode, so a row read and written by today's schema
 *     still holds its sub-agents;
 *   - writing them back round-trips: an edited list is read as written and
 *     keeps its place among the other unknown fields, and an empty list
 *     removes the field (and the unknown-field holder once nothing is left);
 *   - a spec with no sub-agents reads none.
 */
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { describe, expect, it } from "vitest";

import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  AGENT_SPEC_SUB_AGENTS_FIELD,
  readSubAgents,
  writeSubAgents,
} from "../frozen-sub-agent.js";
import { skillRef, subAgentBytes } from "./retired-mcp-server-rows.js";
import type { SubAgentInit } from "./retired-mcp-server-rows.js";

type UnknownHolder = { $unknown?: Array<{ no: number }> };

/** An AgentSpec's bytes as an earlier release wrote them: live fields, then `fieldsAfter` by number. */
function specBytes(
  subAgents: readonly SubAgentInit[],
  fieldsAfter: ReadonlyArray<{ no: number; text: string }> = [],
): Uint8Array {
  const writer = new BinaryWriter().raw(
    toBinary(
      AgentSpecSchema,
      create(AgentSpecSchema, {
        instructions: "Review every pull request with care.",
        tools: ["Read"],
      }),
    ),
  );
  for (const subAgent of subAgents) {
    writer.tag(AGENT_SPEC_SUB_AGENTS_FIELD, WireType.LengthDelimited).bytes(subAgentBytes(subAgent));
  }
  for (const field of fieldsAfter) {
    writer.tag(field.no, WireType.LengthDelimited).string(field.text);
  }
  return writer.finish();
}

const TRIAGER: SubAgentInit = {
  name: "Issue Triager",
  description: "Sorts new issues",
  instructions: "Triage every new issue.",
  skillRefs: [skillRef("house-style", "org_1")],
  modelOverride: "claude-sonnet-4-5",
  tools: ["Read", "mcp__plugin_gh_github__*"],
  disallowedTools: ["Bash"],
};

describe("the frozen sub-agent", () => {
  it("reads every field of each sub-agent an earlier release wrote, in order", () => {
    const spec = fromBinary(
      AgentSpecSchema,
      specBytes([TRIAGER, { name: "writer", instructions: "Write the notes." }]),
    );
    const [first, second, ...rest] = readSubAgents(spec);
    expect(rest).toEqual([]);
    expect(first).toMatchObject({
      name: "Issue Triager",
      description: "Sorts new issues",
      instructions: "Triage every new issue.",
      modelOverride: "claude-sonnet-4-5",
      tools: ["Read", "mcp__plugin_gh_github__*"],
      disallowedTools: ["Bash"],
    });
    expect(first?.skillRefs.map((ref) => [ref.kind, ref.org, ref.slug])).toEqual([
      [ApiResourceKind.skill, "org_1", "house-style"],
    ]);
    expect(second).toMatchObject({
      name: "writer",
      description: "",
      instructions: "Write the notes.",
      modelOverride: "",
      tools: [],
      disallowedTools: [],
      skillRefs: [],
    });
    // The live fields are read as ever.
    expect(spec.instructions).toBe("Review every pull request with care.");
    expect(spec.tools).toEqual(["Read"]);
  });

  it("survives today's schema reading and writing the row", () => {
    const original = fromBinary(AgentSpecSchema, specBytes([TRIAGER]));
    const rewritten = fromBinary(AgentSpecSchema, toBinary(AgentSpecSchema, original));
    expect(readSubAgents(rewritten)).toEqual(readSubAgents(original));
  });

  it("writes an edited list back where it was, and reads it as written", () => {
    const spec = fromBinary(
      AgentSpecSchema,
      specBytes([TRIAGER, { name: "writer" }], [{ no: 999, text: "after" }]),
    );
    const [triager] = readSubAgents(spec);
    triager!.tools = ["Grep"];
    triager!.skillRefs = [];
    writeSubAgents(spec, [triager!]);

    const reread = fromBinary(AgentSpecSchema, toBinary(AgentSpecSchema, spec));
    const [only, ...rest] = readSubAgents(reread);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ name: "Issue Triager", tools: ["Grep"], skillRefs: [] });
    // The other unknown field keeps its place after the sub-agents.
    expect(((reread as UnknownHolder).$unknown ?? []).map((field) => field.no)).toEqual([
      AGENT_SPEC_SUB_AGENTS_FIELD,
      999,
    ]);
  });

  it("an empty list removes the field, and the holder once nothing else is unknown", () => {
    const withOther = fromBinary(
      AgentSpecSchema,
      specBytes([TRIAGER], [{ no: 999, text: "after" }]),
    );
    writeSubAgents(withOther, []);
    expect(readSubAgents(withOther)).toEqual([]);
    expect(((withOther as UnknownHolder).$unknown ?? []).map((field) => field.no)).toEqual([999]);

    const alone = fromBinary(AgentSpecSchema, specBytes([TRIAGER]));
    writeSubAgents(alone, []);
    expect((alone as UnknownHolder).$unknown).toBeUndefined();
    expect(toBinary(AgentSpecSchema, alone)).toEqual(
      toBinary(AgentSpecSchema, fromBinary(AgentSpecSchema, specBytes([]))),
    );
  });

  it("writes sub-agents onto a spec that held none, and reads none from a spec without them", () => {
    const spec = fromBinary(AgentSpecSchema, specBytes([]));
    expect(readSubAgents(spec)).toEqual([]);
    writeSubAgents(spec, readSubAgents(fromBinary(AgentSpecSchema, specBytes([TRIAGER]))));
    expect(readSubAgents(fromBinary(AgentSpecSchema, toBinary(AgentSpecSchema, spec)))[0]?.name).toBe(
      "Issue Triager",
    );
  });
});
