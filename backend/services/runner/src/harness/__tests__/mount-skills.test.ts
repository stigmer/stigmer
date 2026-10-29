/**
 * Pins the skills phase (`turn-context.ts` `mountSkills`): the root's merged
 * refs and each plugin subagent's skills, resolved into `TurnSkills`. A
 * saved subagent's skills are its own context's (`resolveSubagents`,
 * `resolve-subagents.test.ts`), so this phase fetches none of them.
 *
 * What is asserted: the root's merged refs resolve under one label, so the
 * runtime's label list is unchanged; a failing root ref is warned and
 * skipped. A scope that denies `Skill` hides skills: the main scope's deny
 * (the agent's or the turn's) fetches nothing, and an allow-list that omits
 * `Skill` keeps them.
 *
 * A plugin's skills come from its mounted archive, never a skill fetch: each
 * renders as `<plugin>:<skill>` at `.stigmer/plugins/<digest>/<path>/SKILL.md`
 * for the root, a plugin's agent (`<plugin>:<agent>`) gets only the skills
 * its `skills:` names, and a plugin whose archive cannot be mounted
 * contributes none, warned.
 *
 * Beside the skills, the phase returns what it loaded for the run's record:
 * each root skill that mounted, by id at its version hash. A failed or
 * hidden skill is not listed, nor is a plugin's skill (its plugin's digest
 * names it).
 *
 * The control-plane client is doubled at its module boundary with scripted
 * skills; `HOME` is the hermetic environment's, so the mounts land under a
 * temp platform dir and nothing touches the developer's `~/.stigmer`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { SkillSchema, type Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceReferenceSchema, type ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { PluginSchema, type Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginArtifactDownloadUrlSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import { buildZip } from "@stigmer/zip-structure/testing";

import { mintedDownload } from "../../__test-utils__/minted-download.js";
import { createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { ToolScope } from "../../shared/tool-lists.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { mountSkills, type ResolutionDeps } from "../turn-context.js";
import { pluginSubagents } from "../../shared/blueprint-resolver.js";
import { PLUGINS_SUBDIR } from "../../shared/plugin-mount.js";
import { STIGMER_LOCAL_STATE_DIR } from "../../shared/workspace/stigmer-link.js";
import { TurnRowsSchema } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

const env = createHermeticEnvironment();
afterAll(() => env.dispose());

function ref(slug: string): ApiResourceReference {
  return create(ApiResourceReferenceSchema, { slug, org: "kit-org" });
}

function skill(slug: string): Skill {
  return create(SkillSchema, {
    metadata: { id: `skill-${slug}`, slug, org: "kit-org" },
    spec: { name: slug, description: `The ${slug} skill`, skillMd: `# ${slug}` },
    status: { versionHash: `hash-${slug}` },
  });
}

/** A client that answers the scripted skills by slug and refuses the rest; every fetch is counted. */
function skillClient(available: readonly string[]) {
  const fetches: string[] = [];
  const client = mockStigmerClient({
    getSkillByReference: vi.fn(async (r: ApiResourceReference) => {
      fetches.push(r.slug);
      if (!available.includes(r.slug)) throw new Error(`skill ${r.slug} not found`);
      return skill(r.slug);
    }),
  });
  return { client, fetches };
}

function depsWith(client: ResolutionDeps["client"], sessionId: string): { deps: ResolutionDeps; labels: string[] } {
  const labels: string[] = [];
  const status = create(RunStatusSchema, {});
  const rows = create(TurnRowsSchema);
  return {
    labels,
    deps: {
      input: { executionId: `aex-${sessionId}`, threadId: "", turnSeq: 0 },
      client,
      config: testConfig({ workspaceRootDir: env.workspaceRootDir }),
      status,
      rows,
      transcript: new TranscriptBuilder(`aex-${sessionId}`, rows, status),
      artifactStorage: undefined,
      timing: new TimingRecorder(),
      signal: new AbortController().signal,
      heartbeat: () => {},
      enterPhase: () => {},
      reportProgress: async (label) => {
        labels.push(label);
      },
      identifyRun: () => {},
      recordReconciled: async () => {},
    },
  };
}

