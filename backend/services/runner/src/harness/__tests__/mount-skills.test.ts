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
 * its one label, so the runtime's label list is unchanged.
 *
 * The control-plane client is doubled at its module boundary with scripted
 * skills; `HOME` is the hermetic environment's, so the mounts land under a
 * temp platform dir and nothing touches the developer's `~/.stigmer`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { SkillSchema, type Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceReferenceSchema, type ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { turnInputFixture } from "../../__test-utils__/turn-input-fixture.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { mountSkills, type ResolutionDeps } from "../turn-context.js";

const env = createHermeticEnvironment();

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
  return {
    labels,
    deps: {
      input: { executionId: `aex-${sessionId}`, threadId: "", turnSeq: 0 },
      client,
      config: testConfig({ workspaceRootDir: env.workspaceRootDir }),
      status: create(AgentExecutionStatusSchema, {}),
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

function blueprintWith(rootRefs: readonly string[], subAgents: ReadonlyArray<{ name: string; refs: readonly string[] }>) {
  return turnInputFixture({
    blueprint: {
      mergedSkillRefs: rootRefs.map(ref),
      subAgents: subAgents.map((sa) => create(SubAgentSchema, { name: sa.name, skillRefs: sa.refs.map(ref) })),
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
  afterAll(() => {
    env.dispose();
  });

  it("resolves the root's merged refs and each sub-agent's own, keyed by the sub-agent's name; a sub-agent without refs has no entry", async () => {
    const { client } = skillClient(["alpha", "beta", "gamma"]);
    const { deps, labels } = depsWith(client, sessionId);
    const skills = await mountSkills(deps, {
      blueprint: blueprintWith(["alpha"], [{ name: "researcher", refs: ["beta", "gamma"] }, { name: "writer", refs: [] }]),
      sessionId,
      primaryDir,
      subAgents: true,
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
    });
    expect(skills.root.map((s) => s.name)).toEqual(["alpha"]);
    expect(skills.bySubAgent.size).toBe(0);
    expect(fetches).toEqual(["alpha"]);
  });
});
