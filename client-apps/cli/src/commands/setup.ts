// `stigmer setup` — configure the LLM provider used for agent execution and
// the optional self-hosted operator identity (oss#796).
//
// Two paths share one decision core (local/setup/wizard.ts): a non-interactive
// flag path (`--provider`/`--api-key`, `--operator-email`/`--operator-name`)
// for scripts and CI, and an interactive flow when NO flag is given. Flags
// are independently applicable — operator flags without `--provider` leave
// the LLM section untouched, and vice versa. Writes land under
// backend.local.llm / backend.local.operator, preserving every other config
// field. The valid provider set is owned by wizard.ts's PROVIDER_CHOICES
// (Anthropic-only + skip — the only story the native runner serves).
//
// Setup deliberately has NO model concept: the platform model registry owns
// the execution default, and per-run overrides belong to `stigmer run
// --model`. A setup-level pin used to exist but never reached execution
// (oss#314) — config that looks authoritative but is dead invites exactly the
// bug class Session 29 fixed, so it is structurally gone rather than wired up.

import type { Command } from "commander";
import { homedir } from "node:os";
import { type OutputFlags, CommandResult, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface SetupFlags extends OutputFlags {
  provider?: string;
  apiKey?: string;
  operatorEmail?: string;
  operatorName?: string;
}

export function registerSetup(program: Command): void {
  const setup = program
    .command("setup")
    .description("configure the LLM provider and operator identity for local execution")
    .option("--provider <name>", "provider: anthropic, or skip to clear (non-interactive)")
    .option("--api-key <key>", "Anthropic API key")
    .option("--operator-email <email>", "operator identity for local caller attribution (non-interactive)")
    .option("--operator-name <name>", "operator display name (requires --operator-email)")
    .action((options: SetupFlags) => runSetup(options));
  addResultFlags(setup);
}

async function runSetup(options: SetupFlags): Promise<void> {
  const { load, save } = await import("../config/config.js");
  const { PROVIDER_CHOICES, applyChoice, applyOperatorIdentity, runInteractiveWizard } =
    await import("../local/setup/wizard.js");
  const { isRunning } = await import("../local/daemon/launch.js");
  const { CliExitError } = await import("../errors/cli-exit-error.js");
  const { ExitCode } = await import("../errors/exit-codes.js");

  const config = load();
  const nonInteractive =
    options.provider !== undefined ||
    options.operatorEmail !== undefined ||
    options.operatorName !== undefined;

  let updated: typeof config;
  if (nonInteractive) {
    updated = config;
    if (options.provider !== undefined) {
      const provider = options.provider.toLowerCase();
      if (!(PROVIDER_CHOICES as readonly string[]).includes(provider)) {
        throw new CliExitError(`unknown provider: ${options.provider}`, ExitCode.Usage, [
          `Valid providers: ${PROVIDER_CHOICES.join(", ")}`,
        ]);
      }
      updated = applyChoice(updated, provider as (typeof PROVIDER_CHOICES)[number], {
        apiKey: options.apiKey,
      });
    }
    if (options.operatorEmail !== undefined || options.operatorName !== undefined) {
      try {
        updated = applyOperatorIdentity(
          updated,
          options.operatorEmail ?? "",
          options.operatorName ?? "",
        );
      } catch (error) {
        // Same rule the server enforces at boot, surfaced at setup time.
        throw new CliExitError(
          error instanceof Error ? error.message : String(error),
          ExitCode.Usage,
        );
      }
    }
  } else {
    updated = await runInteractiveWizard(config);
  }

  save(updated);

  const result = CommandResult.success("Configuration saved");
  if (await isRunning(homedir())) {
    result.hint("Restart to apply: stigmer down && stigmer up");
  }
  renderResult(result, resultFormat(options));
}
