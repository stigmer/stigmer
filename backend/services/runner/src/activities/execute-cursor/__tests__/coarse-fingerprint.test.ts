/**
 * @regression file-hitl-phase0 — pins file-edit HITL fix #6 (see _projects/2026-06/20260630.01.file-change-hitl-redesign/tasks/T01_3_regression-manifest.md)
 *
 * Slice D — the Cursor grant token / fingerprint as the substrate-coarsened
 * projection of the shared canonical action.
 *
 * These tests pin the three properties that give the lease its teeth on the
 * Cursor substrate:
 *  1. hook-side == stream-side: a tool named in the hook taxonomy (`Write`,
 *     `file_path`) and the same action named in the stream taxonomy (`edit`,
 *     `path`) reduce to ONE coarse fingerprint AND one wire token.
 *  2. cross-tool isolation: approving a write never authorizes a shell — the
 *     fingerprints (and tokens) are distinct.
 *  3. the fingerprint shares the deep-agent / cross-language HMAC+canonical path,
 *     so it carries the version tag and matches the corpus contract.
 */

import { describe, it, expect, vi } from "vitest";
import {
  toolIdentity,
  grantFingerprint,
  grantToken,
  emitCursorGrantReceipts,
  type ApprovalGrant,
} from "../approval-state.js";
import { fingerprintCoarseIdentity } from "../../../shared/approval-fingerprint.js";
import { POLICY_ENGINE_VERSION } from "../approval-policy.js";

const KEY = "slice-d-test-key";

function grantOf(toolName: string, mcpServerSlug: string, args: Record<string, unknown>): ApprovalGrant {
  const id = toolIdentity(toolName, mcpServerSlug, args);
  // These tests exercise only the COARSE identity (key/salient); the content
  // digest is not part of the coarse fingerprint or token, so use the documented
  // content-less value ("").
  return { toolName, mcpServerSlug, key: id.key, salient: id.salient, contentDigest: "", sourceToolCallId: "consent-1" };
}

describe("Cursor coarse fingerprint (Slice D)", () => {
  it("hook taxonomy and stream taxonomy yield ONE fingerprint and ONE token", () => {
    const hook = grantOf("Write", "", { file_path: "/x/a.txt" });
    const stream = grantOf("edit", "", { path: "/x/a.txt" });

    expect(grantFingerprint(KEY, hook)).toBe(grantFingerprint(KEY, stream));
    expect(grantToken(hook.key, hook.salient)).toBe(grantToken(stream.key, stream.salient));
  });

  it("cross-tool isolation: a write grant never matches a shell action", () => {
    const write = grantOf("Write", "", { file_path: "/x/a.txt" });
    const shell = grantOf("Shell", "", { command: "rm -rf /x" });

    expect(grantFingerprint(KEY, write)).not.toBe(grantFingerprint(KEY, shell));
    expect(grantToken(write.key, write.salient)).not.toBe(grantToken(shell.key, shell.salient));
  });

  it("different resources of the same category are distinct", () => {
    const a = grantOf("Write", "", { file_path: "/x/a.txt" });
    const b = grantOf("Write", "", { file_path: "/x/b.txt" });
    expect(grantFingerprint(KEY, a)).not.toBe(grantFingerprint(KEY, b));
  });

  it("MCP tools key on tool name (slug-scoped), salient empty", () => {
    const mcp = grantOf("apply_resource", "planton", { path: "ignored" });
    expect(mcp.salient).toBe("");
    expect(grantFingerprint(KEY, mcp)).toBe(
      fingerprintCoarseIdentity(KEY, { tool: "apply_resource", mcpServerSlug: "planton", salient: "" }),
    );
  });

  it("carries the shared version tag (corpus contract)", () => {
    const g = grantOf("Write", "", { file_path: "/x/a.txt" });
    expect(grantFingerprint(KEY, g)).toMatch(/^v1:[0-9a-f]{64}$/);
  });

  it("is key-bound: a different key yields a different fingerprint", () => {
    const g = grantOf("Write", "", { file_path: "/x/a.txt" });
    expect(grantFingerprint("key-1", g)).not.toBe(grantFingerprint("key-2", g));
  });

  it("stamps the policy engine version on each emitted grant receipt", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      emitCursorGrantReceipts([grantOf("Write", "", { file_path: "/x/a.txt" })], KEY, "exec-cursor-1");

      const receipts = logSpy.mock.calls
        .map((c) => String(c[0] ?? ""))
        .filter((line) => line.startsWith("[hitl-gateway] receipt "))
        .map((line) => JSON.parse(line.slice("[hitl-gateway] receipt ".length)) as Record<string, unknown>);

      expect(receipts).toHaveLength(1);
      expect(receipts[0].substrate).toBe("cursor");
      expect(receipts[0].policyEngineVersion).toBe(POLICY_ENGINE_VERSION);
    } finally {
      logSpy.mockRestore();
    }
  });
});
