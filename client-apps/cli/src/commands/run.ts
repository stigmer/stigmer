// `stigmer run [agent]` — run an agent and stream it. Thin handler: parse
// flags, resolve the reference (0/1-arg dispatch mirroring Go's run.go +
// run_picker.go), then delegate to the shared run stack. Heavy modules
// (backend client, Ink, the differ) load lazily inside the action so `--help`
// stays fast.
//
// No reference at all is the built-in assistant: `stigmer run -m "..."` runs
// it at once (the person said what to say, so there is nothing to pick), and
// a bare `stigmer run` on a terminal opens the agent picker with the
// assistant as its first row. Off a terminal with no message there is
// nothing to run and the guidance names both forms.

import type { Command } from "commander";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { interactiveBrowseEnabled } from "../resources/picker/tty.js";
import {
  addAgentExecFlags,
  type AgentExecOptions,
} from "./agent-exec-flags.js";
import { globalOrg } from "./shared.js";
import { requireOrganization } from "../client/single-org.js";

interface RunFlags extends AgentExecOptions {
  json?: boolean;
  download?: string;
}

export function registerRun(program: Command): void {
  // One argument: the agent. A second is refused rather than ignored, so the
  // old `run <type> <reference>` form fails loudly instead of resolving an
  // agent named by its first word.
  const run = program
    .command("run [agent]")
    .description("run an agent by reference")
    .allowExcessArguments(false);
  addAgentExecFlags(run)
    .option("--json", "stream events as newline-delimited JSON")
    .option("--download <dir>", "download artifacts to directory when complete")
    .action(
      (agent: string | undefined, options: RunFlags, command: Command) =>
        runRun(agent, options, command),
    );
}

async function runRun(
  reference: string | undefined,
  options: RunFlags,
  command: Command,
): Promise<void> {
  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  await requireOrganization(client.stigmer, org, [
    "stigmer config context set --org <org>",
    "stigmer run --org <org> ...",
  ]);

  const outputMode = options.json === true ? "json" : "inline";

  // 0 args → the built-in assistant when a message was given; else the
  // interactive agent picker on a TTY; otherwise actionable guidance.
  if (reference === undefined) {
    if ((options.message ?? "") !== "") {
      await runResolvedAgent(undefined, options, org, outputMode, client);
      return;
    }
    if (interactiveBrowseEnabled(outputMode)) {
      await browseAndRunAgent("", options, org, outputMode, client);
      return;
    }
    throw browseUnavailableError("");
  }
  await runSmart(reference, options, org, outputMode, client);
}

// stigmer run <value>: classify the argument and dispatch (Go's
// executeRunSmart). Session IDs belong to `resume`; complete agent IDs resolve
// directly; other resource IDs are not runnable; bare text is resolved as an
// agent slug.
async function runSmart(
  value: string,
  options: RunFlags,
  org: string,
  outputMode: "inline" | "json",
  client: import("../client/index.js").BackendClient,
): Promise<void> {
  const { isSessionId, hasResourceIdPrefix, isAgentId, validateResourceId } =
    await import("../resources/reference.js");

  if (isSessionId(value)) {
    throw new UsageError(
      `Session IDs are handled by the resume command\n\nTo resume a session:\n  stigmer resume ${value}`,
    );
  }

  if (hasResourceIdPrefix(value)) {
    if (isAgentId(value)) {
      if (validateResourceId(value) !== null) {
        throw new UsageError(
          `Incomplete agent ID: ${value}\n\nProvide the full agent ID (e.g. agt_01abc123xyz456789012345678)`,
        );
      }
      await runAgent(value, options, org, outputMode, client);
      return;
    }
    throw new UsageError(
      `Cannot run resource ID "${value}": only agents run\n\nTo run an agent:\n  stigmer run <agent-id>`,
    );
  }

  // Bare text: try to resolve as an agent reference; on failure, fall back to
  // the interactive picker (pre-filled with the typed text) on a TTY, otherwise
  // guide the user.
  const { resolveAgentRef } = await import("../resources/run/resolve.js");
  let agent: import("@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb").Agent;
  try {
    agent = await resolveAgentRef(client.stigmer, value, org);
  } catch {
    if (interactiveBrowseEnabled(outputMode)) {
      await browseAndRunAgent(value, options, org, outputMode, client);
      return;
    }
    throw browseUnavailableError(value);
  }
  await runResolvedAgent(agent, options, org, outputMode, client);
}

// Resolve a complete agent ID, then run.
async function runAgent(
  agentId: string,
  options: RunFlags,
  org: string,
  outputMode: "inline" | "json",
  client: import("../client/index.js").BackendClient,
): Promise<void> {
  const { resolveAgentRef } = await import("../resources/run/resolve.js");
  const agent = await resolveAgentRef(client.stigmer, agentId, org);
  await runResolvedAgent(agent, options, org, outputMode, client);
}

// `agent` undefined is the built-in assistant: the run names no agent
// and the backend creates a session that names none.
async function runResolvedAgent(
  agent: import("@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb").Agent | undefined,
  options: RunFlags,
  org: string,
  outputMode: "inline" | "json",
  client: import("../client/index.js").BackendClient,
): Promise<void> {
  const { prepareAgentExec } = await import("../resources/run/prepare.js");
  const { executeResolvedAgent } =
    await import("../resources/run/agent-exec.js");
  const { toAgentExecFlags } = await import("./agent-exec-flags.js");

  const prepared = await prepareAgentExec(
    toAgentExecFlags(options),
    client.stigmer,
    stderrProgress(),
    {
      // The kind's tier against the server's reported edition — the same
      // question the console asks — never the config's backend type.
      accountPreferencesAvailable: await client.isResourceAvailable(
        ApiResourceKind.identity_account,
      ),
      agentSpec: agent?.spec,
    },
  );
  await executeResolvedAgent({
    agent,
    prepared,
    org,
    downloadDir: options.download ?? "",
    outputMode,
    client,
  });
}

function stderrProgress(): (line: string) => void {
  if (process.stderr.isTTY !== true) return () => {};
  return (line) => void process.stderr.write(`${line}\n`);
}

// Mount the agent picker; on selection, run the chosen agent through the
// existing resolved-agent stack. Cancel (Esc/Ctrl+C → undefined) returns
// cleanly so the command exits 0. Loaded lazily, so React/Ink load only on
// this path.
async function browseAndRunAgent(
  initialQuery: string,
  options: RunFlags,
  org: string,
  outputMode: "inline" | "json",
  client: import("../client/index.js").BackendClient,
): Promise<void> {
  const { pickAgent } = await import("../resources/picker/ink.js");
  const selected = await pickAgent({
    client: client.stigmer,
    org,
    initialQuery,
  });
  if (selected === undefined) return;
  if (selected.kind === "built-in-assistant") {
    await runResolvedAgent(undefined, options, org, outputMode, client);
    return;
  }
  await runAgent(selected.agent.id, options, org, outputMode, client);
}

// Off a TTY (pipes, CI, --json), the interactive picker can't run, so 0-arg and
// unresolved references produce actionable guidance instead of a browse UI.
function browseUnavailableError(query: string): UsageError {
  const head =
    query === ""
      ? "Interactive agent browsing requires an interactive terminal"
      : `No agent found for "${query}"`;
  const assistantHint =
    query === "" ? "  stigmer run -m <message>      (the built-in assistant, no agent)\n" : "";
  return new UsageError(
    `${head}\n\n` +
      "Specify a full agent reference:\n" +
      "  stigmer run <org/slug>\n" +
      "  stigmer run <agent-id>\n" +
      assistantHint,
  );
}
