/**
 * Pins the skills phase (`turn-context.ts` `mountSkills`) as the runtime's
 * one reader of skills for EVERY owner: the root's merged refs and each
 * sub-agent's own, resolved through one resolver into `TurnSkills`.
 *
 * What is asserted: the shape (root vs a map keyed by sub-agent name; no
 * entry for a sub-agent without refs), that a skill the root and a sub-agent
 * share is fetched per owner but MOUNTED once (the hash-keyed mount marker,
 * so the second write is a cache hit), that one owner's failing ref costs
 * that owner alone (the root's skills stand; the sub-agent gets what
 * resolved), and that a harness without sub-agents (`capabilities.subAgents`
 * false) resolves the root only — the flag's first reader. The phase reports
 * its one label, so the runtime's label list is unchanged. A scope that
 * denies `Skill` hides skills: the main scope's deny (the agent's or the
 * turn's) fetches nothing for any owner, a sub-agent's own deny only its
 * own, and an allow-list that omits `Skill` keeps them.
 *
 * A plugin's skills come from its mounted archive, never a skill fetch: each
 * renders as `<plugin>:<skill>` at `.stigmer/plugins/<digest>/<path>/SKILL.md`
 * for the root, a plugin's agent (`<plugin>:<agent>`) gets only the skills
 * its `skills:` names, and a plugin whose archive cannot be mounted
 * contributes none, warned.
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
import { Code, ConnectError } from "@connectrpc/connect";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { SkillSchema, type Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceReferenceSchema, type ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { GetArtifactResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { buildZip } from "@stigmer/zip-structure/testing";

import { createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { ToolScope } from "../../shared/tool-lists.js";
import { TranscriptBuilder } from "../transcript/builder.js";
import { mountSkills, type ResolutionDeps } from "../turn-context.js";
import { pluginSubAgents } from "../../shared/blueprint-resolver.js";
import { PLUGINS_SUBDIR } from "../../shared/plugin-mount.js";
import { STIGMER_LOCAL_STATE_DIR } from "../../shared/workspace/stigmer-link.js";

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
  return {
    labels,
    deps: {
      input: { executionId: `aex-${sessionId}`, threadId: "", turnSeq: 0 },
      client,
      config: testConfig({ workspaceRootDir: env.workspaceRootDir }),
      status,
      transcript: new TranscriptBuilder(`aex-${sessionId}`, status),
      artifactStorage: undefined,
      timing: new TimingRecorder(),
      signal: new AbortController().signal,
      heartbeat: () => {},
      enterPhase: () => {},
      reportProgress: async (label) => {
        labels.push(label);
      },
    },
  };
}

function blueprintWith(
  rootRefs: readonly string[],
  subAgents: ReadonlyArray<{ name: string; refs: readonly string[]; disallowedTools?: string[] }>,
) {
  return turnInputFixture({
    blueprint: {
      mergedSkillRefs: rootRefs.map(ref),
      subAgents: subAgents.map((sa) =>
        create(SubAgentSchema, { name: sa.name, skillRefs: sa.refs.map(ref), disallowedTools: sa.disallowedTools ?? [] }),
      ),
    },
  }).blueprint;
}

describe("mountSkills: the runtime resolves every owner's skills", () => {
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

  it("resolves the root's merged refs and each sub-agent's own, keyed by the sub-agent's name; a sub-agent without refs has no entry", async () => {
    const { client } = skillClient(["alpha", "beta", "gamma"]);
    const { deps, labels } = depsWith(client, sessionId);
    const skills = await mountSkills(deps, {
      blueprint: blueprintWith(["alpha"], [{ name: "researcher", refs: ["beta", "gamma"] }, { name: "writer", refs: [] }]),
      sessionId,
      primaryDir,
      subAgents: true,
      toolScope: ToolScope.unrestricted(),
    });
    expect(skills.root.map((s) => s.name)).toEqual(["alpha"]);
    expect([...skills.bySubAgent.keys()]).toEqual(["researcher"]);
    expect(skills.bySubAgent.get("researcher")!.map((s) => s.name)).toEqual(["beta", "gamma"]);
    expect(skills.bySubAgent.get("researcher")![0]!.path, "a sub-agent's skill mounts where the root's do").toBe(".stigmer/skills/beta/SKILL.md");
    expect(labels, "one label for the whole phase").toEqual(["Resolving skills"]);
  });

  it("a skill the root and a sub-agent share is fetched per owner but mounted once (the second resolution is a mount-cache hit)", async () => {
    const { client, fetches } = skillClient(["shared"]);
    const { deps } = depsWith(client, sessionId);
    const writes = vi.spyOn(await import("../../shared/skill-mount.js"), "writeSkillMount");
    const skills = await mountSkills(deps, {
      blueprint: blueprintWith(["shared"], [{ name: "researcher", refs: ["shared"] }]),
      sessionId,
      primaryDir,
      subAgents: true,
      toolScope: ToolScope.unrestricted(),
    });
    expect(skills.root.map((s) => s.name)).toEqual(["shared"]);
    expect(skills.bySubAgent.get("researcher")!.map((s) => s.name)).toEqual(["shared"]);
    expect(fetches, "the control plane is asked once per owner").toEqual(["shared", "shared"]);
    expect(writes, "the mount is written once; the second owner hits the hash-keyed marker").toHaveBeenCalledTimes(1);
    writes.mockRestore();
  });

  it("one owner's failing ref costs that owner alone: the root's skills stand and the sub-agent gets what resolved", async () => {
    const { client } = skillClient(["alpha", "beta"]);
    const { deps } = depsWith(client, sessionId);
    const skills = await mountSkills(deps, {
      blueprint: blueprintWith(["alpha"], [{ name: "researcher", refs: ["missing", "beta"] }]),
      sessionId,
      primaryDir,
      subAgents: true,
      toolScope: ToolScope.unrestricted(),
    });
    expect(skills.root.map((s) => s.name)).toEqual(["alpha"]);
    expect(skills.bySubAgent.get("researcher")!.map((s) => s.name), "warned and skipped, never thrown").toEqual(["beta"]);
  });

  it("a harness without sub-agents resolves the root only: no sub-agent ref is fetched", async () => {
    const { client, fetches } = skillClient(["alpha", "beta"]);
    const { deps } = depsWith(client, sessionId);
    const skills = await mountSkills(deps, {
      blueprint: blueprintWith(["alpha"], [{ name: "researcher", refs: ["beta"] }]),
      sessionId,
      primaryDir,
      subAgents: false,
      toolScope: ToolScope.unrestricted(),
    });
    expect(skills.root.map((s) => s.name)).toEqual(["alpha"]);
    expect(skills.bySubAgent.size).toBe(0);
    expect(fetches).toEqual(["alpha"]);
  });

  it("a turn that denies Skill fetches and mounts no skill for any owner, so no prompt can list one", async () => {
    const { client, fetches } = skillClient(["alpha", "beta"]);
    const { deps } = depsWith(client, sessionId);
    const skills = await mountSkills(deps, {
      blueprint: blueprintWith(["alpha"], [{ name: "researcher", refs: ["beta"] }]),
      sessionId,
      primaryDir,
      subAgents: true,
      toolScope: ToolScope.ofMain([{ owner: "The turn", lists: { tools: [], disallowedTools: ["Skill"] } }]),
    });
    expect(skills.root).toEqual([]);
    expect(skills.bySubAgent.size).toBe(0);
    expect(fetches).toEqual([]);
  });

  it("a sub-agent whose own lists deny Skill loses its skills alone; an allow-list that omits Skill keeps them", async () => {
    const { client, fetches } = skillClient(["alpha", "beta", "gamma"]);
    const { deps } = depsWith(client, sessionId);
    const skills = await mountSkills(deps, {
      blueprint: blueprintWith(["alpha"], [
        { name: "researcher", refs: ["beta"], disallowedTools: ["Skill"] },
        { name: "writer", refs: ["gamma"] },
      ]),
      sessionId,
      primaryDir,
      subAgents: true,
      toolScope: ToolScope.of("The agent", { tools: ["Read"], disallowedTools: [] }),
    });
    expect(skills.root.map((s) => s.name), "Read alone still keeps the platform's skills").toEqual(["alpha"]);
    expect([...skills.bySubAgent.keys()]).toEqual(["writer"]);
    expect(fetches).toEqual(["alpha", "gamma"]);
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
    getPluginArtifactDownloadUrl: vi.fn(async () => {
      throw new ConnectError("no download lane", Code.Unimplemented);
    }),
    getPluginArtifact: vi.fn(async () => create(GetArtifactResponseSchema, { artifact: PLUGIN_ARCHIVE })),
  });
}

function pluginBlueprint(plugin: Plugin) {
  return turnInputFixture({ blueprint: { plugins: [plugin], subAgents: pluginSubAgents(plugin) } }).blueprint;
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
    const skills = await mountSkills(deps, { blueprint: pluginBlueprint(kitPlugin()), sessionId, primaryDir, subAgents: false, toolScope: ToolScope.unrestricted() });
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
    const skills = await mountSkills(deps, { blueprint: pluginBlueprint(kitPlugin()), sessionId, primaryDir, subAgents: true, toolScope: ToolScope.unrestricted() });
    expect(skills.root.map((s) => s.name)).toEqual(["kit:triage", "kit:release"]);
    expect([...skills.bySubAgent.keys()]).toEqual(["kit:reviewer"]);
    expect(skills.bySubAgent.get("kit:reviewer")!.map((s) => s.name)).toEqual(["kit:triage"]);
  });

  it("hides a plugin's skills, the root's and its agents', when the turn's lists deny Skill", async () => {
    const { deps } = depsWith(pluginClient(), sessionId);
    const skills = await mountSkills(deps, {
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
    const skills = await mountSkills(deps, { blueprint: pluginBlueprint(kitPlugin("0".repeat(64))), sessionId, primaryDir, subAgents: true, toolScope: ToolScope.unrestricted() });
    expect(skills.root).toEqual([]);
    expect(skills.bySubAgent.size).toBe(0);
    expect(warn.mock.calls.some(([line]) => String(line).includes("the skills of plugin 'kit' are missing this turn"))).toBe(true);
    warn.mockRestore();
  });
});
