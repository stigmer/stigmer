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
// - a plugin whose one HTTP MCP server is the execution target's tool
//   fixture, serving the read-only `lookup_order` table
//   (harness/mcp-server.ts). That is the user-installed remote shape;
// - memory on, through a real Organization with fixed confirmed facts. That
//   is the platform's stdio attachment: the runner spawns `stigmer
//   mcp-server` per turn (runner shared/memory-attachment.ts), so the
//   `stigmer` CLI must be on PATH wherever this agent runs;
// - eight skills, the count at which the native harness once began choosing
//   skills by the message (it now describes every one on every turn);
// - one subagent, a saved agent of its own the agent lists, with no skills
//   of its own;
// - a seeded non-git workspace, a small Go module; the benchmark's
//   background cells lay a slow test suite and a server over it.
//
// Its instructions are the seeded default agent's own words
// (seedpack/dist/agents/assistant.yaml), plus one sentence naming the
// workspace, so the agent under measurement is the product's, not invented.
//
// Every name this module chooses that can reach the model's prompt is FIXED:
// the skill, subagent, plugin and MCP server names, the workspace resource and its host
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
import type { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import type { ConformanceClients } from "../harness/clients";
import type { FixtureTracker } from "../harness/fixtures";
import { LOOKUP_ORDER_TOOL_NAME, type FixtureTool } from "../harness/mcp-server";
import { type AgentRefInit, agentRefOf, createSubagents, makeAgent, subagentSlugsOf } from "./agents";
import { oneServerPlugin, pushPlugin } from "./plugins";
import { provisionOrgWithFacts } from "./memories";
import { localWorkspaceResources, type LocalWorkspaceOption } from "./sessions";
import { zipFiles } from "./skills";

/** The checked-in fixture tree: a plugin, its `skills/<name>/SKILL.md` and its `evals/` suite (the quality arm's). */
export const WORKING_AGENT_FIXTURE_DIR = resolve(import.meta.dirname, "..", "..", "fixtures", "working-agent");

/** The repository the agent works in, kept once in the suite as the scaffolds' shared fixture. */
export const WORKING_AGENT_WORKSPACE_FIXTURE_DIR = join(WORKING_AGENT_FIXTURE_DIR, "evals", "_fixture", "workspace");

/**
 * What the benchmark's background cells lay over the seeded workspace: a slow
 * integration suite and an HTTP server (its README). Beside the plugin's
 * directory, never in it, so the quality eval's plugin stays as it is.
 */
export const WORKING_AGENT_BACKGROUND_OVERLAY_DIR = resolve(WORKING_AGENT_FIXTURE_DIR, "..", "working-agent-background", "workspace");

export const WORKING_AGENT_NAME = "orders-assistant";
/** The plugin the agent uses, and its one MCP server's name inside it. */
export const WORKING_AGENT_PLUGIN_NAME = "orders-api";
export const WORKING_AGENT_MCP_SERVER_NAME = "orders";
export const WORKING_AGENT_SUB_AGENT_NAME = "reviewer";

/** The workspace resource's name, and the basename every seeded workspace directory must carry. */
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
  /** The agent a session starts on. */
  agentRef: AgentRefInit;
  /** The seeded workspace, as the session mounts it. */
  workspace: LocalWorkspaceOption;
  /** The slug of the plugin whose one server is the orders API. */
  pluginSlug: string;
  /** The pushed skills' slugs, in the fixture's (sorted) order. */
  skillSlugs: string[];
}

export interface WorkingAgentOptions {
  /** The execution target's tool fixture URL for {@link WORKING_AGENT_MCP_TOOLS} (`McpToolFixture.url(...)`). */
  mcpUrl: string;
  /** The absolute directory the workspace is seeded into: outside the repository, basename {@link WORKING_AGENT_WORKSPACE_NAME}. */
  workspaceDir: string;
  /** A directory copied over the seeded workspace (a cell's own files, {@link WORKING_AGENT_BACKGROUND_OVERLAY_DIR}). */
  overlayDir?: string;
}

