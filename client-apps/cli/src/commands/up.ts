// `stigmer up [server]` — start the local Stigmer stack (managed Temporal, the
// control-plane server, and the unified runner) as a supervised background
// daemon, or with `--foreground` as this very process. `up server` brings up
// only the control plane.
//
// Thin handler: parse flags, delegate to the local daemon launcher, render the
// outcome. The launcher (and the heavy resolvers it pulls in) load lazily so
// `--help` stays fast (DD-001).

import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { CliExitError } from "../errors/cli-exit-error.js";
import { ExitCode } from "../errors/exit-codes.js";
import { CommandResult, type OutputFlags, renderResult } from "../output/index.js";
import { HEALTH_STATE_FILE, SERVER_PORT } from "../local/constants.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface UpFlags extends OutputFlags {
  serverOnly?: boolean;
  web?: boolean; // false when --no-web is passed
  foreground?: boolean;
}

interface UpRun {
  serverOnly: boolean;
  noWeb: boolean;
  foreground: boolean;
}

// The server serves the web console from its unified port (DD-012); the
// flag suppresses probing/reporting it, not the serving itself (one
// process, one origin — there is no separate console to not-start).
const NO_WEB_HELP = "don't report the web console URL";

// Foreground is the shape a supervisor wants — a container entrypoint, a
// systemd unit, a tmux pane: one process to watch, signals delivered to it,
// the stack's output on its stdio — instead of a detached daemon to poll.
const FOREGROUND_HELP = "run the stack in this process until Ctrl-C or SIGTERM (for containers and service managers)";

export function registerUp(program: Command): void {
  const up = program
    .command("up")
    .description("start the local Stigmer stack (server, runner, Temporal)")
    .option("--server-only", "start only the control plane (no runners)")
    .option("--no-web", NO_WEB_HELP)
    .option("--foreground", FOREGROUND_HELP)
    .action((options: UpFlags) =>
      runUp(
        { serverOnly: options.serverOnly === true, noWeb: options.web === false, foreground: options.foreground === true },
        options,
      ),
    );
  addResultFlags(up);

  const server = up
    .command("server")
    .description("start only the control plane (no runners)")
    .option("--no-web", NO_WEB_HELP)
    .option("--foreground", FOREGROUND_HELP)
    .action((options: UpFlags) =>
      runUp({ serverOnly: true, noWeb: options.web === false, foreground: options.foreground === true }, options),
    );
  addResultFlags(server);
}

async function runUp(run: UpRun, flags: OutputFlags): Promise<void> {
  process.stderr.write("Starting Stigmer local stack… (first run may take a moment)\n");
  const launch = await import("../local/daemon/launch.js");

  if (!run.foreground) {
    await launch.up(run);
    await renderUpCard(run, flags);
    return;
  }

  // The card renders when the stack is serving and bootstrapped — the moment the
  // detached shape would have returned — and the process then stays up,
  // mirroring the server's and runner's output, until a shutdown signal.
  const code = await launch.upForeground(run, homedir(), {
    onReady: () => renderUpCard(run, flags),
  });
  if (code !== 0) {
    // The daemon body has already logged which component failed and why.
    const { logDir } = await import("../local/paths.js");
    throw new CliExitError("the local stack did not start", ExitCode.General, [
      `Check the component logs under ${logDir(homedir())}.`,
    ]);
  }
}

async function renderUpCard(run: UpRun, flags: OutputFlags): Promise<void> {
  const result = CommandResult.success(run.serverOnly ? "Stigmer control plane is up" : "Stigmer local stack is up");
  const section = result.addSection("Endpoints");
  section.field("server", `http://localhost:${SERVER_PORT}`);
  if (await consoleReported()) {
    // Same origin as the API: the server serves the console (DD-012). Only
    // printed when the daemon's probe found a bundled export — a dev-tree
    // server without one must not advertise a dead URL.
    section.field("console", `http://localhost:${SERVER_PORT}`);
  }
  result.hint("Check status with: stigmer status");
  result.hint(run.foreground ? "Stop it with:    Ctrl-C (or stigmer down from another shell)" : "Stop it with:    stigmer down");
  renderResult(result, resultFormat(flags));
}

/** Whether the daemon recorded the web console as running (its own probe). */
async function consoleReported(): Promise<boolean> {
  const { dataDir } = await import("../local/paths.js");
  const { loadHealthState } = await import("../local/state/health-state.js");
  const health = loadHealthState(join(dataDir(homedir()), HEALTH_STATE_FILE));
  return health?.components["web-console"]?.state === "running";
}
