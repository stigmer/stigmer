// Covers the one table of built-in tool names the native prompts quote
// (`engine-tools.ts`) against what the engine actually binds, and the texts
// this harness writes for the tools it installs:
//  - every name in the table is on a shell-capable parent graph's surface,
//    built through the production backend and to-do middleware, so a rename
//    upstream fails here instead of leaving a prompt naming a tool that is
//    gone;
//  - the parent's `write_todos` carries this harness's description, not
//    langchain's default;
//  - the built-in sub-agents' prompts carry no unfilled `{placeholder}` (the
//    task reaches a sub-agent as its first message, never through its
//    prompt) and name only tools from the table.
// The profile is resolved from the model's provider, so the scripted model
// masquerades as ChatAnthropic (`shell-execute-gate.test.ts` explains why).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { createDeepAgent } from "deepagents";

import { createCasCaptureBackend } from "../cas-capture-backend.js";
import { CasCaptureObserver } from "../cas-capture-observer.js";
import { registerStigmerDeepagentsProfiles, resetStigmerDeepagentsProfilesForTests } from "../deepagents-profiles.js";
import { ENGINE_TOOL } from "../engine-tools.js";
import { createBuiltinSubagents } from "../subagent-transformer.js";
import { createTodoListMiddleware, TODO_TOOL_DESCRIPTION } from "../todo-list.js";
import { ScriptedModel, type ScriptSelector } from "../__test-utils__/scripted-model.js";

class ScriptedAnthropicModel extends ScriptedModel {
  static override lc_name(): string {
    return "ChatAnthropic";
  }
}

/** The tools a shell-capable parent graph binds, by name, with their descriptions. */
async function parentSurface(root: string): Promise<Map<string, string>> {
  const bound: unknown[] = [];
  const script: ScriptSelector = () => ({ toolCalls: [], done: "ok" });
  const model = new ScriptedAnthropicModel(script, bound);
  const graph = await createDeepAgent({
    model,
    systemPrompt: "work",
    backend: await createCasCaptureBackend({
      rootDir: root,
      observer: new CasCaptureObserver({ rootDir: root, isIgnored: async () => true }),
      shellEnv: {},
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    middleware: [createTodoListMiddleware()] as any,
  } as Parameters<typeof createDeepAgent>[0]);
  await graph.invoke({ messages: [new HumanMessage({ content: "go" })] }, { configurable: { thread_id: "t1" }, recursionLimit: 50 });
  const surface = new Map<string, string>();
  for (const tool of bound) {
    const { name, description } = tool as { name?: unknown; description?: unknown };
    if (typeof name === "string") surface.set(name, typeof description === "string" ? description : "");
  }
  return surface;
}

describe("the engine's built-in tool names", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "engine-tools-"));
    resetStigmerDeepagentsProfilesForTests();
    registerStigmerDeepagentsProfiles();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    resetStigmerDeepagentsProfilesForTests();
  });

  it("are every one on a shell-capable parent's surface", async () => {
    const surface = await parentSurface(root);
    for (const name of Object.values(ENGINE_TOOL)) {
      expect([...surface.keys()], `${name} is quoted by the prompts, so it must be bound`).toContain(name);
    }
  });

  it("give the parent's to-do tool this harness's description", async () => {
    const surface = await parentSurface(root);
    expect(surface.get(ENGINE_TOOL.writeTodos)).toBe(TODO_TOOL_DESCRIPTION);
  });

  it("are the only tool names the built-in sub-agents' prompts quote, and those prompts carry no placeholder", () => {
    const known = new Set<string>(Object.values(ENGINE_TOOL));
    for (const spec of createBuiltinSubagents(true)) {
      expect(spec.systemPrompt, `${spec.name}'s prompt`).not.toMatch(/\{[a-z_]+\}/);
      const quoted = spec.systemPrompt.match(/\b[a-z]+_[a-z]+\b/g) ?? [];
      for (const name of quoted) expect(known, `${spec.name} quotes ${name}`).toContain(name);
    }
  });
});
