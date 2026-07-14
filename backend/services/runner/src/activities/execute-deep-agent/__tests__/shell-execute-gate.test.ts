/**
 * Shell `execute` tool approval gating and general-purpose sub-agent gating.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HumanMessage } from "@langchain/core/messages";
import { Command, MemorySaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";
import { createApprovalGateMiddleware } from "../../../middleware/approval-gate.js";
import { createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import {
  registerStigmerDeepagentsProfiles,
  resetStigmerDeepagentsProfilesForTests,
} from "../deepagents-profiles.js";
import {
  ScriptedModel,
  readPendingInterrupts,
  type ScriptSelector,
} from "../__test-utils__/scripted-model.js";
import { compileSubagents, type TransformedSubagent } from "../subagent-transformer.js";

describe("native harness shell execute approval", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "shell-gate-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("interrupts before execute runs and resumes after approval", async () => {
    const marker = join(root, "shell-marker.txt");
    const script: ScriptSelector = () => ({
      toolCalls: [{
        name: "execute",
        args: { command: `echo ran > shell-marker.txt` },
        id: "exec_1",
      }],
      done: "shell done",
    });

    const observer = new CasCaptureObserver({
      rootDir: root,
      isIgnored: async () => false,
    });
    const backend = await createCasCaptureBackend({
      rootDir: root,
      observer,
      shellEnv: {},
    });

    const checkpointer = new MemorySaver();
    const agent = await createDeepAgent({
      model: new ScriptedModel(script),
      checkpointer: checkpointer as never,
      backend,
      middleware: [
        createApprovalGateMiddleware({ policies: new Map(), toolServerMap: new Map() }),
      ],
    } as Parameters<typeof createDeepAgent>[0]);

    const config = { configurable: { thread_id: "shell-thread" }, recursionLimit: 50 };

    await agent.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);

    const pending = readPendingInterrupts(await agent.getState(config) as never);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    expect(pending[0].toolName).toBe("execute");
    await expect(readFile(marker, "utf8")).rejects.toThrow();

    const resumeDict: Record<string, { action: string }> = {};
    for (const p of pending) resumeDict[p.interruptId] = { action: "approve" };

    await agent.invoke(new Command({ resume: resumeDict }), config);

    expect(await readFile(marker, "utf8")).toBe("ran\n");
  });
});

describe("sub-agent shell capability", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "sa-shell-cap-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /**
   * Compile a sub-agent and capture the tool names deepagents actually binds to
   * its model — the filesystem middleware filters `execute` out of the model's
   * tool list when the backend is not sandbox-capable, so the bound set is the
   * authoritative observable for shell capability.
   */
  async function boundToolNamesFor(shellEnv: Record<string, string> | undefined) {
    let bound: string[] = [];
    const script: ScriptSelector = (toolNames) => {
      if (toolNames.length > 0) bound = toolNames;
      return { toolCalls: [], done: "ok" };
    };

    const compiled = await compileSubagents(
      [{ name: "worker", description: "test worker", systemPrompt: "work", tools: [] }],
      {
        parentModelName: "claude-sonnet-4-6",
        workspaceRootDir: root,
        shellEnv,
        modelFactory: async () => new ScriptedModel(script),
      },
    );
    expect(compiled).toHaveLength(1);

    await compiled[0].runnable.invoke(
      { messages: [new HumanMessage({ content: "go" })] },
      { configurable: { thread_id: "t1" }, recursionLimit: 50 },
    );
    return bound;
  }

  it("binds execute when shellEnv is present (non-plan mode)", async () => {
    expect(await boundToolNamesFor({})).toContain("execute");
  });

  it("omits execute when shellEnv is absent (plan mode)", async () => {
    expect(await boundToolNamesFor(undefined)).not.toContain("execute");
  });
});

