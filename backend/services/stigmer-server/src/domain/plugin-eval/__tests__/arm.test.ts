/**
 * Pins what each arm of a try attaches (arm.ts): the with-arm lists the
 * plugin under test by its organization and slug, at the digest the eval
 * stamped as the reference's version; the without-arm lists nothing; both
 * run the built-in assistant, so the comparison is not provisional. Pins
 * pluginAttachmentFacts too: the plugin's organization, slug, the given
 * digest, and each MCP server's segment as a turn names it
 * (`plugin_<plugin>_<server>`), built from the plugin's name in entry
 * order.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  McpServerEntrySchema,
  PluginStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import {
  PROVISIONAL_DELTA,
  armAttachment,
  pluginAttachmentFacts,
} from "../arm.js";

const DIGEST = "sha256:0123abcd";

describe("armAttachment", () => {
  const facts = { org: "acme", id: "plg_thermos", slug: "thermos", digest: DIGEST };

  it("lists the plugin by its id at the eval's digest on the with-arm", () => {
    const attached = armAttachment("with", facts);
    expect(attached.plugins).toHaveLength(1);
    expect(attached.plugins[0]).toMatchObject({
      org: "acme",
      kind: ApiResourceKind.plugin,
      id: "plg_thermos",
      slug: "",
      version: DIGEST,
    });
  });

  it("lists it by slug for a context written before references held ids", () => {
    const { id: _id, ...unaddressed } = facts;
    expect(armAttachment("with", unaddressed).plugins[0]).toMatchObject({
      id: "",
      slug: "thermos",
    });
  });

  it("lists nothing on the without-arm, so both arms run the assistant and differ by the plugin alone", () => {
    expect(armAttachment("without", facts)).toEqual({ plugins: [] });
    expect(PROVISIONAL_DELTA).toBe(false);
  });
});

describe("pluginAttachmentFacts", () => {
  it("reads the row's organization, id and slug, takes the digest given, and names each server as a turn does", () => {
    const plugin = create(PluginSchema, {
      metadata: create(ApiResourceMetadataSchema, {
        id: "plg_thermos",
        org: "acme",
        slug: "thermos",
        name: "Thermos Kit",
      }),
      status: create(PluginStatusSchema, {
        mcpServers: [
          create(McpServerEntrySchema, { name: "github" }),
          create(McpServerEntrySchema, { name: "issue.tracker" }),
        ],
      }),
    });
    expect(pluginAttachmentFacts(plugin, DIGEST)).toEqual({
      org: "acme",
      id: "plg_thermos",
      slug: "thermos",
      digest: DIGEST,
      serverSegments: ["plugin_Thermos_Kit_github", "plugin_Thermos_Kit_issue_tracker"],
    });
  });

  it("gives a plugin with no servers, or no status, no segments", () => {
    const plugin = create(PluginSchema, {
      metadata: create(ApiResourceMetadataSchema, { org: "acme", slug: "thermos", name: "thermos" }),
    });
    expect(pluginAttachmentFacts(plugin, DIGEST).serverSegments).toEqual([]);
    expect(pluginAttachmentFacts(create(PluginSchema), DIGEST)).toEqual({
      org: "",
      id: "",
      slug: "",
      digest: DIGEST,
      serverSegments: [],
    });
  });
});
