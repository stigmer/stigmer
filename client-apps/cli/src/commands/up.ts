// `stigmer up [server]` — start the local Stigmer stack (managed Temporal, the
// control-plane server, and the unified runner) as a supervised background
// daemon. `up server` brings up only the control plane.
//
// Thin handler: parse flags, delegate to the local daemon launcher, render the
// outcome. The launcher (and the heavy resolvers it pulls in) load lazily so
// `--help` stays fast (DD-001).

import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { CommandResult, type OutputFlags, renderResult } from "../output/index.js";
import { HEALTH_STATE_FILE, SERVER_PORT } from "../local/constants.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface UpFlags extends OutputFlags {
  serverOnly?: boolean;
  web?: boolean; // false when --no-web is passed
}

// The server serves the web console from its unified port (DD-012); the
// flag suppresses probing/reporting it, not the serving itself (one
// process, one origin — there is no separate console to not-start).
const NO_WEB_HELP = "don't report the web console URL";

export function registerUp(program: Command): void {
  const up = program
    .command("up")
    .description("start the local Stigmer stack (server, runner, Temporal)")
    .option("--server-only", "start only the control plane (no runners)")
    .option("--no-web", NO_WEB_HELP)
    .action((options: UpFlags) =>
      runUp({ serverOnly: options.serverOnly === true, noWeb: options.web === false }, options),
    );
  addResultFlags(up);

  const server = up
    .command("server")
    .description("start only the control plane (no runners)")
    .option("--no-web", NO_WEB_HELP)
    .action((options: UpFlags) => runUp({ serverOnly: true, noWeb: options.web === false }, options));
  addResultFlags(server);
}

async function runUp(opts: { serverOnly: boolean; noWeb: boolean }, flags: OutputFlags): Promise<void> {
  process.stderr.write("Starting Stigmer local stack… (first run may take a moment)\n");
  const { up } = await import("../local/daemon/launch.js");
  await up(opts);

  const result = CommandResult.success(opts.serverOnly ? "Stigmer control plane is up" : "Stigmer local stack is up");
  const section = result.addSection("Endpoints");
  section.field("server", `http://localhost:${SERVER_PORT}`);
  if (await consoleReported()) {
    // Same origin as the API: the server serves the console (DD-012). Only
    // printed when the daemon's probe found a bundled export — a dev-tree
    // server without one must not advertise a dead URL.
    section.field("console", `http://localhost:${SERVER_PORT}`);
  }
  result.hint("Check status with: stigmer status").hint("Stop it with:    stigmer down");
  renderResult(result, resultFormat(flags));
}

/** Whether the daemon recorded the web console as running (its own probe). */
async function consoleReported(): Promise<boolean> {
  const { dataDir } = await import("../local/paths.js");
  const { loadHealthState } = await import("../local/state/health-state.js");
  const health = loadHealthState(join(dataDir(homedir()), HEALTH_STATE_FILE));
  return health?.components["web-console"]?.state === "running";
}
