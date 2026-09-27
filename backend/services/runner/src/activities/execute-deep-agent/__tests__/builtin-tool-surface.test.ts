// Covers the built-in tools a native graph binds under the runner's deepagents
// profile, through the exact production resolution path (the profile is
// resolved from the model's provider, so the scripted model masquerades as
// ChatAnthropic — `shell-execute-gate.test.ts` explains why):
//  - deepagents' recursive `delete` tool is never built, on shell-capable and
//    plan-mode sub-agents alike (deletes stay on the approval-gated shell);
//  - a sub-agent carries no to-do tool: its list never reaches the execution,
//    so only the parent's `write_todos` is kept (`turn-setup.ts`);
//  - `execute` stays exactly where the backend's shell capability puts it;
//  - a capture backend refuses a backend delete outright, the net for a graph
//    whose model no profile resolves.
// The parent's own surface is the request-shape conformance facet's
// (`test/conformance/…/agentexecution-request-shape.native-bare-agent.tool-surface.md`),
// which drives the real model client.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanMessage } from "@langchain/core/messages";

import { createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import {
  EXCLUDED_BUILTIN_TOOLS,
  registerStigmerDeepagentsProfiles,
  resetStigmerDeepagentsProfilesForTests,
} from "../deepagents-profiles.js";
import { ScriptedModel, type ScriptSelector } from "../__test-utils__/scripted-model.js";
import { compileSubagents } from "../subagent-transformer.js";

class ScriptedAnthropicModel extends ScriptedModel {
  static override lc_name(): string {
    return "ChatAnthropic";
  }
}

describe("native built-in tool surface", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "builtin-tools-"));
    resetStigmerDeepagentsProfilesForTests();
    registerStigmerDeepagentsProfiles();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    resetStigmerDeepagentsProfilesForTests();
  });

  async function subAgentBoundTools(options: {
    readonly shellEnv: Record<string, string> | undefined;
    readonly capture: boolean;
  }): Promise<string[]> {
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
        shellEnv: options.shellEnv,
        ...(options.capture
          ? { casObserver: new CasCaptureObserver({ rootDir: root, isIgnored: async () => true }) }
          : {}),
        modelFactory: async () => new ScriptedAnthropicModel(script),
      },
    );
    expect(compiled).toHaveLength(1);
    await compiled[0].runnable.invoke(
      { messages: [new HumanMessage({ content: "go" })] },
      { configurable: { thread_id: "t1" }, recursionLimit: 50 },
    );
    return bound;
  }

  it.each([
    { label: "shell-capable, captured", shellEnv: {}, capture: true },
    { label: "shell-capable", shellEnv: {}, capture: false },
    { label: "plan mode, captured", shellEnv: undefined, capture: true },
    { label: "plan mode", shellEnv: undefined, capture: false },
  ])("a $label sub-agent binds no delete and no to-do tool", async ({ shellEnv, capture }) => {
    const bound = await subAgentBoundTools({ shellEnv, capture });
    for (const excluded of EXCLUDED_BUILTIN_TOOLS) expect(bound).not.toContain(excluded);
    expect(bound).not.toContain("write_todos");
    expect(bound).toContain("read_file");
    expect(bound.includes("execute"), "execute follows shell capability").toBe(shellEnv !== undefined);
  });

  it("a capture backend refuses a backend delete and leaves the file in place", async () => {
    await writeFile(join(root, "keep.txt"), "kept\n");
    for (const shellEnv of [{}, undefined]) {
      const backend = await createCasCaptureBackend({
        rootDir: root,
        observer: new CasCaptureObserver({ rootDir: root, isIgnored: async () => true }),
        ...(shellEnv ? { shellEnv } : {}),
      });
      expect((await backend.delete("/keep.txt")).error).toMatch(/use the shell/);
      expect((await backend.delete("/")).error).toMatch(/use the shell/);
    }
    expect(await readFile(join(root, "keep.txt"), "utf8")).toBe("kept\n");
  });
});
