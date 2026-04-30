import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  buildApprovalState,
  writeApprovalStateFile,
} from "../approval-state.js";

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

  it("adds wildcard entry for each APPROVE decision", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.APPROVE],
    ]);
    const state = buildApprovalState(decisions);
    expect(state.approvedTools).toEqual([{ name: "*", argsPreview: "*" }]);
  });

  it("adds entries for multiple APPROVE decisions", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.APPROVE],
      ["tc-2", ApprovalAction.APPROVE],
    ]);
    const state = buildApprovalState(decisions);
    expect(state.approvedTools).toHaveLength(2);
  });

  it("does not add entries for SKIP decisions", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.SKIP],
    ]);
    const state = buildApprovalState(decisions);
    expect(state.approvedTools).toEqual([]);
  });

  it("does not add entries for REJECT decisions", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.REJECT],
    ]);
    const state = buildApprovalState(decisions);
    expect(state.approvedTools).toEqual([]);
  });

  it("only adds entries for APPROVE, ignoring SKIP and REJECT", () => {
    const decisions = new Map<string, ApprovalAction>([
      ["tc-1", ApprovalAction.APPROVE],
      ["tc-2", ApprovalAction.SKIP],
      ["tc-3", ApprovalAction.REJECT],
      ["tc-4", ApprovalAction.APPROVE],
    ]);
    const state = buildApprovalState(decisions);
    expect(state.approvedTools).toHaveLength(2);
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