/** A blueprint whose root merges `rootRefs` and whose agent lists one saved subagent carrying `subagentRefs`. */
function blueprintWith(rootRefs: readonly string[], subagentRefs: readonly string[] = []) {
  return turnInputFixture({
    blueprint: {
      mergedSkillRefs: rootRefs.map(ref),
      subagents: [
        {
          name: "researcher",
          agentId: "agt_researcher",
          versionHash: "c".repeat(64),
          spec: create(AgentSpecSchema, { instructions: "You research.", skillRefs: subagentRefs.map(ref) }),
          plugins: [],
        },
      ],
    },
  }).blueprint;
}

describe("mountSkills: the root's skills", () => {
  let n = 0;
  let sessionId: string;
  let primaryDir: string;

  beforeAll(() => {
    mkdirSync(env.workspaceRootDir, { recursive: true });
  });
  beforeEach(() => {
    sessionId = `ses-skills-${++n}`;
    primaryDir = join(env.workspaceRootDir, sessionId);
    mkdirSync(primaryDir, { recursive: true });
  });

  it("resolves the root's merged refs under one label, and none of a saved subagent's", async () => {
    const { client, fetches } = skillClient(["alpha", "beta"]);
    const { deps, labels } = depsWith(client, sessionId);
    const { skills, loaded } = await mountSkills(deps, {
      blueprint: blueprintWith(["alpha"], ["beta"]),
      sessionId,
      primaryDir,
      subAgents: true,
      toolScope: ToolScope.unrestricted(),
    });
    expect(skills.root.map((s) => s.name)).toEqual(["alpha"]);
    expect(skills.root[0]!.path).toBe(".stigmer/skills/alpha/SKILL.md");
    expect(skills.bySubAgent.size, "a saved subagent's skills are its own context's").toBe(0);
    expect(fetches).toEqual(["alpha"]);
    expect(labels, "one label for the whole phase").toEqual(["Resolving skills"]);
    expect(loaded.map((r) => [r.org, r.id, r.version]), "the root's skill by id at its version").toEqual([["kit-org", "skill-alpha", "hash-alpha"]]);
  });

  it("a failing root ref is warned and skipped, never thrown", async () => {
    const { client } = skillClient(["beta"]);
    const { deps } = depsWith(client, sessionId);
    const { skills, loaded } = await mountSkills(deps, {
      blueprint: blueprintWith(["missing", "beta"]),
      sessionId,
      primaryDir,
      subAgents: true,
      toolScope: ToolScope.unrestricted(),
    });
    expect(skills.root.map((s) => s.name)).toEqual(["beta"]);
    expect(loaded.map((r) => r.id), "a skill that did not mount is not listed").toEqual(["skill-beta"]);
  });

  it("a turn that denies Skill fetches and mounts no skill, so no prompt can list one", async () => {
    const { client, fetches } = skillClient(["alpha"]);
    const { deps } = depsWith(client, sessionId);
    const { skills, loaded } = await mountSkills(deps, {
      blueprint: blueprintWith(["alpha"]),
      sessionId,
      primaryDir,
      subAgents: true,
      toolScope: ToolScope.ofMain([{ owner: "The turn", lists: { tools: [], disallowedTools: ["Skill"] } }]),
    });
    expect(skills.root).toEqual([]);
    expect(loaded, "a hidden skill is not loaded").toEqual([]);
    expect(skills.bySubAgent.size).toBe(0);
    expect(fetches).toEqual([]);
  });

  it("an allow-list that omits Skill keeps the root's skills", async () => {
    const { client, fetches } = skillClient(["alpha"]);
    const { deps } = depsWith(client, sessionId);
    const { skills } = await mountSkills(deps, {
      blueprint: blueprintWith(["alpha"]),
      sessionId,
      primaryDir,
      subAgents: true,
      toolScope: ToolScope.of("The agent", { tools: ["Read"], disallowedTools: [] }),
    });
    expect(skills.root.map((s) => s.name), "Read alone still keeps the platform's skills").toEqual(["alpha"]);
    expect(fetches).toEqual(["alpha"]);
  });
});

const PLUGIN_ARCHIVE = buildZip([
  { name: "skills/triage/SKILL.md", content: "---\nname: triage\n---\n# triage" },
  { name: "skills/release/SKILL.md", content: "---\nname: release\n---\n# release" },
]);
const PLUGIN_DIGEST = createHash("sha256").update(PLUGIN_ARCHIVE).digest("hex");

