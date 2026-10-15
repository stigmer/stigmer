// `stigmer eval run` — run test cases on an agent, or a plugin's own cases
// on the built-in assistant, optionally with and without a plugin, and
// score them; and `stigmer eval cancel <eval-run-id>` — stop one.
//
// `eval` is a group for the act of evaluating, not a noun group for the
// kind: the eval run itself is read and deleted through the generic verbs
// (`get eval-run`, `delete eval-run`). `--agent` names an agent, `--plugin`
// alone a plugin evaluated on the built-in assistant, the way `claude
// plugin eval` evaluates one in Claude Code, and `--plugin` beside
// `--agent` the plugin each case runs with and without on that agent;
// `--eval` beside `--agent` runs the cases of an Eval, a folder of cases
// pushed with `stigmer push eval` (resources/eval-run/options.ts holds
// every flag's rules).
//
// Thin handler: read the options, resolve credentials and the
// organization, delegate to resources/eval-run. Heavy modules load lazily
// so `--help` stays fast. The exit code is the format's (0, 1, 2, 130),
// carried out through the one exit point as a silent CliExitError; a
// connection or sign-in failure keeps the CLI's own 3 or 4. The help lists
// them all. `--tag` and `--allow-tools` take a list, as Claude Code's do,
// so another flag written after them ends the list.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import type { EvalRunFlags } from "../resources/eval-run/options.js";
import { globalOrg } from "./shared.js";

/** `eval run`'s help after the options: the model and tools a try runs with, and the exit codes. */
const EVAL_HELP = `
Examples:
  stigmer eval run --plugin refund-policy
      the plugin's own cases on the built-in assistant, with and without it
  stigmer eval run --agent support-agent
      the cases of every plugin the agent attaches, on the agent
  stigmer eval run --agent support-agent --eval support-agent-evals
      the cases of an Eval pushed with stigmer push eval, on the agent
  stigmer eval run --agent support-agent --plugin refund-policy
      the plugin's cases on the agent, with and without the plugin

On an agent, without --model, each case runs on the agent as it runs: its
own engine, model and settings. A model named with --model runs without the
agent's own tier and thinking settings, as any conversation that names a
model does. A try gets only the tools its case and --allow-tools grant,
within the agent's own: name the agent's working tools there, as in
--allow-tools Skill Agent for its skills and its subagents.

Exit codes:
  0    every case that ran reached the threshold and every case loaded
  1    a case scored below the threshold, a case did not load, no case ran, an
       option was not valid, the eval run could not start, or it was lost and cancelled
  2    partial: the spending limit was reached
  3    the server could not be reached
  4    not signed in, or the sign-in expired
  130  interrupted: the eval run was cancelled, by Ctrl+C or any other cancel`;

function collect(value: string, previous: readonly string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

export function registerEval(program: Command): void {
  const evalGroup = program
    .command("eval")
    .description("run test cases on an agent or a plugin, with and without a plugin, and score them");

  evalGroup
    .command("run")
    .description("run test cases on an agent, or a plugin's own cases on the built-in assistant, and score them")
    .option(
      "--agent <agent>",
      "the agent to run cases on (name, org/name or id), at its current version; <agent>@<version> runs a version hash or tag",
    )
    .option(
      "--plugin <plugin>",
      "alone: the plugin whose own cases run on the built-in assistant, with and without it (<plugin>@<digest> must be its installed version); with --agent: the plugin each case runs with and without",
    )
    .option(
      "--cases-from <plugin>",
      "with --agent, run this plugin's cases: one the agent attaches or the one --plugin names (repeatable; default: --plugin's, else every attached plugin's)",
      collect,
    )
    .option(
      "--eval <eval>",
      "with --agent, run this Eval's cases on the agent: <eval>[@<digest|tag>], its current version without a suffix (repeatable, one version of each Eval)",
      collect,
    )
    .option("--case <glob>", "run only the cases whose name matches this glob")
    .option("--tag <tag...>", "run only the cases with any of these tags (repeatable)")
    .option("--runs <n>", "tries per case, arm and model, 1 to 50 (default: each case's runs, else 3)")
    .option(
      "--model <harness/model>",
      "an engine and model to run on, as native/claude-sonnet-4-6 or cursor/gpt-5 (repeatable, up to 6)",
      collect,
    )
    .option("--ablation <mode>", "with --plugin: with-without also runs each case without the plugin; none runs one arm")
    .option("--threshold <score>", "the score from 0 to 1 a case needs to pass (default 1)")
    .option("--max-cost-usd <usd>", "the most the eval run may spend, in estimated US dollars (default 5)")
    .option("-j, --concurrency <n>", "tries running at once, 1 to 8 (default 1)")
    .option(
      "--allow-tools <tools...>",
      "tools every try may use beyond its case's own, in Claude Code's names (on an agent, name its working tools, as Skill and Agent)",
    )
    .option("--judge-model <model>", "the model AI-graded checks use (default: the platform's judge model)")
    .option("--mocks <mode>", "record answers MCP calls from the suites' mocks (the default); off runs every server for real")
    .option("--real-mcp-servers", "the same as --mocks off")
    .option("--allow-real-servers", "also start the plugins' real MCP servers that no mock answers")
    .option("--no-scaffold", "skip each case's scaffold script, listing such a case as not run")
    .option("--scaffold", "accepted for Claude Code's command lines; a scaffold always runs, in the try's own sandbox")
    .option("--json [path]", "print the result document, or write it to a path ending in .json; no progress or table")
    .option("--no-wait", "start the eval run, print its id, and return")
    .addHelpText("after", EVAL_HELP)
    .action((options: EvalRunFlags, command: Command) => runEvalRunCommand(options, command));

  evalGroup
    .command("cancel <eval-run-id>")
    .description("cancel a running eval run; the tries that finished keep their results")
    .action((id: string) => runCancel(id));
}

async function runEvalRunCommand(flags: EvalRunFlags, command: Command): Promise<void> {
  const [{ readEvalRunOptions }, { runEvalRun }, { nodeEvalIo }, { connectBackend }, { CliExitError }] =
    await Promise.all([
      import("../resources/eval-run/options.js"),
      import("../resources/eval-run/run.js"),
      import("../resources/eval-run/node-io.js"),
      import("../backend.js"),
      import("../errors/index.js"),
    ]);
  const options = readEvalRunOptions(flags);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const code = await runEvalRun(client.stigmer, org, options, nodeEvalIo());
  if (code !== 0) {
    throw new CliExitError("", code);
  }
}

async function runCancel(id: string): Promise<void> {
  const [{ cancelEvalRun }, { connectBackend }] = await Promise.all([
    import("../resources/eval-run/run.js"),
    import("../backend.js"),
  ]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  await cancelEvalRun(client.stigmer, id, { stderr: process.stderr });
}
