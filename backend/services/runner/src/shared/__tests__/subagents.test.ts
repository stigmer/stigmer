/**
 * `shared/subagents.ts`: the rules both engines read about a turn's
 * subagents.
 *   - A saved subagent's scope is its own lists, capped by the turn's, with
 *     `Agent` denied; the main agent's lists never reach it, so a parent
 *     that denies a tool does not take it from the agent it lists.
 *   - A plugin subagent's scope is the main scope narrowed by its plugin's
 *     lists, with `Agent` denied.
 *   - Either way the native `task` tool is out of scope (one level).
 *   - `subagentModel`: a model counts only when it was chosen for this
 *     engine (an unset engine is the native one) and that engine's registry
 *     section lists it by id; an alias, `inherit`, an empty name, an
 *     unlisted id or another engine's choice runs the turn's model.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { NATIVE_TOOL_COVERS } from "@stigmer/tool-vocabulary";

import { _resetRegistryCache } from "../model-registry.js";
import { pluginSubagentScope, savedSubagentScope, subagentModel, subagentOwner, subagentPromptExtras } from "../subagents.js";
import { ToolScope } from "../tool-lists.js";

describe("savedSubagentScope", () => {
  it("is the subagent's own lists, never the parent agent's", () => {
    const spec = create(AgentSpecSchema, { tools: ["Read", "Bash"] });

    const scope = savedSubagentScope("release-notes", spec, undefined);

    expect(scope.allowsClaudeTool("Bash"), "its own allow-list holds Bash").toBe(true);
    expect(scope.allowsClaudeTool("Write"), "and nothing else").toBe(false);
    expect(scope.describe()).toBe(`${subagentOwner("release-notes")}: tools [Read, Bash]; A subagent: disallowed_tools [Agent]`);
  });

  it("is capped by the turn's lists", () => {
    const spec = create(AgentSpecSchema, { tools: ["Read", "Bash"] });
    const runSpec = create(RunSpecSchema, { disallowedTools: ["Bash"] });

    const scope = savedSubagentScope("release-notes", spec, runSpec);

    expect(scope.allowsClaudeTool("Read")).toBe(true);
    expect(scope.allowsClaudeTool("Bash"), "the turn denies it").toBe(false);
  });

  it("denies Agent, so the task tool is out of its graph's scope even with no lists of its own", () => {
    const scope = savedSubagentScope("release-notes", create(AgentSpecSchema), undefined);

    expect(scope.allowsClaudeTool("Agent")).toBe(false);
    expect(scope.allowsEngineTool("task", NATIVE_TOOL_COVERS)).toBe(false);
    expect(scope.allowsClaudeTool("Write"), "otherwise unrestricted").toBe(true);
  });
});

describe("pluginSubagentScope", () => {
  it("narrows the main scope by the plugin's lists and denies Agent", () => {
    const main = ToolScope.of("Agent \"pr-bot\"", { tools: [], disallowedTools: ["Write"] });

    const scope = pluginSubagentScope(main, { name: "review:security", tools: ["Read", "Write"], disallowedTools: [] });

    expect(scope.allowsClaudeTool("Read")).toBe(true);
    expect(scope.allowsClaudeTool("Write"), "the main agent's deny still holds").toBe(false);
    expect(scope.allowsClaudeTool("Bash"), "outside the plugin's allow-list").toBe(false);
    expect(scope.allowsEngineTool("task", NATIVE_TOOL_COVERS)).toBe(false);
  });

  it("denies Agent even when the plugin writes no lists", () => {
    const scope = pluginSubagentScope(ToolScope.unrestricted(), { name: "review:quick", tools: [], disallowedTools: [] });

    expect(scope.allowsClaudeTool("Agent")).toBe(false);
    expect(scope.allowsClaudeTool("Bash")).toBe(true);
  });
});

describe("subagentModel", () => {
  beforeEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          models: [
            { id: "claude-sonnet-4-5", provider: "anthropic", harness: "native" },
            { id: "claude-opus-5", provider: "anthropic", harness: "claude" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  });

  afterEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
  });

  it("answers a listed id chosen for this engine", async () => {
    expect(await subagentModel("claude-sonnet-4-5", Harness.NATIVE, Harness.NATIVE)).toBe("claude-sonnet-4-5");
  });

  it("reads Claude's own section, never native's", async () => {
    expect(await subagentModel("claude-opus-5", Harness.CLAUDE, Harness.CLAUDE)).toBe("claude-opus-5");
    expect(await subagentModel("claude-sonnet-4-5", Harness.CLAUDE, Harness.CLAUDE), "listed only for native").toBeUndefined();
    expect(await subagentModel("claude-opus-5", Harness.NATIVE, Harness.CLAUDE)).toBeUndefined();
  });

  it("names a number no engine owns rather than reading native's section", async () => {
    await expect(subagentModel("claude-opus-5", 7 as Harness.CLAUDE)).rejects.toThrow("model registry: harness 7 names no engine");
  });

  it("counts an unspecified engine as the native one", async () => {
    expect(await subagentModel("claude-sonnet-4-5", Harness.NATIVE, Harness.UNSPECIFIED)).toBe("claude-sonnet-4-5");
    expect(await subagentModel("claude-opus-5", Harness.CLAUDE, Harness.UNSPECIFIED)).toBeUndefined();
  });

  it("runs the turn's model when the choice was made for another engine", async () => {
    expect(await subagentModel("claude-sonnet-4-5", Harness.CLAUDE, Harness.NATIVE)).toBeUndefined();
    expect(await subagentModel("claude-opus-5", Harness.NATIVE, Harness.CLAUDE)).toBeUndefined();
  });

  it("runs the turn's model for an id this engine's section does not list", async () => {
    expect(await subagentModel("gpt-9", Harness.NATIVE, Harness.NATIVE)).toBeUndefined();
    expect(await subagentModel("claude-opus-5", Harness.NATIVE), "listed only for Claude").toBeUndefined();
  });

  it.each(["sonnet", "fast", "inherit", "", "  "])("runs the turn's model for %j", async (model) => {
    expect(await subagentModel(model, Harness.NATIVE)).toBeUndefined();
  });

  it("counts a plugin agent's model, which names no engine, on whichever engine lists it", async () => {
    expect(await subagentModel("claude-sonnet-4-5", Harness.NATIVE)).toBe("claude-sonnet-4-5");
    expect(await subagentModel("claude-opus-5", Harness.CLAUDE)).toBe("claude-opus-5");
  });

  it("runs the turn's model when the registry cannot be read", async () => {
    _resetRegistryCache();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await subagentModel("claude-sonnet-4-5", Harness.NATIVE, Harness.NATIVE)).toBeUndefined();
  });
});

describe("subagentPromptExtras", () => {
  it("adds the outputs folder's line exactly when the subagent may write", () => {
    expect(subagentPromptExtras({ writesAllowed: true, readsWorkspace: false, hasRepositoryInstructions: false }).outputsLine).toBe(true);
    expect(subagentPromptExtras({ writesAllowed: false, readsWorkspace: true, hasRepositoryInstructions: true }).outputsLine).toBe(false);
  });

  it("adds the repository's instructions only when there are some and its own scope reads the workspace", () => {
    expect(subagentPromptExtras({ writesAllowed: false, readsWorkspace: true, hasRepositoryInstructions: true }).repositoryInstructions).toBe(true);
    expect(subagentPromptExtras({ writesAllowed: true, readsWorkspace: false, hasRepositoryInstructions: true }).repositoryInstructions).toBe(false);
    expect(subagentPromptExtras({ writesAllowed: true, readsWorkspace: true, hasRepositoryInstructions: false }).repositoryInstructions).toBe(false);
  });
});
