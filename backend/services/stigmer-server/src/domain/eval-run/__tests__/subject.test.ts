/**
 * Pins subjectOf (subject.ts): the spec's subject oneof read as an agent
 * or a plugin by id, and no subject for an unset oneof or an empty id;
 * agentIdOf and pluginIdOf answer "" for the other subject.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { EvalRunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";

import { agentIdOf, pluginIdOf, subjectOf } from "../subject.js";

describe("subjectOf", () => {
  it("reads an agent and a plugin subject by id", () => {
    const onAgent = create(EvalRunSpecSchema, { subject: { case: "agentId", value: "agt_1" } });
    const onPlugin = create(EvalRunSpecSchema, { subject: { case: "pluginId", value: "plg_1" } });
    expect(subjectOf(onAgent)).toEqual({ kind: "agent", id: "agt_1" });
    expect(subjectOf(onPlugin)).toEqual({ kind: "plugin", id: "plg_1" });
    expect([agentIdOf(onAgent), pluginIdOf(onAgent)]).toEqual(["agt_1", ""]);
    expect([agentIdOf(onPlugin), pluginIdOf(onPlugin)]).toEqual(["", "plg_1"]);
  });

  it("reads no subject from an unset oneof, an empty id, or no spec", () => {
    expect(subjectOf(create(EvalRunSpecSchema))).toBeUndefined();
    expect(subjectOf(create(EvalRunSpecSchema, { subject: { case: "agentId", value: "" } }))).toBeUndefined();
    expect(subjectOf(undefined)).toBeUndefined();
  });
});
