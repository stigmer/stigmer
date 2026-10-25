/**
 * The Claude gate's decisions, one rule per case, in the order the gate
 * takes them (`gate.ts`).
 *
 * Why it matters: on this engine nothing waits for a person yet, so every
 * call the shared default would ask about must be refused, never run; and
 * the engine offers tools of its own beyond what the runtime classifies, so
 * a call to a tool the turn never offered must be refused before any
 * classification is consulted. Each refusal here is written so that it
 * fails if its rule is removed: an undeclared built-in under "trust this
 * whole run", the shell under the default (under both of its names), an
 * edit, a destructive MCP tool and a tool of a server that could not be
 * listed. The allows prove the same table does not over-refuse: a leased
 * category, a read, an MCP tool its server does not mark, the file-edit
 * flows under capture, with review off and into the outputs folder.
 *
 * The engine's two mechanisms (`PreToolUse` and `canUseTool`) read one
 * memoized decision per call id, and neither ever returns a changed input.
 */

import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunSchema, RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApprovalMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { HookInput } from "@anthropic-ai/claude-agent-sdk";

import type { ActiveLeases, McpApprovalDefault } from "../../../shared/approval-policy.js";
import type { ToolApprovalCategory } from "../../../shared/tool-kind.js";
import { unattendedSkipMessage } from "../../../shared/approval-policy.js";
import { secretBlockMessage } from "../../../shared/file-edit-policy.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import {
  ClaudeGate,
  HALTED_MESSAGE,
  NEEDS_APPROVAL_MESSAGE,
  canUseToolOf,
  gateFactsOf,
  notOfferedMessage,
  preToolUseHooks,
  type GateFacts,
} from "../gate.js";

const WORKSPACE = "/work/repo";
const SHELL = "mcp__stigmer__bash";
const OFFERED = new Set(["Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep", "Bash", "TodoWrite", SHELL, "mcp__docs__search", "mcp__docs__drop", "mcp__plugin__any"]);

function leases(over: Partial<{ global: boolean; categories: ToolApprovalCategory[]; servers: string[] }> = {}): ActiveLeases {
  return { global: over.global ?? false, categories: new Set(over.categories ?? []), servers: new Set(over.servers ?? []), hooks: new Set() };
}

function mcpDefault(over: Partial<{ destructive: string[]; unlisted: string[]; leased: string[] }> = {}): McpApprovalDefault {
  return { destructive: new Set(over.destructive ?? []), unlisted: new Set(over.unlisted ?? []), leasedServers: new Set(over.leased ?? []) };
}

function serverOf(toolName: string): { slug: string; tool: string } | undefined {
  const match = /^mcp__([^_]+)__(.+)$/.exec(toolName);
  return match === null || match[1] === "stigmer" ? undefined : { slug: match[1]!, tool: match[2]! };
}

function facts(over: Partial<GateFacts> = {}): GateFacts {
  return {
    offered: OFFERED,
    serverOf,
    leases: leases(),
    mcpDefault: mcpDefault(),
    unattended: false,
    posture: { fileCaptureMode: false, fileReviewOff: false, fileCaptureSubstrate: false, isCapturablePath: async () => false, captureIgnored: false },
    primaryDir: WORKSPACE,
    ...over,
  };
}

async function decide(gate: ClaudeGate, toolName: string, input: Record<string, unknown> = {}, id = `toolu_${toolName}`) {
  return gate.decide(toolName, id, input);
}

describe("the closed world: a tool the turn never offered", () => {
  it("is refused before any policy, even when the whole run is trusted", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ global: true }) }));
    expect(await decide(gate, "WebFetch", { url: "https://example.com" })).toEqual({ allow: false, message: notOfferedMessage("WebFetch"), source: undefined });
    expect(await decide(gate, "mcp__other__call")).toEqual({ allow: false, message: notOfferedMessage("mcp__other__call"), source: undefined });
  });
});

