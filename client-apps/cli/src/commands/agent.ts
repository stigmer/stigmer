// `stigmer agent quality <agent>` — how the agent's runs were graded, in
// total and per version, with `--flagged` the failed grades behind the
// numbers, or with `--agreement` where people's thumbs and the AI judge's
// rubrics disagree.
//
// `agent` is a group for reading how an agent is measured, not a noun
// group for the kind: an agent is still applied with `apply`, read with
// `get` and run with `run`, and its test cases run with `eval run --agent`.
//
// Thin handler: read the options, resolve credentials and the
// organization, delegate to resources/agent/quality.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import type { AgentQualityFlags } from "../resources/agent/quality.js";
import type { OutputFlags } from "../output/index.js";
import { globalOrg, readFormat } from "./shared.js";

export function registerAgent(program: Command): void {
  const agent = program
    .command("agent")
    .description("read how an agent's runs are graded");

  agent
    .command("quality")
    .description(
      "show how an agent's runs in your organization were graded (run health, the AI judge, people's thumbs), in total and per version",
    )
    .argument("<agent>", "the agent (name, org/name or id)")
    .option("--days <n>", "days to count, ending today (UTC), 1 to 90 (default 30)")
    .option("--flagged", "list the failed grades of the runs you can open, newest first, instead of the totals")
    .option("--limit <n>", "with --flagged, the most failed grades to list (default 20; 0 lists them all)")
    .option(
      "--agreement",
      "show, per AI judge rubric, how its verdicts compare with people's thumbs on the same runs, instead of the totals",
    )
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .action((target: string, options: AgentQualityFlags & OutputFlags, command: Command) =>
      runQuality(target, options, command),
    );
}

async function runQuality(target: string, flags: AgentQualityFlags & OutputFlags, command: Command): Promise<void> {
  const [{ readAgentQualityOptions, showAgentQuality }, { connectBackend }] = await Promise.all([
    import("../resources/agent/quality.js"),
    import("../backend.js"),
  ]);
  const options = readAgentQualityOptions(flags, readFormat(flags));

  const client = connectBackend();
  ensureAuthenticated(client.config);
  // The report is organization-scoped (the agent's runs within one
  // organization), so the organization resolves as `usage agent`'s does:
  // the global --org flag, else the active context.
  const org = resolveOrganization(client.config, globalOrg(command));
  process.stdout.write(await showAgentQuality(client.stigmer, org, target, options));
}
