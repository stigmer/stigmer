/**
 * A turn's subagents as the Cursor SDK registers them: the `AgentDefinition`
 * map and the `Agent(type, …)` filter in front of it. Pins the field
 * mapping and fallbacks; that a subagent's skills ride its prompt, rendered
 * as the main agent's are (`formatSkillsSection`); that a saved subagent
 * runs its context's model and a plugin subagent the model its file names
 * only when Cursor's registry section lists that id (an alias, or a model
 * only the native engine lists, runs "inherit"); that no definition carries
 * an MCP config (the SDK gives sub-agents the parent's); and that a type the
 * main agent's lists do not allow is never registered.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import type { TurnInput, TurnSubagent } from "../../../harness/types.js";
import type { PluginSubagent } from "../../../shared/blueprint-resolver.js";
import { _resetRegistryCache } from "../../../shared/model-registry.js";
import type { SkillMetadata } from "../../../shared/skill-resolver.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import { formatSkillsSection } from "../prompt-builder.js";
import { buildCursorSubAgentDefinitions, subagentNamesInScope, subagentsInScope, type CursorSubagent } from "../subagent-config.js";

function cursorSubagent(opts: Partial<CursorSubagent> & { name: string }): CursorSubagent {
  return { description: "", instructions: "", model: undefined, skills: [], ...opts };
}

const TRIAGE: SkillMetadata = { name: "triage", description: "Sort the inbox", path: ".stigmer/skills/triage/SKILL.md" };

function saved(name: string, extra: Partial<TurnSubagent> = {}): TurnSubagent {
  return {
    name,
    description: `${name} agent`,
    instructions: `You are ${name}.`,
    model: undefined,
    toolScope: ToolScope.unrestricted(),
    servers: [],
    skills: [],
    hooks: [],
    values: {},
    bringsOwn: { plugins: false, hooks: false, lists: false },
    ...extra,
  };
}

function pluginAgent(name: string, model = ""): PluginSubagent {
  return { name, description: `${name} agent`, instructions: `You are ${name}.`, tools: [], disallowedTools: [], model };
}

/** A turn whose agent lists `subagents`, whose plugins carry `pluginAgents`, under `scope`. */
function turn(subagents: TurnSubagent[], pluginAgents: PluginSubagent[], scope = ToolScope.unrestricted(), bySubAgent = new Map<string, readonly SkillMetadata[]>()): TurnInput {
  const base = turnInputFixture();
  return {
    ...base,
    blueprint: { ...base.blueprint, pluginAgents },
    subagents,
    mcp: { ...base.mcp, toolScope: scope },
    skills: { root: [], bySubAgent },
  };
}

describe("buildCursorSubAgentDefinitions", () => {
  it("returns undefined for an empty list", () => {
    expect(buildCursorSubAgentDefinitions([])).toBeUndefined();
  });

  it("maps name/description/instructions to an AgentDefinition keyed by name", () => {
    const agents = buildCursorSubAgentDefinitions([
      cursorSubagent({ name: "researcher", description: "Researches topics", instructions: "You are a researcher. Be concise and factual." }),
    ]);

    expect(agents).toBeDefined();
    expect(Object.keys(agents!)).toEqual(["researcher"]);
    expect(agents!.researcher.description).toBe("Researches topics");
    expect(agents!.researcher.prompt).toBe("You are a researcher. Be concise and factual.");
    // Inherits the parent model unless it runs on its own.
    expect(agents!.researcher.model).toBe("inherit");
  });

  it("names the model a subagent runs on", () => {
    const agents = buildCursorSubAgentDefinitions([cursorSubagent({ name: "fast", instructions: "do the thing", model: "composer-2.5" })]);
    expect(agents!.fast.model).toEqual({ id: "composer-2.5" });
  });

  it("renders a subagent's skills into its prompt, after its instructions, as the main agent's are rendered", () => {
    const agents = buildCursorSubAgentDefinitions([cursorSubagent({ name: "notes", instructions: "You write notes.", skills: [TRIAGE] })]);
    expect(agents!.notes.prompt).toBe(`You write notes.\n\n${formatSkillsSection([TRIAGE])}`);
  });

  it("does NOT expose mcpServers on the definition (Cursor sub-agents inherit parent MCP config)", () => {
    const agents = buildCursorSubAgentDefinitions([cursorSubagent({ name: "tooluser", description: "uses tools", instructions: "use the echo tool" })]);
    expect(agents!.tooluser.mcpServers).toBeUndefined();
  });

  it("falls back to description, then name, when instructions are empty", () => {
    const fromDescription = buildCursorSubAgentDefinitions([cursorSubagent({ name: "a", description: "the description" })]);
    expect(fromDescription!.a.prompt).toBe("the description");

    const fromName = buildCursorSubAgentDefinitions([cursorSubagent({ name: "b" })]);
    expect(fromName!.b.prompt).toBe("b");
  });

  it("skips entries with a blank name (unaddressable) and returns undefined if none remain", () => {
    expect(buildCursorSubAgentDefinitions([cursorSubagent({ name: "   ", description: "d", instructions: "do it now" })])).toBeUndefined();
  });

  it("registers multiple sub-agents", () => {
    const agents = buildCursorSubAgentDefinitions([
      cursorSubagent({ name: "one", description: "d1", instructions: "instr one" }),
      cursorSubagent({ name: "two", description: "d2", instructions: "instr two" }),
    ]);
    expect(Object.keys(agents!).sort()).toEqual(["one", "two"]);
  });
});