/**
 * Seeds the workspace, then creates the organization with its facts, the
 * plugin carrying the MCP server, the eight skills, the subagent and the agent
 * listing it, each deferred for cleanup on
 * `fixtures`. One call per session: a session's edits never reach the next.
 */
export async function provisionWorkingAgent(
  clients: ConformanceClients,
  fixtures: FixtureTracker,
  opts: WorkingAgentOptions,
): Promise<WorkingAgent> {
  await seedWorkingWorkspace(opts.workspaceDir, opts.overlayDir);
  const { org } = await provisionOrgWithFacts(clients, fixtures, WORKING_AGENT_FACTS);

  const plugin = await pushPlugin(
    clients,
    fixtures,
    org,
    oneServerPlugin({ name: WORKING_AGENT_PLUGIN_NAME, serverName: WORKING_AGENT_MCP_SERVER_NAME, server: { url: opts.mcpUrl } }),
  );

  const skillSlugs: string[] = [];
  for (const name of await workingAgentSkillNames()) {
    const skillMd = await readFile(join(WORKING_AGENT_FIXTURE_DIR, "skills", name, "SKILL.md"));
    const skill = await clients.skillCommand.push({ org, artifact: zipFiles({ "SKILL.md": skillMd }) });
    fixtures.defer(() => clients.skillCommand.delete({ value: skill.metadata!.id }));
    skillSlugs.push(skill.metadata!.slug);
  }

  const subagents = await createSubagents(clients, fixtures, org, [
    {
      name: WORKING_AGENT_SUB_AGENT_NAME,
      description: "reviews a change or a piece of code and reports findings by severity",
      instructions: WORKING_AGENT_SUB_AGENT_INSTRUCTIONS,
    },
  ]);

  const agent = await clients.agentCommand.create(
    makeAgent({
      org,
      name: WORKING_AGENT_NAME,
      description: "the harness benchmark's working agent",
      instructions: WORKING_AGENT_INSTRUCTIONS,
      plugins: [plugin.metadata!.slug],
      skillRefs: skillSlugs,
      subagents: subagentSlugsOf(subagents),
    }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  return {
    org,
    agentRef: agentRefOf(agent),
    workspace: { name: WORKING_AGENT_WORKSPACE_NAME, path: opts.workspaceDir },
    pluginSlug: plugin.metadata!.slug,
    skillSlugs,
  };
}

/** The one-call session bootstrap for a working-agent session: its harness, its subject, its workspace. */
export function workingAgentSessionSpec(
  agent: WorkingAgent,
  harness: Harness,
  subject: string,
): MessageInitShape<typeof SessionSpecSchema> {
  return { harness, subject, resources: localWorkspaceResources([agent.workspace]) };
}

/**
 * Replaces `dir` with a fresh copy of the fixture workspace, with `overlayDir`
 * copied over it when given. Refuses a directory whose basename is not the
 * workspace's own name, so a wrong argument can never empty an unrelated tree.
 */
export async function seedWorkingWorkspace(dir: string, overlayDir?: string): Promise<void> {
  if (basename(dir) !== WORKING_AGENT_WORKSPACE_NAME) {
    throw new Error(`refusing to seed ${dir}: a working-agent workspace directory is named ${WORKING_AGENT_WORKSPACE_NAME}`);
  }
  await rm(dir, { recursive: true, force: true });
  await cp(WORKING_AGENT_WORKSPACE_FIXTURE_DIR, dir, { recursive: true });
  if (overlayDir !== undefined) await cp(overlayDir, dir, { recursive: true });
}

/** The fixture's skill directory names, sorted, so the push order is fixed. */
export async function workingAgentSkillNames(): Promise<string[]> {
  const entries = await readdir(join(WORKING_AGENT_FIXTURE_DIR, "skills"), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
}
