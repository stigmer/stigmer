// `stigmer reset` — stop the stack and wipe all persistent local state, then
// (unless config was removed) restart fresh. Destructive, so it confirms first
// unless `--force` is given. Configuration is preserved unless --include-config.

import type { Command } from "commander";
import { homedir } from "node:os";
import { CommandResult, type OutputFlags, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface ResetFlags extends OutputFlags {
  force?: boolean;
  includeConfig?: boolean;
}

export function registerReset(program: Command): void {
  const reset = program
    .command("reset")
    .description("stop the stack and remove all local state, then restart fresh")
    .option("--force", "skip the confirmation prompt")
    .option("--include-config", "also remove configuration (API keys, preferences)")
    .action((options: ResetFlags) => runReset(options));
  addResultFlags(reset);
}

async function runReset(options: ResetFlags): Promise<void> {
  const { reset } = await import("../local/reset.js");
  const { up } = await import("../local/daemon/launch.js");
  const { confirm } = await import("../local/setup/prompt.js");
  const { configDir } = await import("../local/paths.js");

  if (options.force !== true) {
    const scope = options.includeConfig === true ? " INCLUDING configuration (config.yaml)" : " (configuration preserved)";
    const ok = await confirm(`This will remove all runtime data in ${configDir(homedir())}${scope}.\nContinue?`);
    if (!ok) {
      renderResult(CommandResult.warning("Reset cancelled"), resultFormat(options));
      return;
    }
  }

  const outcome = await reset({ includeConfig: options.includeConfig === true });

  const result = CommandResult.success("Reset complete");
  const removed = result.addSection("Removed");
  if (outcome.servicesStopped) removed.item("services stopped");
  for (const path of outcome.removedPaths) removed.item(path);

  if (options.includeConfig === true) {
    result.hint("Run 'stigmer up' to reconfigure and start fresh");
    renderResult(result, resultFormat(options));
    return;
  }

  renderResult(result, resultFormat(options));

  process.stderr.write("\nRestarting Stigmer local stack…\n");
  await up({}, homedir());
}
