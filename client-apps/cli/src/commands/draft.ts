// `stigmer draft <skill|agent|mcp-server>` — AI-assisted resource creation. Each
// subcommand invokes a system agent (skill-creator/agent-creator/mcp-server-
// creator) that lives in the "stigmer" org, reusing the full run stack. Mirrors
// Go's draft.go + draft_handler.go.
//
// Draft differs from run only at the edges: the agent is fixed (a system agent),
// --message is required, and artifacts download to -o/--output (or the CWD)
// unless detached or a local workspace is in play.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { addAgentExecFlags, type AgentExecOptions, toAgentExecFlags } from "./agent-exec-flags.js";
import { globalOrg } from "./shared.js";

// The org that owns the system agent blueprints (installed by the seedpack),
// regardless of which org the user operates in. Mirrors Go's systemAgentOrg.
const SYSTEM_AGENT_ORG = "stigmer";

interface DraftFlags extends AgentExecOptions {
  output?: string;
  json?: boolean;
}

interface DraftConfig {
  /** Subcommand name + system agent slug. */
  readonly name: string;
  /** User-facing resource label. */
  readonly resourceType: string;
  readonly summary: string;
}

const CONFIGS: readonly DraftConfig[] = [
  { name: "skill", resourceType: "Skill", summary: "create a skill with AI assistance" },
  { name: "agent", resourceType: "Agent", summary: "create an agent with AI assistance" },
  { name: "mcp-server", resourceType: "McpServer", summary: "create an MCP server config with AI assistance" },
];

// System agent slug per subcommand (Go's draftConfig.AgentName: "<type>-creator").
function agentSlug(name: string): string {
  return `${name}-creator`;
}

export function registerDraft(program: Command): void {
  const draft = program.command("draft").description("create resource configurations with AI assistance");
  for (const config of CONFIGS) {
    const sub = draft.command(config.name).description(config.summary);
    addAgentExecFlags(sub, true)
      .option("-o, --output <dir>", "directory to save generated artifacts (default: current directory)")
      .option("--json", "stream events as newline-delimited JSON")
      .action((options: DraftFlags, command: Command) => runDraft(config, options, command));
  }
}

async function runDraft(config: DraftConfig, options: DraftFlags, command: Command): Promise<void> {
  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  if (org === "") {
    throw new UsageError(
      "organization not set\n\nSet it with:\n  stigmer config context set --org <org>\n  stigmer draft --org <org> ...",
    );
  }

  const [{ prepareAgentExec }, { executeResolvedAgent }, { resolveAgentRef }, { localWorkspaceRoots }] =
    await Promise.all([
      import("../resources/run/prepare.js"),
      import("../resources/run/agent-exec.js"),
      import("../resources/run/resolve.js"),
      import("../resources/run/workspace.js"),
    ]);

  const agent = await resolveDraftAgent(resolveAgentRef, client.stigmer, config);

  const prepared = await prepareAgentExec(toAgentExecFlags(options), client.stigmer, org, stderrProgress());

  if (prepared.attachments.length + prepared.workspaceFileRefs.length > 0) {
    process.stderr.write(`Attached ${prepared.attachments.length + prepared.workspaceFileRefs.length} file(s) as context\n`);
  }

  await executeResolvedAgent({
    agent,
    prepared,
    org,
    downloadDir: resolveDownloadDir(options.output ?? "", prepared.detach, localWorkspaceRoots(prepared.workspaceEntries)),
    outputMode: options.json === true ? "json" : "inline",
    client,
  });
}

// Resolve the system agent in the "stigmer" org, with seedpack-recovery guidance
// on failure (Go's displayDraftAgentNotFoundError).
async function resolveDraftAgent(
  resolveAgentRef: typeof import("../resources/run/resolve.js").resolveAgentRef,
  client: import("@stigmer/sdk").Stigmer,
  config: DraftConfig,
): Promise<import("@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb").Agent> {
  const slug = agentSlug(config.name);
  try {
    return await resolveAgentRef(client, `${SYSTEM_AGENT_ORG}/${slug}`, SYSTEM_AGENT_ORG);
  } catch {
    throw new UsageError(
      `${slug} agent not found in organization "${SYSTEM_AGENT_ORG}"\n\n` +
        `System agents are installed by the seedpack in the "${SYSTEM_AGENT_ORG}" organization.\n\n` +
        "Troubleshooting:\n" +
        `  1. Verify agents exist:  stigmer list agents --org ${SYSTEM_AGENT_ORG}\n` +
        "  2. Re-apply seedpack:    stigmer apply -f seedpack/",
    );
  }
}

// Download-target resolution (Go's executeDraft switch):
//   detach          → no download (execution is backgrounded)
//   explicit -o     → that directory
//   local workspace → skip (the agent writes directly to disk)
//   otherwise       → current directory
function resolveDownloadDir(output: string, detach: boolean, localRoots: readonly string[]): string {
  if (detach) return "";
  if (output !== "") return output;
  if (localRoots.length > 0) return "";
  return ".";
}

function stderrProgress(): (line: string) => void {
  if (process.stderr.isTTY !== true) return () => {};
  return (line) => void process.stderr.write(`${line}\n`);
}
