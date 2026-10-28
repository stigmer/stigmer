// `stigmer up [server]` — start the local Stigmer stack (managed Temporal, the
// control-plane server, and the unified runner) as a supervised background
// daemon, or with `--foreground` as this very process. `up server` brings up
// only the control plane.
//
// Thin handler: parse flags, delegate to the local daemon launcher, render the
// outcome. The launcher (and the heavy resolvers it pulls in) load lazily so
// `--help` stays fast.
//
// The card says where the console is and whether agents can run, the two
// things a person needs next: the console line comes from probing the server
// once it answers (stigmer#2649), and the agents line from the providers the
// started runner reaches, the same answer the server was handed (stigmer#1084).

import { homedir } from "node:os";
import type { Command } from "commander";
import { CliExitError } from "../errors/cli-exit-error.js";
import { ExitCode } from "../errors/exit-codes.js";
import { CommandResult, type OutputFlags, renderResult } from "../output/index.js";
import { SERVER_PORT } from "../local/constants.js";
import type { UpReport } from "../local/daemon/launch.js";
import { describeReach } from "../local/provider-reach.js";
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

// The server serves the web console from its unified port; the
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
    const report = await launch.up(run);
    await renderUpCard(run, flags, report);
    return;
  }

  // The card renders when the stack is serving — the moment the
  // detached shape would have returned — and the process then stays up,
  // mirroring the server's and runner's output, until a shutdown signal.
  const code = await launch.upForeground(run, homedir(), {
    onReady: (report) => renderUpCard(run, flags, report),
  });
  if (code !== 0) {
    // The daemon body has already logged which component failed and why.
    const { logDir } = await import("../local/paths.js");
    throw new CliExitError("the local stack did not start", ExitCode.General, [
      `Check the component logs under ${logDir(homedir())}.`,
    ]);
  }
}

async function renderUpCard(run: UpRun, flags: OutputFlags, report: UpReport): Promise<void> {
  const result = CommandResult.success(run.serverOnly ? "Stigmer control plane is up" : "Stigmer local stack is up");
  const section = result.addSection("Endpoints");
  section.field("server", `http://localhost:${SERVER_PORT}`);
  if (!run.noWeb && (await consoleServed())) {
    // Same origin as the API: the server serves the console. Only
    // printed when the server answers the console probe — a dev-tree
    // server without a bundled export must not advertise a dead URL.
    section.field("console", `http://localhost:${SERVER_PORT}`);
  }
  addAgentsSection(result, report);
  result.hint("Check status with: stigmer status");
  result.hint(run.foreground ? "Stop it with:    Ctrl-C (or stigmer down from another shell)" : "Stop it with:    stigmer down");
  renderResult(result, resultFormat(flags));
}

/**
 * Whether the server serves the web console. The card renders once the
 * server's port answers, and the server binds its port only after every lane
 * is mounted, so the probe here reads what a browser would find. The daemon's
 * own record of the same probe lands seconds later (after its settle delay),
 * too late for a card that read it to see it (stigmer#2649).
 */
async function consoleServed(): Promise<boolean> {
  const { isWebConsoleAvailable } = await import("../local/webconsole/index.js");
  return isWebConsoleAvailable();
}

/** Whether agents can run on this stack, and through which providers. */
function addAgentsSection(result: CommandResult, report: UpReport): void {
  const section = result.addSection("Agents");
  if (report.runnerReach === undefined) {
    section.field("not ready", "no local runner (control plane only)");
    return;
  }
  if (report.runnerReach.length === 0) {
    section.field("not ready", "no model provider");
    // The daemon hands its runner the key only at start, so a key saved
    // while the stack runs needs a restart to reach it.
    result.hint("Add a model provider: stigmer setup, then stigmer down && stigmer up");
    return;
  }
  section.field("ready", describeReach(report.runnerReach));
}
