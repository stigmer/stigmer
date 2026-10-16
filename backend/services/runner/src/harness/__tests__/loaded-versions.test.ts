/**
 * Pins the record of what a turn loaded (`../loaded-versions.ts`):
 *  - each list keeps the turn's resolution order, root first, then each
 *    subagent's, and holds each (id, version) once, the first kept;
 *  - a skill at two versions is two entries;
 *  - every plugin is listed at its digest, a saved subagent's only when the
 *    harness runs subagents;
 *  - a turn that loaded nothing records nothing;
 *  - a skill or plugin with no id is refused, never written as an entry the
 *    server would refuse.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { PluginSchema, type Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";

import type { SavedSubagent } from "../../shared/blueprint-resolver.js";
import { loadedVersionsOf } from "../loaded-versions.js";

const skill = (id: string, version: string) =>
  create(ApiResourceReferenceSchema, { org: "org_a", kind: ApiResourceKind.skill, id, version });

const plugin = (id: string, digest: string): Plugin =>
  create(PluginSchema, { metadata: { org: "org_a", id, name: id }, status: { digest } });

const subagent = (name: string, plugins: Plugin[]): SavedSubagent => ({
  name,
  agentId: `agt_${name}`,
  versionHash: "",
  spec: create(AgentSpecSchema),
  plugins,
});

const pairs = (refs: readonly { id: string; version: string }[] | undefined) => refs?.map((r) => [r.id, r.version]);

describe("loadedVersionsOf", () => {
  it("keeps resolution order, root first, and each (id, version) once, the first kept", () => {
    const loaded = loadedVersionsOf(
      [skill("skl_root", "1"), skill("skl_shared", "2"), skill("skl_sub", "3"), skill("skl_shared", "2"), skill("skl_shared", "4")],
      { plugins: [plugin("plg_root", "d1")], subagents: [subagent("helper", [plugin("plg_sub", "d2"), plugin("plg_root", "d1")])] },
      true,
    );
    expect(pairs(loaded?.skills)).toEqual([
      ["skl_root", "1"],
      ["skl_shared", "2"],
      ["skl_sub", "3"],
      ["skl_shared", "4"],
    ]);
    expect(pairs(loaded?.plugins)).toEqual([
      ["plg_root", "d1"],
      ["plg_sub", "d2"],
    ]);
    expect(loaded?.plugins.map((r) => [r.org, r.kind])).toEqual([
      ["org_a", ApiResourceKind.plugin],
      ["org_a", ApiResourceKind.plugin],
    ]);
  });

  it("leaves a saved subagent's plugins out for a harness that runs no subagents", () => {
    const loaded = loadedVersionsOf([], { plugins: [plugin("plg_root", "d1")], subagents: [subagent("helper", [plugin("plg_sub", "d2")])] }, false);
    expect(pairs(loaded?.plugins)).toEqual([["plg_root", "d1"]]);
    expect(loaded?.skills).toEqual([]);
  });

  it("records nothing for a turn that loaded nothing", () => {
    expect(loadedVersionsOf([], { plugins: [], subagents: [subagent("helper", [plugin("plg_sub", "d2")])] }, false)).toBeUndefined();
  });

  it("refuses a skill or plugin with no id", () => {
    expect(() => loadedVersionsOf([skill("", "1")], { plugins: [], subagents: [] }, true)).toThrow(/a loaded skill has no id/);
    expect(() => loadedVersionsOf([], { plugins: [plugin("", "d1")], subagents: [] }, true)).toThrow(/a loaded plugin has no id/);
  });
});
