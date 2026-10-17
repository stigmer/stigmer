/**
 * Pins what each arm of a try attaches (arm.ts): both arms' sessions are
 * the same (the agent pinned by id at its stamped version, none on an eval
 * run of a plugin, and every plugin a try loads listed by id at its
 * stamped digest, the compared one included); an arm is its exclusion, the
 * without arm leaving out exactly the compared plugin and the with arm
 * nothing, and with no plugin compared neither arm leaves anything out.
 * Pins pluginAttachmentFacts too: the plugin's organization, id, slug, the
 * given digest, and each MCP server's segment as a turn names it
 * (`plugin_<plugin>_<server>`), built from the plugin's name in entry
 * order.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  McpServerEntrySchema,
  PluginStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";

import { excludedIn, loadedIn, pluginAttachmentFacts, tryAttachment } from "../arm.js";
import type { TryLoad } from "../arm.js";

const AGENT = { org: "acme", id: "agt_support", slug: "support", versionHash: "a".repeat(64) };
const REFUNDS = { org: "acme", id: "plg_refunds", slug: "refunds", digest: "b".repeat(64) };
const TRACKER = { org: "acme", id: "plg_tracker", slug: "tracker", digest: "c".repeat(64) };

describe("tryAttachment", () => {
  const load: TryLoad = { agent: AGENT, plugins: [TRACKER, REFUNDS], comparedPluginId: REFUNDS.id };

  it("gives both arms the same session: the agent at its version and every plugin at its digest, by id", () => {
    for (const arm of ["with", "without"] as const) {
      const attached = tryAttachment(load, arm);
      expect(attached.agentRef, arm).toMatchObject({
        org: "acme",
        kind: ApiResourceKind.agent,
        id: AGENT.id,
        slug: "",
        version: AGENT.versionHash,
      });
      expect(attached.plugins.map((ref) => [ref.kind, ref.id, ref.slug, ref.version]), arm).toEqual([
        [ApiResourceKind.plugin, TRACKER.id, "", TRACKER.digest],
        [ApiResourceKind.plugin, REFUNDS.id, "", REFUNDS.digest],
      ]);
    }
  });

  it("leaves out exactly the compared plugin in the without arm, and nothing in the with arm", () => {
    expect(tryAttachment(load, "without").excludedPluginIds).toEqual([REFUNDS.id]);
    expect(tryAttachment(load, "with").excludedPluginIds).toEqual([]);
  });

  it("runs the built-in assistant on an eval run of a plugin, the plugin listed in both arms", () => {
    const pluginLoad: TryLoad = { agent: undefined, plugins: [REFUNDS], comparedPluginId: REFUNDS.id };
    const without = tryAttachment(pluginLoad, "without");
    expect(without.agentRef).toBeUndefined();
    expect(without.plugins.map((ref) => ref.id)).toEqual([REFUNDS.id]);
    expect(without.excludedPluginIds).toEqual([REFUNDS.id]);
  });

  it("leaves nothing out in either arm when no plugin is compared", () => {
    const own: TryLoad = { agent: AGENT, plugins: [TRACKER], comparedPluginId: undefined };
    expect(tryAttachment(own, "with").excludedPluginIds).toEqual([]);
    expect(tryAttachment(own, "without").excludedPluginIds).toEqual([]);
  });
});

describe("excludedIn and loadedIn", () => {
  it("load every plugin but the compared one in the without arm", () => {
    expect(excludedIn(REFUNDS.id, "without")).toEqual([REFUNDS.id]);
    expect(excludedIn(undefined, "without")).toEqual([]);
    expect(loadedIn(REFUNDS.id, REFUNDS.id, "without")).toBe(false);
    expect(loadedIn(TRACKER.id, REFUNDS.id, "without")).toBe(true);
    expect(loadedIn(REFUNDS.id, REFUNDS.id, "with")).toBe(true);
  });
});

describe("pluginAttachmentFacts", () => {
  it("reads the organization, id and slug, keeps the given digest, and names each server as a turn does", () => {
    const plugin = create(PluginSchema, {
      metadata: create(ApiResourceMetadataSchema, { org: "acme", id: "plg_tracker", slug: "tracker", name: "tracker" }),
      status: create(PluginStatusSchema, {
        digest: "ignored",
        mcpServers: [create(McpServerEntrySchema, { name: "issues" }), create(McpServerEntrySchema, { name: "boards" })],
      }),
    });
    expect(pluginAttachmentFacts(plugin, TRACKER.digest)).toEqual({
      org: "acme",
      id: "plg_tracker",
      slug: "tracker",
      digest: TRACKER.digest,
      serverSegments: ["plugin_tracker_issues", "plugin_tracker_boards"],
    });
  });
});
