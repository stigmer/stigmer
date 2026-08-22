/**
 * The deep-agent MCP gate, arm by arm. A missing arm here means a tool
 * source silently dropped for exactly the agents whose only source it
 * is — the failure DD-006 D7 documented for channel messaging and the
 * reason the predicate lives in its own testable module instead of
 * inline in setup.ts (whose import graph forbids a setup.test.ts).
 */

import { describe, expect, it } from "vitest";

import { shouldConnectMcp } from "../mcp-gate.js";

const nothing = {
  mcpServerUsageCount: 0,
  channelMessagingCount: 0,
  conversationChannelId: undefined,
  memoryCaptureEnabled: false,
};

describe("shouldConnectMcp", () => {
  it("skips the MCP block when no tool source exists", () => {
    expect(shouldConnectMcp(nothing)).toBe(false);
  });

  it("enters on declared MCP server usages alone", () => {
    expect(shouldConnectMcp({ ...nothing, mcpServerUsageCount: 1 })).toBe(true);
  });

  it("enters on a serving proactive channel alone (the channels attachment)", () => {
    expect(shouldConnectMcp({ ...nothing, channelMessagingCount: 1 })).toBe(true);
  });

  it("enters on a channel conversation alone (the conversation attachment)", () => {
    // The reply-only pilot shape: no declared servers, no proactive
    // channel — the escalation tool is the ONLY source.
    expect(shouldConnectMcp({ ...nothing, conversationChannelId: "agch_1" })).toBe(true);
  });

  it("enters on memory capture alone (the memory attachment)", () => {
    // A tool-less agent whose user has memory on: the remember tool is
    // the ONLY source, and skipping the block would silently drop it.
    expect(shouldConnectMcp({ ...nothing, memoryCaptureEnabled: true })).toBe(true);
  });
});
