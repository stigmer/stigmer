// `stigmer down [server]` — stop the local Stigmer stack. The daemon traps the
// signal and tears down its children and managed Temporal in order; this command
// signals it, waits, and falls back to cleanup if it is already gone.
//
// `down server` is accepted as a symmetric alias of `down` (the daemon owns the
// whole stack, so stopping it stops everything either way).

import type { Command } from "commander";
import { CommandResult, type OutputFlags, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

export function registerDown(program: Command): void {
  const down = program.command("down").description("stop the local Stigmer stack").action((options: OutputFlags) => runDown(options));
  addResultFlags(down);

  const server = down.command("server").description("stop the local Stigmer stack").action((options: OutputFlags) => runDown(options));
  addResultFlags(server);
}

async function runDown(flags: OutputFlags): Promise<void> {
  const { down } = await import("../local/daemon/launch.js");
  const wasRunning = await down();
  const result = wasRunning
    ? CommandResult.success("Stigmer local stack stopped")
    : CommandResult.warning("Stigmer local stack was not running");
  renderResult(result, resultFormat(flags));
}
