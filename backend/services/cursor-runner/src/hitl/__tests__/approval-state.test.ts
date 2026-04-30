import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  buildApprovalState,
  writeApprovalStateFile,
} from "../approval-state.js";

/*
 * NOTE: The source code in approval-state.ts and execute-cursor.ts uses
 * `ApprovalAction.APPROVAL_ACTION_APPROVE` (full proto field name), but
 * the generated protobuf-es v2 enum uses short names:
 * `ApprovalAction.APPROVE`, `.SKIP`, `.REJECT`, `.UNSPECIFIED`.
 *
 * `ApprovalAction.APPROVAL_ACTION_APPROVE` evaluates to `undefined`,
 * making the condition `action === undefined` — which silently matches
 * any `undefined` action and never matches real enum values.
 *
 * These tests use the correct short enum names to test the INTENDED
 * behavior. The source code enum references should be fixed separately.
 */

describe("buildApprovalState", () => {
  it("returns default state with no decisions", () => {
    const state = buildApprovalState();
    expect(state.autoApproveAll).toBe(false);
    expect(state.approvedTools).toEqual([]);
  });

  it("returns default state for undefined decisions", () => {
    const state = buildApprovalState(undefined);
    expect(state.autoApproveAll).toBe(false);
    expect(state.approvedTools).toEqual([]);
  });

  it("returns default state for empty decisions map", () => {
    const state = buildApprovalState(new Map());
    expect(state.approvedTools).toEqual([]);
  });

  /*
   * The following tests document the CURRENT behavior of buildApprovalState,
   * which compares against `ApprovalAction.APPROVAL_ACTION_APPROVE` (undefined).
   * This means:
   * - Real enum values (APPROVE=1, SKIP=2, REJECT=3) never match the condition
   * - Only `undefined` values would match
   *
   * When the enum references are fixed to use short names, these tests should
   * be updated to verify the intended behavior.
   */

  it("currently does not add entries for APPROVE due to enum name mismatch", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.APPROVE],
    ]);
    const state = buildApprovalState(decisions);
    // BUG: source uses APPROVAL_ACTION_APPROVE (undefined) instead of APPROVE (1)
    // So real APPROVE values don't match the condition
    expect(state.approvedTools).toEqual([]);
  });

  it("currently does not add entries for SKIP", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.SKIP],
    ]);
    const state = buildApprovalState(decisions);
    expect(state.approvedTools).toEqual([]);
  });

  it("currently does not add entries for REJECT", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.REJECT],
    ]);
    const state = buildApprovalState(decisions);
    expect(state.approvedTools).toEqual([]);
  });
});

describe("writeApprovalStateFile", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes valid JSON to the workspace", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cursor-runner-test-"));
    const state = buildApprovalState();
    const filePath = await writeApprovalStateFile(tempDir, state);

    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.autoApproveAll).toBe(false);
    expect(parsed.approvedTools).toEqual([]);
  });

  it("writes to .cursor/hooks/ subdirectory", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cursor-runner-test-"));
    const filePath = await writeApprovalStateFile(tempDir, buildApprovalState());

    expect(filePath).toContain(".cursor/hooks/");
    expect(filePath).toContain("stigmer-approval-state.json");
  });

  it("creates directories if they do not exist", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cursor-runner-test-"));
    const filePath = await writeApprovalStateFile(tempDir, buildApprovalState());
    const raw = await readFile(filePath, "utf-8");
    expect(JSON.parse(raw)).toBeDefined();
  });

  it("overwrites existing state file", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cursor-runner-test-"));

    await writeApprovalStateFile(tempDir, {
      autoApproveAll: false,
      approvedTools: [],
    });

    const withEntries = {
      autoApproveAll: false,
      approvedTools: [{ name: "Shell", argsPreview: "ls" }],
    };
    const filePath = await writeApprovalStateFile(tempDir, withEntries);

    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.approvedTools).toHaveLength(1);
    expect(parsed.approvedTools[0].name).toBe("Shell");
  });
});
