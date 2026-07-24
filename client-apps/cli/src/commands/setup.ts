// `stigmer setup` — configure the LLM provider used for agent execution.
//
// Two paths share one decision core (local/setup/wizard.ts): a non-interactive
// flag path (`--provider`, `--api-key`, `--model`) for scripts and CI, and an
// interactive API-key prompt when no provider flag is given. Both write to
// backend.local.llm, preserving every other config field. The valid provider
// set is owned by wizard.ts's PROVIDER_CHOICES (Anthropic-only + skip — the
// only story the native runner serves).

import type { Command } from "commander";
import { homedir } from "node:os";
import { type OutputFlags, CommandResult, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface SetupFlags extends OutputFlags {
  provider?: string;
  model?: string;
  apiKey?: string;
}

export function registerSetup(program: Command): void {
  const setup = program
    .command("setup")
    .description("configure the LLM provider for agent execution")
    .option("--provider <name>", "provider: anthropic, or skip to clear (non-interactive)")
    .option("--model <name>", "pin a specific model (defaults to the platform-selected model)")
    .option("--api-key <key>", "Anthropic API key")
    .action((options: SetupFlags) => runSetup(options));
  addResultFlags(setup);
}

async function runSetup(options: SetupFlags): Promise<void> {
  const { load, save } = await import("../config/config.js");
  const { PROVIDER_CHOICES, applyChoice, runInteractiveWizard } = await import("../local/setup/wizard.js");
  const { isRunning } = await import("../local/daemon/launch.js");
  const { CliExitError } = await import("../errors/cli-exit-error.js");
  const { ExitCode } = await import("../errors/exit-codes.js");

  const config = load();

  let updated: typeof config;
  if (options.provider !== undefined) {
    const provider = options.provider.toLowerCase();
    if (!(PROVIDER_CHOICES as readonly string[]).includes(provider)) {
      throw new CliExitError(`unknown provider: ${options.provider}`, ExitCode.Usage, [
        `Valid providers: ${PROVIDER_CHOICES.join(", ")}`,
      ]);
    }
    updated = applyChoice(config, provider as (typeof PROVIDER_CHOICES)[number], {
      model: options.model,
      apiKey: options.apiKey,
    });
  } else {
    updated = await runInteractiveWizard(config);
  }

  save(updated);

  const result = CommandResult.success("LLM configuration saved");
  if (await isRunning(homedir())) {
    result.hint("Restart to apply: stigmer down && stigmer up");
  }
  renderResult(result, resultFormat(options));
}
