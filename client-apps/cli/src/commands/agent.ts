// `stigmer agent eval <agent>[@version]` — run the eval cases of the
// plugins an agent attaches, on the agent itself, and score them; and
// `stigmer agent eval cancel <eval-id>` — stop one; and `stigmer agent
// quality <agent>` — how the agent's runs were graded, in total and per
// version, or with `--flagged` the failed grades behind the numbers.
//
// `agent` is a group for the act of evaluating an agent, as `plugin` is for
// evaluating a plugin, not a noun group for the kind: an agent is still
// applied with `apply`, read with `get` and run with `run`. The eval itself
// is an AgentEval read and deleted through the generic verbs (`get
// agent-eval`, `delete agent-eval`). Reading how an agent is measured
// belongs with evaluating it, so `quality` is in the group too.
//
// Each plugin's cases run at the version the agent attaches, one arm (the
// agent as it is; no run without its plugins to compare against), k tries
// per case, per target. The eval is stamped with the agent version, so two
// versions' results compare. The flags are `plugin eval`'s but
// `--ablation`, plus `--plugin` to choose plugins.
//
// Thin handler: read the options, resolve credentials and the
// organization, delegate to resources/agent-eval. Heavy modules load
// lazily so `--help` stays fast. The exit codes are `plugin eval`'s,
// carried out through the one exit point as a silent CliExitError; a
// connection or sign-in failure keeps the CLI's own 3 or 4. The help lists
// them all. `--tag`, `--allow-tools` take a list, so the agent goes first.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import type { AgentEvalFlags } from "../resources/agent-eval/options.js";
import type { AgentQualityFlags } from "../resources/agent/quality.js";
import type { OutputFlags } from "../output/index.js";
import { globalOrg, readFormat } from "./shared.js";

/** `agent eval`'s help after the options: the model and tools a try runs with, and the exit codes (`plugin eval`'s, and the CLI's 3 and 4). */
const EVAL_HELP = `
Without --model, each case runs on the agent as it runs: its own engine,
model and settings. A model named with --model runs without the agent's own
tier and thinking settings, as any conversation that names a model does.
A try gets only the tools its case and --allow-tools grant, within the
agent's own: name the agent's working tools there, as in
--allow-tools Skill Agent for its skills and its subagents.

Exit codes:
  0    every case that ran reached the threshold
  1    a case scored below the threshold, no case ran, an option was not
       valid, the eval could not start, or it was lost and cancelled
  2    partial: the spending limit was reached or the organization ran out of credit
  3    the server could not be reached
  4    not signed in, or the sign-in expired
  130  interrupted: the eval was cancelled, by Ctrl+C or any other cancel`;

function collect(value: string, previous: readonly string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

export function registerAgent(program: Command): void {
  const agent = program
    .command("agent")
    .description("evaluate an agent with its plugins' evals/ test cases, and read how its runs are graded");

  const evalCommand = agent
    .command("eval")
    .description("run the evals/ cases of the plugins an agent attaches, on the agent, and score them")
    .argument(
      "<agent>",
      "the agent (name, org/name or id), at its current version; <agent>@<version> runs a version hash or tag",
    )
    .option(
      "--plugin <slug>",
      "run only this plugin's cases; the agent must attach it (repeatable; default: every plugin it attaches)",
      collect,
    )
    .option("--case <glob>", "run only the cases whose name matches this glob")
    .option("--tag <tag...>", "run only the cases with any of these tags (repeatable)")
    .option("--runs <n>", "tries per case and model, 1 to 50 (default: each case's runs, else 3)")
    .option(
      "--model <harness/model>",
      "run on this engine and model in place of the agent's own, as native/claude-sonnet-4-6 or cursor/gpt-5 (repeatable, up to 6)",
      collect,
    )
    .option("--threshold <score>", "the score from 0 to 1 a case needs to pass (default 1)")
    .option("--max-cost-usd <usd>", "the most the eval may spend, in estimated US dollars (default 5)")
    .option("-j, --concurrency <n>", "tries running at once, 1 to 8 (default 1)")
    .option(
      "--allow-tools <tools...>",
      "tools every try may use beyond its case's own, in Claude Code's names (name the agent's working tools, as Skill and Agent)",
    )
    .option("--judge-model <model>", "the model AI-graded checks use (default: the platform's judge model)")
    .option("--mocks <mode>", "record answers MCP calls from the suites' mocks (the default); off runs every server for real")
    .option("--real-mcp-servers", "the same as --mocks off")
    .option("--allow-real-servers", "also start the plugins' real MCP servers that no mock answers")
    .option("--no-scaffold", "skip each case's scaffold script, listing such a case as not run")
    .option("--scaffold", "accepted for Claude Code's command lines; a scaffold always runs, in the try's own sandbox")
    .option("--json [path]", "print the result document, or write it to a path ending in .json; no progress or table")
    .option("--no-wait", "start the eval, print its id, and return")
    .addHelpText("after", EVAL_HELP)
    .action((target: string, options: AgentEvalFlags, command: Command) => runAgentEvalCommand(target, options, command));

  evalCommand
    .command("cancel <eval-id>")
    .description("cancel a running agent eval; the tries that finished keep their results")
    .action((id: string) => runCancel(id));

  agent
    .command("quality")
    .description(
      "show how an agent's runs in your organization were graded (run health, the AI judge, people's thumbs), in total and per version",
    )
    .argument("<agent>", "the agent (name, org/name or id)")
    .option("--days <n>", "days to count, ending today (UTC), 1 to 90 (default 30)")
    .option("--flagged", "list the failed grades of the runs you can open, newest first, instead of the totals")
    .option("--limit <n>", "with --flagged, the most failed grades to list (default 20; 0 lists them all)")
    .option("-o, --output <format>", "output format: table, json, or yaml")
    .action((target: string, options: AgentQualityFlags & OutputFlags, command: Command) =>
      runQuality(target, options, command),
    );
}

async function runAgentEvalCommand(target: string, flags: AgentEvalFlags, command: Command): Promise<void> {
  const [{ parseAgentTarget, readAgentEvalOptions }, { runAgentEval }, { nodePluginEvalIo }, { connectBackend }, { CliExitError }] =
    await Promise.all([
      import("../resources/agent-eval/options.js"),
      import("../resources/agent-eval/run.js"),
      import("../resources/plugin-eval/node-io.js"),
      import("../backend.js"),
      import("../errors/index.js"),
    ]);
  const agent = parseAgentTarget(target);
  const options = readAgentEvalOptions(flags);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const code = await runAgentEval(client.stigmer, org, agent, options, nodePluginEvalIo());
  if (code !== 0) {
    throw new CliExitError("", code);
  }
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

async function runCancel(id: string): Promise<void> {
  const [{ cancelAgentEval }, { connectBackend }] = await Promise.all([
    import("../resources/agent-eval/run.js"),
    import("../backend.js"),
  ]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  await cancelAgentEval(client.stigmer, id, { stderr: process.stderr });
}
