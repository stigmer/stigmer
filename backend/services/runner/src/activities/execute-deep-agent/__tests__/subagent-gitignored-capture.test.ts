/**
 * End-to-end proof (real deepagents + LangGraph runtime, no LLM/network) that a
 * SUB-AGENT's gitignored file writes are captured for CAS review at parity with
 * the parent (Session 26, DD-19).
 *
 * These tests exercise the ACTUAL wiring under change — `compileSubagents` — which
 * installs a CAS-observing backend on each sub-agent and flips its gate to flow
 * gitignored writes (both derived from the shared observer, so "unobserved bytes"
 * is impossible by construction). A non-secret gitignored write flows and is
 * observed; a secret-like one is hard-blocked with nothing written; a git-tracked
 * write is left to the boundary git diff (not observed).
 *
 * Scope note: the turn-boundary CANDIDATE authoring, `changeSetId`/`turnSeq`, and
 * the Temporal resume loop are parent/activity-level machinery unchanged by this
 * work (covered by the offline/corpus suites). These tests assert the observer
 * capture surface (before-bytes + blocked-secret paths + on-disk result) that
 * those consumers read.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createDeepAgent, StateBackend } from "deepagents";
import type { ApprovalGateConfig } from "../../../middleware/approval-gate.js";
import { partitionIgnoredPathsBySecret } from "../../../shared/filereview/secret-paths.js";
import { resolveWorkspacePath } from "../../../shared/file-change.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import { compileSubagents, type TransformedSubagent } from "../subagent-transformer.js";
import { ScriptedModel, readPendingInterrupts, type ScriptSelector } from "../__test-utils__/scripted-model.js";

/** Only `src/**` is git-tracked (capturable); everything else is gitignored. */
const isTracked = (relPath: string): boolean => relPath.startsWith("src/");

