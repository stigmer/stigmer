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
// (Anthropic + skip: the key setup saves; the runner reaches other providers
// by keys exported in the shell, local/provider-reach.ts).
//
// `--api-key-stdin` reads the key from stdin instead of the command line,
// where a shell's history and a coding agent's transcript would keep it
// (`printenv ANTHROPIC_API_KEY | stigmer setup --provider anthropic
// --api-key-stdin`); it implies `--provider anthropic` and refuses a terminal,
// where the interactive `stigmer setup` asks at a hidden prompt instead.
//
// A key given to setup is checked with Anthropic before it is saved, on both
// paths (local/model-key-step.ts): the flag path refuses a key Anthropic
// rejects with exit code 1 and saves nothing, and saves a key Anthropic did not
// answer for with a line saying so; the interactive path asks again.
//
// Setup deliberately has NO model concept: the platform model registry owns
// the execution default, and per-run overrides belong to `stigmer run
// --model`. A setup-level pin would look authoritative and reach no
// execution (oss#314), so setup has none.

import type { Command } from "commander";
import { homedir } from "node:os";
import { type OutputFlags, CommandResult, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

export interface SetupFlags extends OutputFlags {
  provider?: string;
  apiKey?: string;
  apiKeyStdin?: boolean;
  operatorEmail?: string;
  operatorName?: string;
}

export function registerSetup(program: Command): void {
  const setup = program
    .command("setup")
    .description("configure the LLM provider and operator identity for local execution")
    .option("--provider <name>", "provider: anthropic, or skip to clear (non-interactive)")
    .option("--api-key <key>", "Anthropic API key")
    .option("--api-key-stdin", "read the Anthropic API key from stdin (keeps it out of history and transcripts)")
    .option("--operator-email <email>", "operator identity for local caller attribution (non-interactive)")
    .option("--operator-name <name>", "operator display name (requires --operator-email)")
    .action((options: SetupFlags) => runSetup(options));
  addResultFlags(setup);
}

async function runSetup(flags: SetupFlags): Promise<void> {
  const options = await withStdinKey(flags);
  const { load, save } = await import("../config/config.js");
  const { PROVIDER_CHOICES, applyChoice, applyOperatorIdentity, runInteractiveWizard } =
    await import("../local/setup/wizard.js");
  const { isRunning } = await import("../local/daemon/launch.js");
  const { CliExitError } = await import("../errors/cli-exit-error.js");
  const { ExitCode } = await import("@stigmer/client/exit-codes");

  const config = load();
  const nonInteractive =
    options.provider !== undefined ||
    options.operatorEmail !== undefined ||
    options.operatorName !== undefined;

  let updated: typeof config;
  let unchecked = false;
  if (nonInteractive) {
    updated = config;
    if (options.provider !== undefined) {
      const provider = options.provider.toLowerCase();
      if (!(PROVIDER_CHOICES as readonly string[]).includes(provider)) {
        throw new CliExitError(`unknown provider: ${options.provider}`, ExitCode.Usage, [
          `Valid providers: ${PROVIDER_CHOICES.join(", ")}`,
        ]);
      }
      if (provider === "anthropic" && (options.apiKey ?? "").trim() !== "") {
        unchecked = await refuseRejectedKey(options.apiKey!.trim());
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
  if (unchecked) {
    const { KEY_UNCHECKED } = await import("../local/model-key-step.js");
    result.hint(KEY_UNCHECKED);
  }
  if (await isRunning(homedir())) {
    result.hint("Restart to apply: stigmer down && stigmer up");
  }
  renderResult(result, resultFormat(options));
}

/**
 * The flags with `--api-key-stdin` read into `apiKey`: refused beside
 * `--api-key`, on a terminal, and when stdin is empty; the provider is
 * Anthropic unless the flags said it.
 */
export async function withStdinKey(
  flags: SetupFlags,
  io: { readonly stdinIsTty: boolean; readonly readStdin: () => Promise<string> } = {
    stdinIsTty: process.stdin.isTTY === true,
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks).toString("utf8");
    },
  },
): Promise<SetupFlags> {
  if (flags.apiKeyStdin !== true) return flags;
  const { UsageError } = await import("../errors/usage-error.js");
  if (flags.apiKey !== undefined) {
    throw new UsageError("--api-key and --api-key-stdin both give the key\n\nUse one.");
  }
  if (io.stdinIsTty) {
    throw new UsageError(
      "--api-key-stdin reads a key piped in, and stdin is a terminal\n\n" +
        "Pipe it:  printenv ANTHROPIC_API_KEY | stigmer setup --api-key-stdin\nor type it at a hidden prompt:  stigmer setup",
    );
  }
  const key = (await io.readStdin()).trim();
  if (key === "") throw new UsageError("--api-key-stdin read nothing from stdin");
  return { ...flags, provider: flags.provider ?? "anthropic", apiKey: key };
}

/**
 * Check a key given by flag with Anthropic, where the runner would send it:
 * a refused key ends the command with exit code 1 before anything is saved.
 * Returns whether Anthropic did not answer (the key is saved, and the card
 * says so).
 */
async function refuseRejectedKey(key: string): Promise<boolean> {
  const { ANTHROPIC_KEYS_URL, anthropicKeyTarget, KEY_REJECTED } = await import("../local/model-key-step.js");
  const { checkAnthropicKey } = await import("../local/key-check.js");
  const { CliExitError } = await import("../errors/cli-exit-error.js");
  const { ExitCode } = await import("@stigmer/client/exit-codes");
  const target = anthropicKeyTarget({ ...process.env, ANTHROPIC_API_KEY: key });
  if (target === null) return false;
  const check = await checkAnthropicKey(key, target.baseUrl);
  if (check === "rejected") {
    throw new CliExitError(`${KEY_REJECTED}.`, ExitCode.General, [`Nothing was saved. Get a key at ${ANTHROPIC_KEYS_URL}`]);
  }
  return check === "unchecked";
}
