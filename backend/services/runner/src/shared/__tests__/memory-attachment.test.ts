/**
 * The memory capture attachment (DD-005 D1): the recall-snapshot gate
 * (enabled bit, zero-facts included), both connection shapes with the
 * capture-context carriers, the structural approval-freedom of
 * synthesized attachments, and the cross-repo string pins (route +
 * context keys, guarded here and in the mcp-server memory integration
 * test — the TOOL_CALL_LIMIT precedent). The slug and roster are
 * runner-internal and guarded here alone.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { RecalledMemoriesSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";

import { mergeApprovalPolicies, type ActiveLeases } from "../approval-policy.js";
import { needsBackfill } from "../connect-backfill.js";
import {
  MEMORY_AGENT_ID_ENV,
  MEMORY_AGENT_ID_HEADER,
  MEMORY_ATTACHMENT_SLUG,
  MEMORY_EXECUTION_ID_ENV,
  MEMORY_EXECUTION_ID_HEADER,
  MEMORY_ORG_ENV,
  MEMORY_ORG_HEADER,
  MEMORY_ROUTE,
  MEMORY_SESSION_ID_ENV,
  MEMORY_SESSION_ID_HEADER,
  memoryCaptureEnabled,
  synthesizeMemoryAttachment,
  type MemoryCaptureContext,
} from "../memory-attachment.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";

const context: MemoryCaptureContext = {
  org: "acme",
  agentId: "agt_1",
  sessionId: "ses_1",
  agentExecutionId: "aex_1",
};

const cloudOptions = {
  bridgeEndpoint: "https://mcp.stigmer.ai/",
  credential: "sandbox-token",
  backendEndpoint: "http://localhost:7234",
};

const ossOptions = {
  bridgeEndpoint: null,
  credential: null,
  backendEndpoint: "http://localhost:7234",
};

const noLeases: ActiveLeases = {
  global: false,
  categories: new Set(),
  servers: new Set(),
};

describe("memoryCaptureEnabled (the DD-005 D1 injection signal)", () => {
  it("is the snapshot's enabled bit — absent and disabled read false", () => {
    expect(memoryCaptureEnabled(undefined)).toBe(false);
    expect(memoryCaptureEnabled(create(RecalledMemoriesSchema, { enabled: false }))).toBe(false);
    expect(memoryCaptureEnabled(create(RecalledMemoriesSchema, { enabled: true }))).toBe(true);
  });

  it("enabled with ZERO facts still offers the tool — memory on, nothing stored yet", () => {
    const snapshot = create(RecalledMemoriesSchema, { enabled: true, facts: [] });
    expect(memoryCaptureEnabled(snapshot)).toBe(true);
    expect(synthesizeMemoryAttachment(snapshot, context, cloudOptions)).toBeDefined();
  });
});

describe("synthesizeMemoryAttachment", () => {
  const enabled = create(RecalledMemoriesSchema, { enabled: true });

  it("returns undefined when the snapshot is absent or disabled — honest absence", () => {
    expect(synthesizeMemoryAttachment(undefined, context, cloudOptions)).toBeUndefined();
    expect(
      synthesizeMemoryAttachment(
        create(RecalledMemoriesSchema, { enabled: false }),
        context,
        cloudOptions,
      ),
    ).toBeUndefined();
  });

  it("builds the HTTP shape against the bridge /memory route with credential + context headers", () => {
    const attachment = synthesizeMemoryAttachment(enabled, context, cloudOptions);
    expect(attachment).toMatchObject({
      slug: MEMORY_ATTACHMENT_SLUG,
      connectionType: "http",
      url: "https://mcp.stigmer.ai/memory",
      headers: {
        Authorization: "Bearer sandbox-token",
        [MEMORY_ORG_HEADER]: "acme",
        [MEMORY_AGENT_ID_HEADER]: "agt_1",
        [MEMORY_SESSION_ID_HEADER]: "ses_1",
        [MEMORY_EXECUTION_ID_HEADER]: "aex_1",
      },
    });
  });

  it("builds the OSS stdio shape: the CLI-embedded bridge with the memory roster + context env", () => {
    const attachment = synthesizeMemoryAttachment(enabled, context, ossOptions);
    expect(attachment).toMatchObject({
      connectionType: "stdio",
      command: "stigmer",
      args: ["mcp-server"],
      env: {
        STIGMER_MCP_ROSTER: "memory",
        STIGMER_SERVER_ADDRESS: "localhost:7234",
        [MEMORY_ORG_ENV]: "acme",
        [MEMORY_AGENT_ID_ENV]: "agt_1",
        [MEMORY_SESSION_ID_ENV]: "ses_1",
        [MEMORY_EXECUTION_ID_ENV]: "aex_1",
      },
    });
  });

  it("omits empty context fields from the carrier — best-effort attribution, never blank entries", () => {
    const partial: MemoryCaptureContext = {
      org: "acme",
      agentId: "",
      sessionId: "ses_1",
      agentExecutionId: "",
    };

    const http = synthesizeMemoryAttachment(enabled, partial, cloudOptions);
    expect(Object.keys(http?.headers ?? {}).sort()).toEqual([
      "Authorization",
      MEMORY_ORG_HEADER,
      MEMORY_SESSION_ID_HEADER,
    ].sort());

    const stdio = synthesizeMemoryAttachment(enabled, partial, ossOptions);
    expect(stdio?.env).not.toHaveProperty(MEMORY_AGENT_ID_ENV);
    expect(stdio?.env).not.toHaveProperty(MEMORY_EXECUTION_ID_ENV);
  });

  it("pins the cross-repo strings the mcp-server side guards too", () => {
    expect(MEMORY_ATTACHMENT_SLUG).toBe("stigmer-memory");
    expect(MEMORY_ROUTE).toBe("/memory");
    expect(MEMORY_ORG_HEADER).toBe("x-stigmer-memory-org");
    expect(MEMORY_AGENT_ID_HEADER).toBe("x-stigmer-memory-agent-id");
    expect(MEMORY_SESSION_ID_HEADER).toBe("x-stigmer-memory-session-id");
    expect(MEMORY_EXECUTION_ID_HEADER).toBe("x-stigmer-memory-execution-id");
    expect(MEMORY_ORG_ENV).toBe("STIGMER_MEMORY_ORG");
    expect(MEMORY_AGENT_ID_ENV).toBe("STIGMER_MEMORY_AGENT_ID");
    expect(MEMORY_SESSION_ID_ENV).toBe("STIGMER_MEMORY_SESSION_ID");
    expect(MEMORY_EXECUTION_ID_ENV).toBe("STIGMER_MEMORY_EXECUTION_ID");
  });

  it("is approval-free by construction: zero entries in the merged approval map", () => {
    // Consent is the confirm RPC, not tool approval (DD-005 D3): the
    // tool only creates a proposal, so gating it would stack a second
    // consent gate in front of the real one.
    const attachment = synthesizeMemoryAttachment(enabled, context, cloudOptions)!;
    const merged = mergeApprovalPolicies([attachment as ResolvedMcpServer], noLeases);
    expect(merged.size).toBe(0);
  });

  it("is structurally immune to the connect backfill (destructiveHint tightener)", () => {
    const attachment = synthesizeMemoryAttachment(enabled, context, cloudOptions)!;
    expect(attachment.discoveredCapabilitiesEmpty).toBe(false);
    expect(needsBackfill(attachment)).toBe(false);
  });
});