/** A plugin carrying two skills and one agent that uses only `triage`. */
function kitPlugin(digest = PLUGIN_DIGEST): Plugin {
  return create(PluginSchema, {
    metadata: { id: "plg_kit", slug: "kit", name: "kit", org: "kit-org" },
    status: {
      digest,
      artifactStorageKey: "plugins/kit.zip",
      skills: [
        { name: "triage", description: "Sort the inbox", path: "skills/triage" },
        { name: "release", description: "", path: "skills/release" },
      ],
      agents: [{ name: "reviewer", description: "Reviews", instructions: "Review.", skills: ["triage"] }],
    },
  });
}

/** A client that serves the kit plugin's archive and fails every skill fetch: a plugin's skills are never fetched as skills. */
function pluginClient() {
  return mockStigmerClient({
    getSkillByReference: vi.fn(async () => {
      throw new Error("a plugin's skills are never fetched as skills");
    }),
    getPluginArtifactDownloadUrl: vi.fn(async () => create(PluginArtifactDownloadUrlSchema, mintedDownload(PLUGIN_ARCHIVE))),
  });
}

function pluginBlueprint(plugin: Plugin) {
  return turnInputFixture({ blueprint: { plugins: [plugin], pluginAgents: pluginSubagents(plugin) } }).blueprint;
}

describe("mountSkills: a plugin's skills", () => {
  let n = 0;
  let sessionId: string;
  let primaryDir: string;

  beforeEach(() => {
    sessionId = `ses-plugin-skills-${++n}`;
    primaryDir = join(env.workspaceRootDir, sessionId);
    mkdirSync(primaryDir, { recursive: true });
  });

  it("renders each as <plugin>:<skill> at its SKILL.md inside the mounted archive", async () => {
    const { deps } = depsWith(pluginClient(), sessionId);
    const { skills } = await mountSkills(deps, { blueprint: pluginBlueprint(kitPlugin()), sessionId, primaryDir, subAgents: false, toolScope: ToolScope.unrestricted() });
    expect(skills.root).toEqual([
      {
        name: "kit:triage",
        description: "Sort the inbox",
        path: join(STIGMER_LOCAL_STATE_DIR, PLUGINS_SUBDIR, PLUGIN_DIGEST, "skills/triage", "SKILL.md"),
      },
      {
        name: "kit:release",
        description: "Skill: release",
        path: join(STIGMER_LOCAL_STATE_DIR, PLUGINS_SUBDIR, PLUGIN_DIGEST, "skills/release", "SKILL.md"),
      },
    ]);
    expect(skills.bySubAgent.size, "no sub-agents on this harness").toBe(0);
  });

  it("gives a plugin's agent only the skills its skills: names", async () => {
    const { deps } = depsWith(pluginClient(), sessionId);
    const { skills, loaded } = await mountSkills(deps, { blueprint: pluginBlueprint(kitPlugin()), sessionId, primaryDir, subAgents: true, toolScope: ToolScope.unrestricted() });
    expect(skills.root.map((s) => s.name)).toEqual(["kit:triage", "kit:release"]);
    expect(loaded, "a plugin's skills are named by its digest, not listed").toEqual([]);
    expect([...skills.bySubAgent.keys()]).toEqual(["kit:reviewer"]);
    expect(skills.bySubAgent.get("kit:reviewer")!.map((s) => s.name)).toEqual(["kit:triage"]);
  });

  it("hides a plugin's skills, the root's and its agents', when the turn's lists deny Skill", async () => {
    const { deps } = depsWith(pluginClient(), sessionId);
    const { skills } = await mountSkills(deps, {
      blueprint: pluginBlueprint(kitPlugin()),
      sessionId,
      primaryDir,
      subAgents: true,
      toolScope: ToolScope.ofMain([{ owner: "The turn", lists: { tools: [], disallowedTools: ["Skill"] } }]),
    });
    expect(skills.root).toEqual([]);
    expect(skills.bySubAgent.size).toBe(0);
  });

  it("a plugin whose archive cannot be mounted contributes no skills, warned", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { deps } = depsWith(pluginClient(), sessionId);
    const { skills } = await mountSkills(deps, { blueprint: pluginBlueprint(kitPlugin("0".repeat(64))), sessionId, primaryDir, subAgents: true, toolScope: ToolScope.unrestricted() });
    expect(skills.root).toEqual([]);
    expect(skills.bySubAgent.size).toBe(0);
    expect(warn.mock.calls.some(([line]) => String(line).includes("the skills of plugin 'kit' are missing this turn"))).toBe(true);
    warn.mockRestore();
  });
});
