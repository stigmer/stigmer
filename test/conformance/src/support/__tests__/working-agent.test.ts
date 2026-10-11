// Unit arms for the working agent's fixture and seeding, with no server.
// Domain: conformance support.
//
// Pinned: the fixture carries exactly eight skills, the count the benchmark's
// baselines were taken with; each skill's frontmatter name is its directory's
// (the server names a pushed skill from the frontmatter, so a mismatch would
// push a skill the agent's references never find) and carries a description
// (what the agent reads to choose one); seeding copies
// the workspace byte for byte into a fresh directory and replaces a
// previous session's edits; a directory that is not named for the workspace
// is refused, so a wrong argument can never empty an unrelated tree; the
// session bootstrap mounts that one workspace; provisioning (against stubbed
// clients) starts sessions on the agent it created by reference, that agent
// lists the plugin carrying the MCP server and every pushed skill, and every resource it
// created is deleted at cleanup.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedFiles } from "../../benchmark/workspace-facts";
import type { ConformanceClients } from "../../harness/clients";
import { FixtureTracker } from "../../harness/fixtures";
import type { InitShape } from "../init-shape";
import {
  provisionWorkingAgent,
  seedWorkingWorkspace,
  WORKING_AGENT_FACTS,
  WORKING_AGENT_FIXTURE_DIR,
  WORKING_AGENT_WORKSPACE_NAME,
  workingAgentSessionSpec,
  workingAgentSkillNames,
} from "../working-agent";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "working-agent-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("the working agent's skills", () => {
  it("are eight, each named in its frontmatter as its directory is, each with a description", async () => {
    const names = await workingAgentSkillNames();
    expect(names).toHaveLength(8);
    for (const name of names) {
      const skillMd = await readFile(join(WORKING_AGENT_FIXTURE_DIR, "skills", name, "SKILL.md"), "utf8");
      const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(skillMd)?.[1] ?? "";
      expect(frontmatter, name).toMatch(new RegExp(`^name: ${name}$`, "m"));
      expect(frontmatter, name).toMatch(/^description: \S/m);
    }
  });
});

describe("seedWorkingWorkspace", () => {
  it("copies the fixture workspace byte for byte, and replaces a previous session's edits", async () => {
    const dir = join(base, WORKING_AGENT_WORKSPACE_NAME);
    await seedWorkingWorkspace(dir);
    expect(await changedFiles(join(WORKING_AGENT_FIXTURE_DIR, "workspace"), dir)).toEqual([]);

    await writeFile(join(dir, "NOTES.md"), "left by the last session\n");
    await writeFile(join(dir, "go.mod"), "module edited\n");
    await seedWorkingWorkspace(dir);
    expect(await changedFiles(join(WORKING_AGENT_FIXTURE_DIR, "workspace"), dir)).toEqual([]);
  });

  it("refuses a directory not named for the workspace", async () => {
    await expect(seedWorkingWorkspace(join(base, "home"))).rejects.toThrow(`is named ${WORKING_AGENT_WORKSPACE_NAME}`);
  });
});

describe("workingAgentSessionSpec", () => {
  it("bootstraps the session on the harness asked for, with the one workspace mounted by host path", () => {
    const spec = workingAgentSessionSpec(
      { org: "org", agentRef: { org: "org", slug: "orders-agent" }, workspace: { name: WORKING_AGENT_WORKSPACE_NAME, path: "/tmp/x/orders-sync" }, pluginSlug: "orders-api", skillSlugs: [] },
      Harness.CURSOR,
      "harness benchmark",
    );
    expect(spec).toEqual({
      harness: Harness.CURSOR,
      subject: "harness benchmark",
      workspaceEntries: [
        { name: WORKING_AGENT_WORKSPACE_NAME, source: { source: { case: "localPath", value: { path: "/tmp/x/orders-sync" } } } },
      ],
    });
  });
});

// Clients that answer every create with the id and slug a server would mint,
// and record what the provisioning asked to create and to delete.
function recordingClients(): {
  clients: ConformanceClients;
  agentRequests: InitShape<typeof AgentSchema>[];
  deleted: string[];
} {
  const agentRequests: InitShape<typeof AgentSchema>[] = [];
  const deleted: string[] = [];
  let skills = 0;
  let memories = 0;
  const clients = {
    organizationCommand: {
      create: async () => ({ metadata: { id: "org_unit", slug: "retrorg-unit" } }),
      delete: async ({ value }: { value: string }) => void deleted.push(value),
    },
    memoryCommand: {
      create: async () => ({ metadata: { id: `mem_${++memories}` } }),
      confirm: async () => ({}),
      delete: async ({ value }: { value: string }) => void deleted.push(value),
    },
    pluginCommand: {
      push: async () => ({ metadata: { id: "plg_unit", slug: "orders-api" } }),
      delete: async ({ value }: { value: string }) => void deleted.push(value),
    },
    skillCommand: {
      push: async () => {
        skills += 1;
        return { metadata: { id: `skl_${skills}`, slug: `skill-${skills}` } };
      },
      delete: async ({ value }: { value: string }) => void deleted.push(value),
    },
    agentCommand: {
      create: async (request: InitShape<typeof AgentSchema>) => {
        agentRequests.push(request);
        return { metadata: { id: "agt_unit", org: request.metadata?.org, slug: "orders-agent" } };
      },
      delete: async ({ value }: { value: string }) => void deleted.push(value),
    },
  } as unknown as ConformanceClients;
  return { clients, agentRequests, deleted };
}

describe("provisionWorkingAgent", () => {
  it("starts sessions on the agent it created by reference, and deletes everything it created at cleanup", async () => {
    const { clients, agentRequests, deleted } = recordingClients();
    const fixtures = new FixtureTracker();
    const workspaceDir = join(base, WORKING_AGENT_WORKSPACE_NAME);

    const agent = await provisionWorkingAgent(clients, fixtures, { mcpUrl: "http://127.0.0.1:1/mcp", workspaceDir });

    expect(agent.org).toBe("retrorg-unit");
    expect(agent.agentRef).toEqual({ org: "retrorg-unit", slug: "orders-agent" });
    expect(agent.workspace).toEqual({ name: WORKING_AGENT_WORKSPACE_NAME, path: workspaceDir });
    expect(agent.pluginSlug).toBe("orders-api");
    const skillSlugs = (await workingAgentSkillNames()).map((_, i) => `skill-${i + 1}`);
    expect(agent.skillSlugs).toEqual(skillSlugs);

    expect(agentRequests).toHaveLength(1);
    const spec = agentRequests[0]!.spec;
    expect(spec?.plugins?.map((ref) => ref.slug)).toEqual(["orders-api"]);
    expect(spec?.skillRefs?.map((ref) => ref.slug)).toEqual(skillSlugs);

    await fixtures.cleanup();
    const memoryIds = WORKING_AGENT_FACTS.map((_, i) => `mem_${i + 1}`);
    expect([...deleted].sort()).toEqual(
      ["agt_unit", "plg_unit", "org_unit", ...memoryIds, ...skillSlugs.map((_, i) => `skl_${i + 1}`)].sort(),
    );
  });
});
