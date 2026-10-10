// `stigmer plugin eval <plugin>[@digest]` — run a plugin's own evals/ test
// cases on Stigmer, the way `claude plugin eval` runs them in Claude Code,
// and `stigmer plugin eval cancel <eval-id>` — stop one.
//
// `plugin` is a group for the act of evaluating a plugin, not a noun group
// for the kind: a plugin is still pushed with `push`, installed with
// `install` and read with `get`. The words are Claude Code's own, so a
// plugin author types the same command in both tools. The eval itself is a
// PluginEval read and deleted through the generic verbs (`get plugin-eval`,
// `delete plugin-eval`).
//
// Thin handler: read the options, resolve credentials and the
// organization, delegate to resources/plugin-eval. Heavy modules load
// lazily so `--help` stays fast. The exit code is the format's (0, 1, 2,
// 130), carried out through the one exit point as a silent CliExitError.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import type { PluginEvalFlags } from "../resources/plugin-eval/options.js";
import { globalOrg } from "./shared.js";

function collect(value: string, previous: readonly string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

export function registerPlugin(program: Command): void {
  const plugin = program.command("plugin").description("evaluate a plugin with its own evals/ test cases");

  const evalCommand = plugin
    .command("eval")
    .description("run a plugin's evals/ cases with and without it, on the models you name, and score them")
    .argument(
      "<plugin>",
      "the plugin (name, org/name or id), run at its installed version; <plugin>@<digest> is refused unless that is the installed version",
    )
    .option("--case <glob>", "run only the cases whose name matches this glob")
    .option("--tag <tag>", "run only the cases with this tag (repeatable)", collect)
    .option("--runs <n>", "tries per case, arm and model, 1 to 50 (default: each case's runs, else 3)")
    .option(
      "--model <harness/model>",
      "an engine and model to run on, as native/claude-sonnet-4-6 or cursor/gpt-5 (repeatable, up to 6)",
      collect,
    )
    .option("--ablation <mode>", "with-without also runs each case without the plugin; none runs one arm")
    .option("--threshold <score>", "the score from 0 to 1 a case needs to pass (default 1)")
    .option("--max-cost-usd <usd>", "the most the eval may spend, in estimated US dollars (default 5)")
    .option("-j, --concurrency <n>", "tries running at once, 1 to 8 (default 1)")
    .option("--allow-tools <tools...>", "tools every try may use beyond the read-only set, in Claude Code's names")
    .option("--judge-model <model>", "the model AI-graded checks use (default: the platform's judge model)")
    .option("--real-mcp-servers", "run the plugin's MCP servers for real, with the organization's connections")
    .option("--json [path]", "print the result document, or write it to a path ending in .json; no progress or table")
    .option("--no-wait", "start the eval, print its id, and return")
    .action((target: string, options: PluginEvalFlags, command: Command) => runPluginEvalCommand(target, options, command));

  evalCommand
    .command("cancel <eval-id>")
    .description("cancel a running plugin eval; the tries that finished keep their results")
    .action((id: string) => runCancel(id));
}

async function runPluginEvalCommand(target: string, flags: PluginEvalFlags, command: Command): Promise<void> {
  const [{ parsePluginTarget, readPluginEvalOptions }, { runPluginEval }, { nodePluginEvalIo }, { connectBackend }, { CliExitError }] =
    await Promise.all([
      import("../resources/plugin-eval/options.js"),
      import("../resources/plugin-eval/run.js"),
      import("../resources/plugin-eval/node-io.js"),
      import("../backend.js"),
      import("../errors/index.js"),
    ]);
  const plugin = parsePluginTarget(target);
  const options = readPluginEvalOptions(flags);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  const code = await runPluginEval(client.stigmer, org, plugin, options, nodePluginEvalIo());
  if (code !== 0) {
    throw new CliExitError("", code);
  }
}

async function runCancel(id: string): Promise<void> {
  const [{ cancelPluginEval }, { connectBackend }] = await Promise.all([
    import("../resources/plugin-eval/run.js"),
    import("../backend.js"),
  ]);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  await cancelPluginEval(client.stigmer, id, { stderr: process.stderr });
}