describe("general-purpose sub-agent gating", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gp-gate-"));
    registerStigmerDeepagentsProfiles();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    resetStigmerDeepagentsProfilesForTests();
  });

  it("gates execute inside a compiled general-purpose sub-agent", async () => {
    const marker = join(root, "gp-shell-marker.txt");
    // Role selection: only the SUB-AGENT is shell-capable in this test (the
    // parent gets a non-shell backend below), so `execute` in the bound tool
    // set uniquely identifies the sub-agent's turn.
    const roleScript: ScriptSelector = (toolNames) =>
      toolNames.includes("execute")
        ? {
            toolCalls: [{
              name: "execute",
              args: { command: "echo gp > gp-shell-marker.txt" },
              id: "gp_exec_1",
            }],
            done: "gp done",
          }
        : {
            toolCalls: [{
              name: "task",
              args: { description: "run shell", subagent_type: "general-purpose" },
              id: "task_1",
            }],
            done: "parent done",
          };

    const gpSpec: TransformedSubagent = {
      name: "general-purpose",
      description: "Gated general-purpose test double",
      systemPrompt: "Run the delegated task.",
      tools: [],
    };

    const compiled = await compileSubagents([gpSpec], {
      parentModelName: "claude-sonnet-4-6",
      workspaceRootDir: root,
      approvalGate: { policies: new Map(), toolServerMap: new Map() },
      shellEnv: {},
      modelFactory: async () => new ScriptedModel(roleScript),
    });
    expect(compiled).toHaveLength(1);

    const observer = new CasCaptureObserver({
      rootDir: root,
      isIgnored: async () => false,
    });
    // Non-shell parent backend: keeps `execute` out of the parent's tool set so
    // the role script above delegates instead of running the command itself.
    const parentBackend = await createCasCaptureBackend({
      rootDir: root,
      observer,
    });

    const checkpointer = new MemorySaver();
    const parent = await createDeepAgent({
      model: new ScriptedModel(roleScript),
      checkpointer: checkpointer as never,
      backend: parentBackend,
      subagents: compiled,
    } as Parameters<typeof createDeepAgent>[0]);

    const config = { configurable: { thread_id: "gp-thread" }, recursionLimit: 50 };
    await parent.invoke({ messages: [new HumanMessage({ content: "go" })] }, config);

    const pending = readPendingInterrupts(await parent.getState(config) as never);
    expect(pending.some((p) => p.toolName === "execute")).toBe(true);
    await expect(readFile(marker, "utf8")).rejects.toThrow();
  });
});

describe("registerStigmerDeepagentsProfiles", () => {
  beforeEach(() => {
    resetStigmerDeepagentsProfilesForTests();
    registerStigmerDeepagentsProfiles();
  });

  afterEach(() => {
    resetStigmerDeepagentsProfilesForTests();
  });

  /**
   * deepagents resolves harness profiles from the model's provider, and for a
   * model INSTANCE the provider comes from the class name (ChatAnthropic /
   * ChatOpenAI — see getModelProvider in deepagents). Production models always
   * come from buildChatModel and are one of those two classes; a bare
   * ScriptedModel resolves NO provider, so the suppression profile would never
   * match it. Masquerading as ChatAnthropic exercises the exact production
   * resolution path.
   */
  class ScriptedAnthropicModel extends ScriptedModel {
    static override lc_name(): string {
      return "ChatAnthropic";
    }
  }

  it("prevents deepagents from auto-injecting an ungated general-purpose sub-agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "gp-profile-"));
    try {
      const observer = new CasCaptureObserver({
        rootDir: root,
        isIgnored: async () => false,
      });
      const backend = await createCasCaptureBackend({
        rootDir: root,
        observer,
        shellEnv: {},
      });

      const script: ScriptSelector = () => ({
        toolCalls: [{
          name: "task",
          args: { description: "delegate", subagent_type: "general-purpose" },
          id: "task_1",
        }],
        done: "done",
      });

      // No `subagents` supplied: without the profile suppression deepagents
      // would inject its own ungated general-purpose sub-agent here.
      const agent = await createDeepAgent({
        model: new ScriptedAnthropicModel(script),
        backend,
      } as Parameters<typeof createDeepAgent>[0]);

      // With the injection suppressed, the scripted `task` delegation has no
      // general-purpose target. Depending on the runtime's tool-error handling
      // that surfaces either as a rejected invoke or as an error ToolMessage —
      // both prove the delegation target does not exist.
      let outcome: string;
      try {
        const result = await agent.invoke(
          { messages: [new HumanMessage({ content: "go" })] },
          { recursionLimit: 20 },
        ) as { messages: unknown[] };
        outcome = JSON.stringify(result.messages);
      } catch (err) {
        outcome = String(err);
      }
      expect(outcome).toMatch(/allowed types/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
