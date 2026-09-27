// The harness benchmark's WORKING agent: an agent shaped like the ones people
// run, provisioned from the checked-in fixture under
// test/conformance/fixtures/working-agent/ (its README says what every file
// is for and which defects are planted on purpose).
// Domain: conformance support (execution engine).
//
// The bare agent (support/agents.ts BARE_AGENT_INSTRUCTIONS) is what the
// request-shape goldens photograph. It has no tools, no MCP server, no skills
// and no workspace, so a benchmark of it can say nothing about the turns a
// user actually waits on. This agent carries each of those, one of a kind:
// - an HTTP MCP server on the execution target's tool fixture, serving the
//   read-only `lookup_order` table (harness/mcp-server.ts). That is the
//   user-declared remote shape;
// - memory on, through a real Organization with fixed confirmed facts. That
//   is the platform's stdio attachment: the runner spawns `stigmer
//   mcp-server` per turn (runner shared/memory-attachment.ts), so the
//   `stigmer` CLI must be on PATH wherever this agent runs;
// - eight skills, the count at which the native harness starts choosing
//   skills by relevance (runner shared/skill-relevance.ts);
// - one declared sub-agent with no skills of its own. The Cursor harness
//   mounts but never reads a sub-agent's skills (stigmer#1288), so giving it
//   some would measure that defect instead of the harness;
// - a seeded non-git workspace, a small Go module.
//
// Its instructions are the seeded default agent's own words
// (seedpack/dist/agents/assistant.yaml), plus one sentence naming the
// workspace, so the agent under measurement is the product's, not invented.
//
// Every name this module chooses that can reach the model's prompt is FIXED:
// the skill, sub-agent and MCP server names, the workspace entry and its host
// path, the facts, the instructions. Each provisioning gets a fresh
// Organization, which is what makes fixed names legal, and fixed names are
// what keep the prompt identical from session to session. A user's names and
// repository path do not change between their sessions either. Unique
// per-session names would make every session a prompt-cache miss, a cost no
// user pays. Values the platform itself mints per session stay as a user gets
// them.
//
// The workspace directory must be OUTSIDE this repository. The repository's
// go.work captures every `go` command beneath its root, so a copy inside the
// tree makes the agent's own `go test` fail. The runner also writes the host
// path into the prompt (runner shared/workspace/sources/local-path.ts), so the
// caller keeps it fixed.
//
// It is a fixture, not a product surface. The benchmark measures it, and the
// benchmark-readers smoke proves on the mock that it provisions and runs.
import { cp, readdir, readFile, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { ConformanceClients } from "../harness/clients";
import type { FixtureTracker } from "../harness/fixtures";
import { LOOKUP_ORDER_TOOL_NAME, type FixtureTool } from "../harness/mcp-server";
import { makeAgent } from "./agents";
import { makeHttpMcpServer } from "./mcpservers";
import { provisionOrgWithFacts } from "./memories";
import { localWorkspaceEntries, type LocalWorkspaceOption } from "./sessions";
import { zipFiles } from "./skills";

/** The checked-in fixture tree: `workspace/` and `skills/<name>/SKILL.md`. */
export const WORKING_AGENT_FIXTURE_DIR = resolve(import.meta.dirname, "..", "..", "fixtures", "working-agent");

export const WORKING_AGENT_NAME = "orders-assistant";
export const WORKING_AGENT_MCP_SERVER_NAME = "orders-api";
export const WORKING_AGENT_SUB_AGENT_NAME = "reviewer";

/** The workspace entry's name, and the basename every seeded workspace directory must carry. */
export const WORKING_AGENT_WORKSPACE_NAME = "orders-sync";

/** The fixture tools the agent's MCP server exposes. */
export const WORKING_AGENT_MCP_TOOLS: readonly FixtureTool[] = [LOOKUP_ORDER_TOOL_NAME];

export const WORKING_AGENT_INSTRUCTIONS = [
  "Be direct and concise. Act on requests rather than explaining steps. When you do not know something, say so.",
  "",
  "Your workspace is the orders-sync repository.",
].join("\n");

export const WORKING_AGENT_SUB_AGENT_INSTRUCTIONS =
  "Review the change or code you are given for correctness and risk, and report your findings by severity.";

/**
 * The facts the agent's organization remembers, in capture order. The first
 * is the one the memory task needs; the others are ordinary standing context.
 */
export const WORKING_AGENT_FACTS: readonly string[] = [
  "Fixes to the orders-sync service ship on the release/2026.10 branch; main is frozen until the October release.",
  "The team tracks bugs as BUG- tickets, and every changelog entry for a fix cites its ticket.",
  "The user prefers answers that lead with the conclusion.",
  "Replies written for customers are signed \"The Orders Team\".",
];

export interface WorkingAgent {
  org: string;
  agentId: string;
  /** The seeded workspace, as the session mounts it. */
  workspace: LocalWorkspaceOption;
  mcpServerSlug: string;
  /** The pushed skills' slugs, in the fixture's (sorted) order. */
  skillSlugs: string[];
}

export interface WorkingAgentOptions {
  /** The execution target's tool fixture URL for {@link WORKING_AGENT_MCP_TOOLS} (`McpToolFixture.url(...)`). */
  mcpUrl: string;
  /** The absolute directory the workspace is seeded into: outside the repository, basename {@link WORKING_AGENT_WORKSPACE_NAME}. */
  workspaceDir: string;
}

/**
 * Seeds the workspace, then creates the organization with its facts, the MCP
 * server, the eight skills and the agent, each deferred for cleanup on
 * `fixtures`. One call per session: a session's edits never reach the next.
 */
export async function provisionWorkingAgent(
  clients: ConformanceClients,
  fixtures: FixtureTracker,
  opts: WorkingAgentOptions,
): Promise<WorkingAgent> {
  await seedWorkingWorkspace(opts.workspaceDir);
  const { org } = await provisionOrgWithFacts(clients, fixtures, WORKING_AGENT_FACTS);

  const mcpServer = await clients.mcpServerCommand.create(
    makeHttpMcpServer({ org, name: WORKING_AGENT_MCP_SERVER_NAME, url: opts.mcpUrl, description: "the orders API" }),
  );
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: mcpServer.metadata!.id }));

  const skillSlugs: string[] = [];
  for (const name of await workingAgentSkillNames()) {
    const skillMd = await readFile(join(WORKING_AGENT_FIXTURE_DIR, "skills", name, "SKILL.md"));
    const skill = await clients.skillCommand.push({ org, artifact: zipFiles({ "SKILL.md": skillMd }) });
    fixtures.defer(() => clients.skillCommand.delete({ value: skill.metadata!.id }));
    skillSlugs.push(skill.metadata!.slug);
  }

  const agent = await clients.agentCommand.create(
    makeAgent({
      org,
      name: WORKING_AGENT_NAME,
      description: "the harness benchmark's working agent",
      instructions: WORKING_AGENT_INSTRUCTIONS,
      mcpServerRefs: [mcpServer.metadata!.slug],
      skillRefs: skillSlugs,
      subAgents: [
        {
          name: WORKING_AGENT_SUB_AGENT_NAME,
          description: "reviews a change or a piece of code and reports findings by severity",
          instructions: WORKING_AGENT_SUB_AGENT_INSTRUCTIONS,
        },
      ],
    }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  return {
    org,
    agentId: agent.metadata!.id,
    workspace: { name: WORKING_AGENT_WORKSPACE_NAME, path: opts.workspaceDir },
    mcpServerSlug: mcpServer.metadata!.slug,
    skillSlugs,
  };
}

/** The one-call session bootstrap for a working-agent session: its harness, its subject, its workspace. */
export function workingAgentSessionSpec(
  agent: WorkingAgent,
  harness: Harness,
  subject: string,
): MessageInitShape<typeof SessionSpecSchema> {
  return { harness, subject, workspaceEntries: localWorkspaceEntries([agent.workspace]) };
}

/**
 * Replaces `dir` with a fresh copy of the fixture workspace. Refuses a
 * directory whose basename is not the workspace's own name, so a wrong
 * argument can never empty an unrelated tree.
 */
export async function seedWorkingWorkspace(dir: string): Promise<void> {
  if (basename(dir) !== WORKING_AGENT_WORKSPACE_NAME) {
    throw new Error(`refusing to seed ${dir}: a working-agent workspace directory is named ${WORKING_AGENT_WORKSPACE_NAME}`);
  }
  await rm(dir, { recursive: true, force: true });
  await cp(join(WORKING_AGENT_FIXTURE_DIR, "workspace"), dir, { recursive: true });
}

/** The fixture's skill directory names, sorted, so the push order is fixed. */
export async function workingAgentSkillNames(): Promise<string[]> {
  const entries = await readdir(join(WORKING_AGENT_FIXTURE_DIR, "skills"), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}
