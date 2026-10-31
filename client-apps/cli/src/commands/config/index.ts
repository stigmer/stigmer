// `stigmer config` — configuration management command group.

import type { Command } from "commander";
import { addBackendCommands } from "./backend.js";
import { addContextCommands } from "./context.js";
import { addKvCommands } from "./kv.js";

export function registerConfig(program: Command): void {
  const config = program.command("config").description("manage CLI configuration");

  addKvCommands(config);

  const backend = config.command("backend").description("manage backend configuration (local vs cloud)");
  addBackendCommands(backend);

  const context = config.command("context").description("manage the active CLI context (organization)");
  addContextCommands(context);
}
