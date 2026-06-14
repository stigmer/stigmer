// `stigmer setup` — configure the LLM provider used for agent execution.
//
// Two paths share one decision core (local/setup/wizard.ts): a non-interactive
// flag path (`--provider`, `--api-key`, …) for scripts and CI, and an
// interactive menu when no provider flag is given. Both write to
// backend.local.llm, preserving every other config field.

import type { Command } from "commander";
import { homedir } from "node:os";
import { type OutputFlags, CommandResult, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface SetupFlags extends OutputFlags {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

const PROVIDERS = ["anthropic", "openai", "ollama", "skip"] as const;

export function registerSetup(program: Command): void {
  const setup = program
    .command("setup")
    .description("configure the LLM provider for agent execution")
    .option("--provider <name>", "provider: anthropic, openai, ollama, or skip (non-interactive)")
    .option("--model <name>", "model name (defaults per provider)")
    .option("--api-key <key>", "API key for a cloud provider")
    .option("--base-url <url>", "custom base URL (e.g. an Ollama endpoint)")
    .action((options: SetupFlags) => runSetup(options));
  addResultFlags(setup);
}

async function runSetup(options: SetupFlags): Promise<void> {
  const { load, save } = await import("../config/config.js");
  const { applyChoice, runInteractiveWizard } = await import("../local/setup/wizard.js");
  const { isRunning } = await import("../local/daemon/launch.js");
  const { CliExitError } = await import("../errors/cli-exit-error.js");
  const { ExitCode } = await import("../errors/exit-codes.js");

  const config = load();

  let updated: typeof config | null;
  if (options.provider !== undefined) {
    const provider = options.provider.toLowerCase();
    if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) {
      throw new CliExitError(`unknown provider: ${options.provider}`, ExitCode.Usage, [
        `Valid providers: ${PROVIDERS.join(", ")}`,
      ]);
    }
    updated = applyChoice(config, provider as (typeof PROVIDERS)[number], {
      model: options.model,
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });
  } else {
    updated = await runInteractiveWizard(config);
    if (updated === null) {
      renderResult(CommandResult.warning("Setup cancelled"), resultFormat(options));
      return;
    }
  }

  save(updated);

  const result = CommandResult.success("LLM configuration saved");
  if (await isRunning(homedir())) {
    result.hint("Restart to apply: stigmer down && stigmer up");
  }
  renderResult(result, resultFormat(options));
}
