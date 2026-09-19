// `stigmer bootstrap` — make the configured backend a ready Stigmer: the
// system organization exists and the official marketplace's default plugins
// are installed into it, public. `stigmer up` does this for the local stack
// on its own; this verb is for every other shape (a raw self-hosted server
// behind docker-compose or Helm, the hosted platform's scheduled lane), and
// runs the very same two phases (local/bootstrap.ts), so "ready" has one
// meaning everywhere.
//
// Flagless on purpose. The org is the system org in every edition, and the
// defaults are idempotent by the server's digest, so there is nothing to
// force: a second run over a converged backend changes nothing and says so.
// The verb never deletes anything; a scheduled lane must be able to run it
// without that power.
//
// Exit is non-zero when any default failed to land, after the outcomes are
// rendered, so a lane's run is red for the right reason and a human reads
// what did and did not install. Heavy modules load lazily inside the action
// so `--help` stays fast.

import type { Command } from "commander";
import { ensureAuthenticated } from "../config/index.js";
import { CliExitError } from "../errors/cli-exit-error.js";
import { ExitCode } from "../errors/exit-codes.js";
import { CommandResult, type OutputFlags, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

export function registerBootstrap(program: Command): void {
  const bootstrap = program
    .command("bootstrap")
    .description(
      "make the configured backend ready: ensure the system organization and install the default plugins",
    )
    .action((options: OutputFlags) => runBootstrapCommand(options));
  addResultFlags(bootstrap);
}

async function runBootstrapCommand(flags: OutputFlags): Promise<void> {
  const [{ connectBackend }, { bootstrapBackend }, { SYSTEM_ORG }] =
    await Promise.all([
      import("../backend.js"),
      import("../local/bootstrap.js"),
      import("../local/system-org.js"),
    ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const say = (line: string): void => {
    process.stderr.write(`${line}\n`);
  };
  const result = await bootstrapBackend(client.stigmer, say);

  const failed = result.plugins.failed;
  const out =
    failed.length === 0
      ? CommandResult.success("Backend is ready")
      : CommandResult.warning(
          `Backend bootstrapped with ${failed.length} default plugin${failed.length === 1 ? "" : "s"} not installed`,
        );
  out
    .addSection("System organization")
    .field("Slug", SYSTEM_ORG)
    .field("State", result.org);
  const plugins = out.addSection("Default plugins");
  for (const outcome of result.plugins.outcomes) {
    switch (outcome.action) {
      case "installed":
      case "up-to-date":
        plugins.field(outcome.name, outcome.action);
        break;
      case "failed":
        plugins.field(outcome.name, `failed: ${outcome.error}`);
        break;
      default: {
        const exhaustive: never = outcome;
        throw new Error(`unhandled outcome ${String(exhaustive)}`);
      }
    }
  }
  if (failed.length > 0) {
    out.hint("Fix the cause named above and run 'stigmer bootstrap' again.");
  }
  renderResult(out, resultFormat(flags));

  if (failed.length > 0) {
    throw new CliExitError(
      `default plugin${failed.length === 1 ? "" : "s"} not installed: ${failed.join(", ")}`,
      ExitCode.General,
    );
  }
}
