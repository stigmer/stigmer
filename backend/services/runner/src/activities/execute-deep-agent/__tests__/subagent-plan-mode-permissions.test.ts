/**
 * End-to-end proof (real deepagents + LangGraph runtime, no LLM/network) that a
 * plan-mode SUB-AGENT is read-only BY CONSTRUCTION (issue #255).
 *
 * The parent graph receives PLAN_MODE_PERMISSIONS in setup.ts, but deepagents'
 * parent-permission inheritance covers only spec-style sub-agents — our
 * pre-built CompiledSubAgents bypass `normalizeSubagentSpec` entirely, so
 * `compileSubagents` must bake the rules into each sub-agent graph itself.
 * These tests exercise that exact wiring with NO approval gate installed (the
 * auto-approve-all shape): any denial must come from the permission rules
 * alone, proving plan mode's "read-only by construction, not by gate"
 * contract at the sub-agent level. A contrast case pins that without the
 * rules (act mode) the same write flows — this change is a plan-mode-only
 * delta.
 *
 * The rule under test is the PRODUCTION constant from
 * shared/plan-mode-permissions.ts (the same one setup.ts applies to both
 * graph sites), not a test copy, so a change to the plan-mode permission set
 * re-proves sub-agent coverage automatically.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { PLAN_MODE_PERMISSIONS } from "../../../shared/plan-mode-permissions.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import { compileSubagents } from "../subagent-transformer.js";
import { ScriptedModel, type ScriptSelector } from "../__test-utils__/scripted-model.js";

const SEEDED_CONTENT = "PLAN_MODE_README_TOKEN: hello from the seeded file";

describe("plan-mode sub-agent filesystem permissions (issue #255)", () => {
  let root: string;
  let observer: CasCaptureObserver;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sa-plan-"));
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "notes.md"), SEEDED_CONTENT);
    // Everything is gitignored from the observer's view — the strictest case:
    // every write would be CAS-observed if it ever reached the backend.
    observer = new CasCaptureObserver({ rootDir: root, isIgnored: async () => true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Compile a worker through the production path with NO approval gate, so the
   * permission rules are the only thing standing between the model and the
   * filesystem. `permissions` present = the plan-mode wiring under test;
   * absent = the act-mode contrast.
   */
  async function compileWorker(script: ScriptSelector, planMode: boolean) {
    const compiled = await compileSubagents(
      [{ name: "worker", description: "test worker", systemPrompt: "do the work", tools: [] }],
      {
        approvalGate: null,
        parentModelName: "test-model",
        workspaceRootDir: root,
        casObserver: observer,
        modelFactory: async () => new ScriptedModel(script),
        ...(planMode ? { permissions: PLAN_MODE_PERMISSIONS } : {}),
      },
    );
    expect(compiled).toHaveLength(1);
    return compiled[0];
  }

  function toolResultById(messages: BaseMessage[], toolCallId: string): string {
    const match = messages.find(
      (m): m is ToolMessage => m instanceof ToolMessage && m.tool_call_id === toolCallId,
    );
    expect(match, `expected a tool result for call '${toolCallId}'`).toBeDefined();
    return typeof match!.content === "string" ? match!.content : JSON.stringify(match!.content);
  }

  it("denies write_file and edit_file at the tool level, while read_file still works", async () => {
    // One turn, three tool calls: both mutation tools must be denied by the
    // permission rules; the read must pass through untouched (the deny rule
    // covers the `write` operation class only).
    // Real absolute workspace paths, as production models use (the prompt's
    // file tree is absolute, and the tools' contract says absolute). With
    // permission rules present this is also the only shape that reaches the
    // rules at all: enforcePermission's canonicalization refuses relative
    // paths with a validation error before any rule or backend runs — a
    // different denial, but still nothing written.
    const script: ScriptSelector = () => ({
      toolCalls: [
        { name: "write_file", args: { file_path: join(root, "dist/out.txt"), content: "new file" }, id: "c_write" },
        { name: "edit_file", args: { file_path: join(root, "notes.md"), old_string: "hello", new_string: "HACKED" }, id: "c_edit" },
        { name: "read_file", args: { file_path: join(root, "notes.md") }, id: "c_read" },
      ],
      done: "worker done",
    });

    const worker = await compileWorker(script, true);
    const result = (await worker.runnable.invoke(
      { messages: [new HumanMessage({ content: "go" })] },
      { configurable: { thread_id: "t1" }, recursionLimit: 50 },
    )) as { messages: BaseMessage[] };

    // Both mutations denied with deepagents' permission error, and nothing on disk:
    // the new file was never created and the seeded file is byte-identical.
    expect(toolResultById(result.messages, "c_write")).toMatch(/permission denied for write/i);
    expect(toolResultById(result.messages, "c_edit")).toMatch(/permission denied for write/i);
    await expect(access(join(root, "dist/out.txt"))).rejects.toThrow();
    expect(await readFile(join(root, "notes.md"), "utf8")).toBe(SEEDED_CONTENT);

    // The read flowed: its result carries the seeded content, not a denial.
    const readResult = toolResultById(result.messages, "c_read");
    expect(readResult).toContain("PLAN_MODE_README_TOKEN");
    expect(readResult).not.toMatch(/permission denied/i);

    // The denial fired INSIDE the tool handler, before any backend was reached:
    // the CAS observer (which records pre-write bytes on the backend's write/edit
    // seams) saw neither mutation.
    expect(observer.before.size).toBe(0);
  });

  it("act-mode contrast: without the permissions option the same write lands (zero-delta outside plan mode)", async () => {
    const script: ScriptSelector = () => ({
      toolCalls: [
        { name: "write_file", args: { file_path: join(root, "dist/out.txt"), content: "new file" }, id: "c_write" },
      ],
      done: "worker done",
    });

    const worker = await compileWorker(script, false);
    const result = (await worker.runnable.invoke(
      { messages: [new HumanMessage({ content: "go" })] },
      { configurable: { thread_id: "t2" }, recursionLimit: 50 },
    )) as { messages: BaseMessage[] };

    expect(toolResultById(result.messages, "c_write")).not.toMatch(/permission denied/i);
    expect(await readFile(join(root, "dist/out.txt"), "utf8")).toBe("new file");
    // And the backend WAS reached this time — the observer recorded a write.
    // (Key shape is DD-19 territory, deliberately not pinned here.)
    expect(observer.before.size).toBe(1);
  });

  it("relative-path mutations are refused too — by validation, before the rules", async () => {
    // The native prompt steers models to workspace-relative paths, but
    // deepagents' permission canonicalization accepts only absolute ones, so
    // with rules present a relative-path call fails validation before any
    // rule (or backend) runs. Read-only still holds — nothing is written —
    // but the model sees "path must be absolute", not "permission denied",
    // and prompt-compliant relative READS degrade the same way. That
    // relative-vs-absolute friction is a pre-existing parent-plan-mode
    // behavior, tracked as issue #429; this pins that the sub-agent's
    // read-only contract survives it.
    const script: ScriptSelector = () => ({
      toolCalls: [
        { name: "write_file", args: { file_path: "dist/out.txt", content: "new file" }, id: "c_write_rel" },
      ],
      done: "worker done",
    });

    const worker = await compileWorker(script, true);
    const result = (await worker.runnable.invoke(
      { messages: [new HumanMessage({ content: "go" })] },
      { configurable: { thread_id: "t3" }, recursionLimit: 50 },
    )) as { messages: BaseMessage[] };

    expect(toolResultById(result.messages, "c_write_rel")).toMatch(/path must be absolute/i);
    await expect(access(join(root, "dist/out.txt"))).rejects.toThrow();
    expect(observer.before.size).toBe(0);
  });
});
