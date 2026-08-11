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
  EXPECTED_RECORD_TOOLS,
  formatDatastoreDegradationNotice,
  formatDatastoresSection,
  missingRecordTools,
  synthesizeDatastoreAttachment,
} from "../datastore-attachment.js";
import { injectSynthesizedAttachment } from "../synthesized-attachment.js";
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
    const merged = mergeApprovalPolicies([attachment], NO_LEASES);
    expect(merged.size).toBe(0);
  });

  it("stays approval-free when another server's usage overrides a same-named tool (issue #349)", () => {
    const attachment = synthesizeDatastoreAttachment([usage("clinic")], {
      bridgeEndpoint: "https://mcp.stigmer.ai",
      credential: "tok",
      backendEndpoint: "http://localhost:7234",
    })!;

    // Before #349 a flat override list applied inside every server's merge
    // loop, so this crm override would have force-gated the attachment's
    // delete_record too — and on channels (UNATTENDED mode) a gated tool
    // is silently skipped. Overrides now ride their own server, so the
    // attachment (which has no usage) is immune by construction.
    const crm: ResolvedMcpServer = {
      slug: "crm",
      connectionType: "http",
      url: "https://crm.example.com/mcp",
      toolApprovals: [],
      pinnedToolApprovals: [],
      toolApprovalOverrides: [
        { toolName: "delete_record", requiresApproval: true, message: "" } as any,
      ],
      discoveredCapabilitiesEmpty: false,
    };
    const merged = mergeApprovalPolicies([crm, attachment], NO_LEASES);
    expect(merged.has("crm/delete_record")).toBe(true);
    expect(merged.has(`${DATASTORE_ATTACHMENT_SLUG}/delete_record`)).toBe(false);
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

describe("injectSynthesizedAttachment (the shared injection path)", () => {
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
      toolApprovalOverrides: [],
      discoveredCapabilitiesEmpty: false,
    };
    const result = injectSynthesizedAttachment([other], attachment, "datastore records");
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
      toolApprovalOverrides: [],
      discoveredCapabilitiesEmpty: false,
    };

    const result = injectSynthesizedAttachment([impostor], attachment, "datastore records");

    expect(result).toHaveLength(1);
    expect(result[0].url).toBe("https://mcp.stigmer.ai/records");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("reserved"));
    warnSpy.mockRestore();
  });
});

describe("EXPECTED_RECORD_TOOLS", () => {
  it("pins the records-roster contract: exactly the five tools the mcp-server registers", () => {
    // Drift pin (issue #325): the reconciliation treats ANY of these as
    // mandatory because mcp-server/src/domains/records/tools.ts registers
    // all five unconditionally for the agent audience. If a record tool is
    // ever added, removed, or renamed there, this pin forces the reviewer
    // to update the roster contract deliberately in both places.
    expect([...EXPECTED_RECORD_TOOLS]).toEqual([
      "describe_datastore",
      "find_records",
      "insert_record",
      "update_record",
      "delete_record",
    ]);
  });
});

describe("missingRecordTools", () => {
  it("returns empty when all five record tools are connected", () => {
    expect(missingRecordTools([...EXPECTED_RECORD_TOOLS])).toEqual([]);
  });

  it("returns every expected tool when the roster is empty", () => {
    expect(missingRecordTools([])).toEqual([...EXPECTED_RECORD_TOOLS]);
  });

  it("returns only the absent tools on a partial roster", () => {
    expect(
      missingRecordTools(["describe_datastore", "find_records", "insert_record"]),
    ).toEqual(["update_record", "delete_record"]);
  });

  it("ignores extraneous tool names", () => {
    expect(
      missingRecordTools([...EXPECTED_RECORD_TOOLS, "some_other_tool"]),
    ).toEqual([]);
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

  it("carries the standing failure-disclosure instruction in the healthy section", () => {
    // The only mechanism covering tools that connected but fail at call
    // time (the WhatsApp-pilot outage shape), and the Cursor harness's
    // entire coverage — that harness can never observe the live roster.
    const section = formatDatastoresSection([usage("clinic")]);
    expect(section).toContain("the datastore is unreachable");
    expect(section).toContain("do not answer from memory");
  });

  it("advertises exactly the expected record tools (no hand-written drift)", () => {
    const section = formatDatastoresSection([usage("clinic")]);
    for (const tool of EXPECTED_RECORD_TOOLS) {
      expect(section).toContain(tool);
    }
  });

  it("renders the degraded section instead when record tools are missing", () => {
    const section = formatDatastoresSection(
      [usage("clinic")],
      ["find_records", "insert_record"],
    );
    // Must NOT promise tools the agent does not have — the issue's core
    // complaint (oss#325).
    expect(section).not.toContain("<available_datastores>");
    expect(section).toContain("<unavailable_datastores>");
    expect(section).toContain("find_records, insert_record.");
    expect(section).toContain("- clinic");
    expect(section).toContain("cannot be reached right now");
    expect(section).toContain("Never answer");
    expect(section).toContain("</unavailable_datastores>");
  });

  it("renders healthy when the missing list is empty (negative control)", () => {
    const section = formatDatastoresSection([usage("clinic")], []);
    expect(section).toContain("<available_datastores>");
    expect(section).not.toContain("<unavailable_datastores>");
  });
});

describe("formatDatastoreDegradationNotice", () => {
  it("states declared count, connected fraction, and the missing tools", () => {
    const notice = formatDatastoreDegradationNotice(2, [
      "update_record",
      "delete_record",
    ]);
    expect(notice).toContain("declared 2 datastore(s)");
    expect(notice).toContain("3/5 record tools connected");
    expect(notice).toContain("missing: update_record, delete_record");
    expect(notice).toContain("instructed to disclose");
  });

  it("reads 0/5 on a fully absent roster", () => {
    const notice = formatDatastoreDegradationNotice(1, [...EXPECTED_RECORD_TOOLS]);
    expect(notice).toContain("0/5 record tools connected");
  });
});