describe("the shell", () => {
  it("is refused under the default, under both of its names, never asked of a person", async () => {
    const gate = new ClaudeGate(facts());
    for (const name of [SHELL, "Bash"]) {
      expect(await decide(gate, name, { command: "rm -rf build" })).toEqual({ allow: false, message: NEEDS_APPROVAL_MESSAGE, source: "builtin_category" });
    }
  });

  it("runs under a shell lease and under a trusted run", async () => {
    expect(await decide(new ClaudeGate(facts({ leases: leases({ categories: ["shell"] }) })), SHELL, { command: "npm test" })).toEqual({ allow: true, source: "approval_lease" });
    expect(await decide(new ClaudeGate(facts({ leases: leases({ global: true }) })), SHELL, { command: "npm test" })).toEqual({ allow: true, source: "auto_approve_all" });
  });

  it("is skipped on an unattended turn, with the shared sentence under the engine's own name, and recorded for the settle", async () => {
    const gate = new ClaudeGate(facts({ unattended: true }));
    expect(await decide(gate, SHELL, { command: "make" }, "toolu_1")).toEqual({ allow: false, message: unattendedSkipMessage("Bash"), source: "unattended_skip" });
    expect([...gate.unattendedSkips]).toEqual([["toolu_1", null]]);
  });
});

describe("file edits", () => {
  it("Write, Edit and NotebookEdit are refused under review with nothing to capture into", async () => {
    const gate = new ClaudeGate(facts());
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/a.ts`, content: "x" })).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
    expect(await decide(gate, "Edit", { file_path: `${WORKSPACE}/a.ts`, old_string: "x", new_string: "y" })).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
    expect(await decide(gate, "NotebookEdit", { notebook_path: `${WORKSPACE}/n.ipynb`, new_source: "" })).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
  });

  it("flow with review off, and under capture for a capturable path, judged in the workspace's own dialect", async () => {
    const asked: string[] = [];
    const capture = facts({
      posture: { fileCaptureMode: true, fileCaptureSubstrate: true, captureIgnored: false, isCapturablePath: async (path) => (asked.push(path), true) },
    });
    expect(await decide(new ClaudeGate(capture), "Edit", { file_path: `${WORKSPACE}/src/a.ts` })).toEqual({ allow: true, source: "file_capture" });
    expect(asked).toContain("/src/a.ts");
    const off = facts({ posture: { fileReviewOff: true, isCapturablePath: async () => false } });
    expect(await decide(new ClaudeGate(off), "Write", { file_path: `${WORKSPACE}/a.ts` })).toEqual({ allow: true, source: "file_review_off" });
  });

  it("flow into the outputs folder where review is off or capture holds", async () => {
    const gate = new ClaudeGate(facts({ posture: { fileCaptureMode: true, isCapturablePath: async () => false } }));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/.stigmer/outputs/report.md` })).toEqual({ allow: true, source: "outputs" });
  });

  it("outside the workspace are never capturable, so they fall to the default", async () => {
    const gate = new ClaudeGate(facts({ posture: { fileCaptureMode: true, fileCaptureSubstrate: true, isCapturablePath: async () => true } }));
    expect(await decide(gate, "Write", { file_path: "/etc/hosts" })).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/../other/a.ts` }, "toolu_up")).toMatchObject({ allow: false, message: NEEDS_APPROVAL_MESSAGE });
  });

  it("a secret-like path is blocked even when a write lease would clear the category", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ categories: ["write"] }), posture: { fileReviewOff: true, isCapturablePath: async () => false } }));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/.env`, content: "KEY=1" })).toEqual({ allow: false, message: secretBlockMessage("Write", "/.env"), source: undefined });
  });

  it("a write leased by category runs", async () => {
    const gate = new ClaudeGate(facts({ leases: leases({ categories: ["write"] }) }));
    expect(await decide(gate, "Write", { file_path: `${WORKSPACE}/a.ts` })).toEqual({ allow: true, source: "approval_lease" });
  });
});