describe("sub-agent gitignored capture (DD-19)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sa-cas-"));
    await mkdir(join(root, "dist"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "cache"), { recursive: true });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function makeObserver(): CasCaptureObserver {
    return new CasCaptureObserver({
      rootDir: root,
      isIgnored: async (relPath) => !isTracked(relPath),
    });
  }

  /**
   * A capture-mode gate wired to `observer`, exactly as setup.ts builds the parent
   * gate and buildSubAgentMiddleware inherits it when a CAS observer backs the
   * sub-agent (captureIgnored true).
   */
  function captureGate(observer: CasCaptureObserver): ApprovalGateConfig {
    return {
      policies: new Map(),
      toolServerMap: new Map(),
      fileCaptureMode: true,
      isCapturablePath: async (raw: string) =>
        isTracked(resolveWorkspacePath(raw, root, true).path),
      captureIgnored: true,
      recordBlockedSecret: (raw: string) => observer.recordBlockedSecret(raw),
    };
  }

  /**
   * Compile a sub-agent through the production path (the code under change), with
   * the shared CAS observer so its backend + gate are the real capture wiring.
   */
  async function compileWorker(
    observer: CasCaptureObserver,
    script: ScriptSelector,
    tools: TransformedSubagent["tools"] = [],
  ) {
    const compiled = await compileSubagents(
      [{ name: "worker", description: "test worker", systemPrompt: "do the work", tools }],
      {
        approvalGate: captureGate(observer),
        parentModelName: "test-model",
        workspaceRootDir: root,
        casObserver: observer,
        modelFactory: async () => new ScriptedModel(script),
      },
    );
    expect(compiled).toHaveLength(1);
    return compiled[0];
  }

  it("captures a sub-agent's non-secret gitignored write, hard-blocks a secret one, and leaves git-tracked to the git diff", async () => {
    const observer = makeObserver();

    // A single worker; script it to write three files in one turn (no `task`, so
    // no sub-agent delegation ambiguity — we invoke the compiled sub-agent, which
    // IS what the parent dispatches, directly).
    const script: ScriptSelector = () => ({
      toolCalls: [
        { name: "write_file", args: { file_path: "dist/app.js", content: "console.log(1)" }, id: "w_ignored" },
        { name: "write_file", args: { file_path: ".env", content: "SECRET=shh" }, id: "w_secret" },
        { name: "write_file", args: { file_path: "src/app.ts", content: "export const x = 1;" }, id: "w_tracked" },
      ],
      done: "worker done",
    });

    const worker = await compileWorker(observer, script);
    await worker.runnable.invoke(
      { messages: [new HumanMessage({ content: "go" })] },
      { configurable: { thread_id: "t1" }, recursionLimit: 50 },
    );

    // Non-secret gitignored write: flowed (on disk) AND observed (before=null ADD).
    expect(await readFile(join(root, "dist/app.js"), "utf8")).toBe("console.log(1)");
    expect(observer.before.has("dist/app.js")).toBe(true);
    expect(observer.before.get("dist/app.js")).toBeNull();

    // Secret-like gitignored write: hard-blocked — nothing written, path recorded.
    await expect(access(join(root, ".env"))).rejects.toThrow();
    expect([...observer.blockedSecretPaths]).toContain(".env");

    // Git-tracked write: flowed to disk but NOT observed (the git diff owns it).
    expect(await readFile(join(root, "src/app.ts"), "utf8")).toBe("export const x = 1;");
    expect(observer.before.has("src/app.ts")).toBe(false);

    // Bridge to the boundary: the observer state partitions into a
    // GIT_IGNORED_CAPTURED (dist/app.js) and a DIFF_UNREVIEWABLE (.env), exactly
    // as buildCasTurnCaptures does at the turn boundary.
    const { capturablePaths, unreviewablePaths } = partitionIgnoredPathsBySecret(
      observer.before.keys(),
      observer.blockedSecretPaths,
    );
    expect([...capturablePaths]).toEqual(["dist/app.js"]);
    expect([...unreviewablePaths]).toEqual([".env"]);
  });

  it("mixed turn: a sub-agent's gitignored write is captured even when the same turn pauses on a gated tool, and resume completes", async () => {
    const observer = makeObserver();
    let shellRuns = 0;
    // `shell` classifies as the SHELL category, so capture mode never bypasses it —
    // it interrupts (parity with the parent). `cas_marker` is a role marker unique
    // to the worker (the parent lacks it), used only to select the worker's script
    // branch — deepagents auto-injects `task` into every agent, so `task` cannot
    // distinguish the roles.
    const shell = tool(async () => { shellRuns += 1; return "ran"; }, {
      name: "shell",
      description: "run a command",
      schema: z.object({ command: z.string() }),
    });
    const marker = tool(async () => "noop", {
      name: "cas_marker",
      description: "worker role marker",
      schema: z.object({}),
    });

    const script: ScriptSelector = (toolNames) =>
      toolNames.includes("cas_marker")
        ? {
            toolCalls: [
              { name: "write_file", args: { file_path: "cache/data.txt", content: "cached" }, id: "w_ignored" },
              { name: "shell", args: { command: "echo hi" }, id: "sh_1" },
            ],
            done: "worker done",
          }
        : {
            toolCalls: [
              { name: "task", args: { description: "work", subagent_type: "worker" }, id: "task_1" },
            ],
            done: "parent done",
          };

    const worker = await compileWorker(observer, script, [shell, marker] as TransformedSubagent["tools"]);

    const parent = await createDeepAgent({
      model: new ScriptedModel(script),
      checkpointer: new MemorySaver() as never,
      backend: new StateBackend(),
      subagents: [{ name: worker.name, description: worker.description, runnable: worker.runnable as never }],
    } as unknown as Parameters<typeof createDeepAgent>[0]);

    const config = { configurable: { thread_id: "t2" }, recursionLimit: 50 };

    // Invocation 1: the gitignored write flows and is captured BEFORE the turn
    // pauses on the gated shell tool (the shell must NOT have run yet).
    await parent.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);

    const pending = readPendingInterrupts((await parent.getState(config)) as never);
    expect(pending.some((p) => p.toolCallId === "sh_1")).toBe(true);
    expect(shellRuns).toBe(0);
    expect(await readFile(join(root, "cache/data.txt"), "utf8")).toBe("cached");
    expect(observer.before.get("cache/data.txt")).toBeNull();

    // Resume with APPROVE: the worker re-runs (no checkpointer) and the shell runs
    // once. First-touch-wins keeps the single pre-turn baseline for the re-written
    // gitignored file (no duplicate, no post-write baseline).
    const resumeDict: Record<string, { action: string }> = {};
    for (const p of pending) resumeDict[p.interruptId] = { action: "approve" };
    await parent.invoke(new Command({ resume: resumeDict }), config);

    expect(readPendingInterrupts((await parent.getState(config)) as never).length).toBe(0);
    expect(shellRuns).toBe(1);
    expect(observer.before.size).toBe(1);
    expect(observer.before.get("cache/data.txt")).toBeNull();
  });
});
