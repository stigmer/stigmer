// `stigmer up [server]` — start the local Stigmer stack (managed Temporal, the
// control-plane server, and the unified runner) as a supervised background
// daemon. `up server` brings up only the control plane.
//
// Thin handler: parse flags, delegate to the local daemon launcher, render the
// outcome. The launcher (and the heavy resolvers it pulls in) load lazily so
// `--help` stays fast (DD-001).

import type { Command } from "commander";
import { CommandResult, type OutputFlags, renderResult } from "../output/index.js";
import { SERVER_PORT } from "../local/constants.js";
import { addResultFlags, resultFormat } from "./shared.js";

interface UpFlags extends OutputFlags {
  serverOnly?: boolean;
  web?: boolean; // false when --no-web is passed
}

export function registerUp(program: Command): void {
  const up = program
    .command("up")
    .description("start the local Stigmer stack (server, runner, Temporal)")
    .option("--server-only", "start only the control plane (no runners)")
    // Accepted for compatibility with the Go CLI; this CLI does not bundle a
    // local web console, so the stack is headless either way (use the cloud
    // console at app.stigmer.ai for a UI).
    .option("--no-web", "no-op: this CLI does not serve a local web console")
    .action((options: UpFlags) =>
      runUp({ serverOnly: options.serverOnly === true, noWeb: options.web === false }, options),
    );
  addResultFlags(up);

  const server = up
    .command("server")
    .description("start only the control plane (no runners)")
    .option("--no-web", "no-op: this CLI does not serve a local web console")
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
  result.hint("Check status with: stigmer status").hint("Stop it with:    stigmer down");
  renderResult(result, resultFormat(flags));
}
