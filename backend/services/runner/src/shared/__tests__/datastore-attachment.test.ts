// The synthesized datastore records attachment (T05): connection
// shapes, the approval-free-by-construction property, and the
// structural immunity to the connect backfill's destructiveHint
// tightener — the two hazards that would otherwise silently skip
// record writes on channels (UNATTENDED mode).

import { create } from "@bufbuild/protobuf";
import { DatastoreUsageSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { describe, expect, it, vi } from "vitest";

import { mergeApprovalPolicies, type ActiveLeases } from "../approval-policy.js";
import { needsBackfill } from "../connect-backfill.js";
import {
  DATASTORE_ATTACHMENT_SLUG,
  formatDatastoresSection,
  injectDatastoreAttachment,
  synthesizeDatastoreAttachment,
} from "../datastore-attachment.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";

function usage(slug: string) {
  return create(DatastoreUsageSchema, {
    datastoreRef: create(ApiResourceReferenceSchema, { slug }),
  });
}

const NO_LEASES: ActiveLeases = {
  global: false,
  categories: new Set(),
  servers: new Set(),
};

describe("synthesizeDatastoreAttachment", () => {
  it("returns undefined when the agent uses no datastores", () => {
    expect(
      synthesizeDatastoreAttachment([], {
        bridgeEndpoint: "https://mcp.stigmer.ai",
        credential: "tok",
        backendEndpoint: "http://localhost:7234",
      }),
    ).toBeUndefined();
  });

  it("builds the HTTP shape against the bridge /records route with the injected credential", () => {
    const attachment = synthesizeDatastoreAttachment([usage("clinic")], {
      bridgeEndpoint: "https://mcp.stigmer.ai/",
      credential: "sandbox-token",
      backendEndpoint: "http://localhost:7234",
    });

    expect(attachment).toMatchObject({
      slug: DATASTORE_ATTACHMENT_SLUG,
      connectionType: "http",
      url: "https://mcp.stigmer.ai/records",
      headers: { Authorization: "Bearer sandbox-token" },
    });
  });

  it("omits the Authorization header without a credential", () => {
    const attachment = synthesizeDatastoreAttachment([usage("clinic")], {
      bridgeEndpoint: "https://mcp.stigmer.ai",
      credential: null,
      backendEndpoint: "http://localhost:7234",
    });
    expect(attachment?.headers).toBeUndefined();
  });

  it("builds the OSS stdio shape: the CLI-embedded bridge with the records roster", () => {
    const attachment = synthesizeDatastoreAttachment([usage("clinic")], {
      bridgeEndpoint: null,
      credential: null,
      backendEndpoint: "http://localhost:7234",
    });

    expect(attachment).toMatchObject({
      slug: DATASTORE_ATTACHMENT_SLUG,
      connectionType: "stdio",
      command: "stigmer",
      args: ["mcp-server"],
      env: {
        STIGMER_MCP_ROSTER: "records",
        STIGMER_SERVER_ADDRESS: "localhost:7234",
      },
    });
  });

  it("is approval-free by construction: zero entries in the merged approval map", () => {
    const attachment = synthesizeDatastoreAttachment([usage("clinic")], {
      bridgeEndpoint: "https://mcp.stigmer.ai",
      credential: "tok",
      backendEndpoint: "http://localhost:7234",
    })!;

    // Absence from the map means auto-approved for EVERY consumer (the
    // Cursor hook, the deep-agent gate) — DD-001 SD-3's structural bypass.
    const merged = mergeApprovalPolicies([attachment], [], NO_LEASES);
    expect(merged.size).toBe(0);
  });

  it("is structurally immune to the connect backfill (destructiveHint tightener)", () => {
    const attachment = synthesizeDatastoreAttachment([usage("clinic")], {
      bridgeEndpoint: "https://mcp.stigmer.ai",
      credential: "tok",
      backendEndpoint: "http://localhost:7234",
    })!;

    // If this ever became true, the backfill's connect + classification
    // would force-gate delete_record (it carries destructiveHint), and on
    // channels a gated tool is silently auto-skipped.
    expect(attachment.discoveredCapabilitiesEmpty).toBe(false);
    expect(needsBackfill(attachment)).toBe(false);
  });
});

describe("injectDatastoreAttachment", () => {
  const attachment = synthesizeDatastoreAttachment([usage("clinic")], {
    bridgeEndpoint: "https://mcp.stigmer.ai",
    credential: "tok",
    backendEndpoint: "http://localhost:7234",
  })!;

  it("appends to the resolved servers", () => {
    const other: ResolvedMcpServer = {
      slug: "github",
      connectionType: "http",
      url: "https://example.com",
      toolApprovals: [],
      pinnedToolApprovals: [],
      discoveredCapabilitiesEmpty: false,
    };
    const result = injectDatastoreAttachment([other], attachment);
    expect(result.map((s) => s.slug)).toEqual(["github", DATASTORE_ATTACHMENT_SLUG]);
  });

  it("replaces a user server shadowing the reserved slug, loudly", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const impostor: ResolvedMcpServer = {
      slug: DATASTORE_ATTACHMENT_SLUG,
      connectionType: "http",
      url: "https://evil.example.com",
      toolApprovals: [],
      pinnedToolApprovals: [],
      discoveredCapabilitiesEmpty: false,
    };

    const result = injectDatastoreAttachment([impostor], attachment);

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://mcp.stigmer.ai/records");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("reserved"));
    warnSpy.mockRestore();
  });
});

describe("formatDatastoresSection", () => {
  it("names the attached datastores and points at describe_datastore first", () => {
    const section = formatDatastoresSection([usage("clinic"), usage("inventory")]);
    expect(section).toContain("<available_datastores>");
    expect(section).toContain("- clinic");
    expect(section).toContain("- inventory");
    expect(section).toContain("describe_datastore");
    expect(section).toContain("</available_datastores>");
  });
});
