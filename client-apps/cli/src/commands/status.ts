// `stigmer status` — show the local stack's health (daemon, Temporal, server,
// runner, web console) plus the effective LLM configuration.
//
// Thin handler: build the structured result in the local subsystem and render
// it. The local module loads lazily so `--help` stays fast (DD-001).

import type { Command } from "commander";
import { type OutputFlags, renderResult } from "../output/index.js";
import { addResultFlags, resultFormat } from "./shared.js";

export function registerStatus(program: Command): void {
  const status = program
    .command("status")
    .description("show the status of the local Stigmer stack")
    .action(async (options: OutputFlags) => {
      const { buildStatusResult } = await import("../local/status.js");
      renderResult(await buildStatusResult(), resultFormat(options));
    });
  addResultFlags(status);
}