describe("reads and MCP tools", () => {
  it("a read-only built-in runs unasked", async () => {
    expect(await decide(new ClaudeGate(facts()), "Read", { file_path: `${WORKSPACE}/a.ts` })).toEqual({ allow: true, source: undefined });
  });

  it("a tool its server marks destructive is refused; one it does not mark runs; a leased server's runs", async () => {
    const gate = new ClaudeGate(facts({ mcpDefault: mcpDefault({ destructive: ["docs/drop"] }) }));
    expect(await decide(gate, "mcp__docs__drop")).toEqual({ allow: false, message: NEEDS_APPROVAL_MESSAGE, source: "annotation_destructive_tighten" });
    expect(await decide(gate, "mcp__docs__search")).toEqual({ allow: true, source: undefined });
    const leased = new ClaudeGate(facts({ mcpDefault: mcpDefault({ destructive: ["docs/drop"], leased: ["docs"] }) }));
    expect(await decide(leased, "mcp__docs__drop")).toEqual({ allow: true, source: "approval_lease" });
  });

  it("a tool of a server that could not be listed is refused", async () => {
    const gate = new ClaudeGate(facts({ mcpDefault: mcpDefault({ unlisted: ["plugin"] }) }));
    expect(await decide(gate, "mcp__plugin__any")).toEqual({ allow: false, message: NEEDS_APPROVAL_MESSAGE, source: "annotation_destructive_tighten" });
  });
});

describe("one decision per call", () => {
  it("is made once and read back by id; a halted turn refuses only calls it has not decided", async () => {
    let halted = false;
    const gate = new ClaudeGate(facts(), () => halted);
    expect(gate.verdictOf("toolu_a")).toBeUndefined();
    const first = await decide(gate, "Read", {}, "toolu_a");
    halted = true;
    expect(await decide(gate, "Read", {}, "toolu_a")).toBe(first);
    expect(gate.verdictOf("toolu_a")).toBe(first);
    expect(await decide(gate, "Read", {}, "toolu_b")).toEqual({ allow: false, message: HALTED_MESSAGE, source: undefined });
  });

  it("the PreToolUse callback and canUseTool agree, and neither returns a changed input", async () => {
    const gate = new ClaudeGate(facts());
    const callback = preToolUseHooks(gate).PreToolUse![0]!.hooks[0]!;
    const signal = new AbortController().signal;
    const hookInput = (name: string, id: string): HookInput => ({
      hook_event_name: "PreToolUse",
      tool_name: name,
      tool_input: { command: "ls", file_path: `${WORKSPACE}/a.ts` },
      tool_use_id: id,
      session_id: "s",
      transcript_path: "",
      cwd: WORKSPACE,
    });
    expect(await callback(hookInput(SHELL, "toolu_s"), "toolu_s", { signal })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: NEEDS_APPROVAL_MESSAGE },
    });
    expect(await callback(hookInput("Read", "toolu_r"), "toolu_r", { signal })).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } });
    expect(await callback({ ...hookInput("Read", "toolu_x"), hook_event_name: "PostToolUse", tool_response: "" } as HookInput, "toolu_x", { signal })).toEqual({});

    const canUseTool = canUseToolOf(gate);
    const options = { signal, toolUseID: "toolu_s", requestId: "req_1" };
    expect(await canUseTool(SHELL, { command: "ls" }, options)).toEqual({ behavior: "deny", message: NEEDS_APPROVAL_MESSAGE });
    expect(await canUseTool("Read", {}, { ...options, toolUseID: "toolu_r" })).toEqual({ behavior: "allow" });
  });
});

describe("the gate's facts", () => {
  it("are read from the turn's record: leases, capture posture, the workspace root and whether anyone can approve", () => {
    const input = turnInputFixture({
      workspaceDir: WORKSPACE,
      execution: create(RunSchema, { status: create(RunStatusSchema, { approvalMode: ApprovalMode.UNATTENDED }) }),
    });
    const isCapturable = async (): Promise<boolean> => true;
    const read = gateFactsOf(input, OFFERED, serverOf, mcpDefault(), isCapturable);
    expect(read).toMatchObject({ offered: OFFERED, unattended: true, primaryDir: WORKSPACE, leases: input.mcp.leases });
    expect(read.posture).toEqual({
      fileCaptureMode: false,
      fileReviewOff: false,
      fileCaptureSubstrate: false,
      isCapturablePath: isCapturable,
      captureIgnored: false,
    });
  });
});