describe("subagentNamesInScope", () => {
  it("keeps only the types the main agent's Agent(type, …) allows, saved and plugin subagents alike, matched case-insensitively", () => {
    const subagents = [saved("Researcher"), saved("writer")];
    const plugins = [pluginAgent("kit:reviewer"), pluginAgent("kit:other")];
    const scope = ToolScope.of('Agent "a"', { tools: ["Read", "Agent(researcher, kit:reviewer)"], disallowedTools: [] });
    expect(subagentNamesInScope(turn(subagents, plugins, scope))).toEqual(["Researcher", "kit:reviewer"]);
    expect(subagentNamesInScope(turn(subagents, plugins))).toEqual(["Researcher", "writer", "kit:reviewer", "kit:other"]);
    const noAgent = ToolScope.of('Agent "a"', { tools: [], disallowedTools: ["Agent"] });
    expect(subagentNamesInScope(turn(subagents, plugins, noAgent))).toEqual([]);
  });
});

describe("subagentsInScope", () => {
  beforeEach(() => {
    _resetRegistryCache();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(
        JSON.stringify({
          models: [
            { id: "composer-2.5", provider: "cursor", harness: "cursor" },
            { id: "claude-sonnet-4-6", provider: "anthropic", harness: "native" },
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

  it("registers a saved subagent with its instructions, its skills and its context's model", async () => {
    const registered = await subagentsInScope(turn([saved("notes", { skills: [TRIAGE], model: "composer-2.5" }), saved("plain")], []));
    expect(registered).toEqual([
      { name: "notes", description: "notes agent", instructions: "You are notes.", model: "composer-2.5", skills: [TRIAGE] },
      { name: "plain", description: "plain agent", instructions: "You are plain.", model: undefined, skills: [] },
    ]);
    const agents = buildCursorSubAgentDefinitions(registered);
    expect(agents!.notes.model).toEqual({ id: "composer-2.5" });
    expect(agents!.notes.prompt).toContain(formatSkillsSection([TRIAGE]));
    expect(agents!.plain.model).toBe("inherit");
  });

  it("runs a plugin subagent on the model its file names only when Cursor lists that id", async () => {
    const registered = await subagentsInScope(
      turn([], [pluginAgent("kit:listed", "composer-2.5"), pluginAgent("kit:alias", "fast"), pluginAgent("kit:native", "claude-sonnet-4-6"), pluginAgent("kit:none")]),
    );
    expect(registered.map((s) => [s.name, s.model])).toEqual([
      ["kit:listed", "composer-2.5"],
      ["kit:alias", undefined],
      ["kit:native", undefined],
      ["kit:none", undefined],
    ]);
  });

  it("gives a plugin subagent the skills mounted for it, keyed by its name", async () => {
    const registered = await subagentsInScope(turn([], [pluginAgent("kit:reviewer")], ToolScope.unrestricted(), new Map([["kit:reviewer", [TRIAGE]]])));
    expect(registered[0]!.skills).toEqual([TRIAGE]);
  });

  it("leaves out a subagent the main agent's Agent(type, …) does not allow", async () => {
    const scope = ToolScope.of('Agent "a"', { tools: ["Read", "Agent(notes)"], disallowedTools: [] });
    const registered = await subagentsInScope(turn([saved("notes"), saved("writer")], [pluginAgent("kit:reviewer")], scope));
    expect(registered.map((s) => s.name)).toEqual(["notes"]);
  });
});
