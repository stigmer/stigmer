// `stigmer config context show` — display the active CLI context.
//
// `context set --org` validates the organization against the server before
// persisting, so it is wired once the backend client lands (see registerConfig).

import type { Command } from "commander";
import { type Config, load, resolveContextOrganization } from "../../config/index.js";
import { CommandResult, type OutputFlags, renderResult } from "../../output/index.js";
import { addResultFlags, resultFormat } from "../shared.js";

export function addContextCommands(context: Command): void {
  const show = context
    .command("show")
    .description("show the active context")
    .action((options: OutputFlags) => {
      renderResult(buildShow(load()), resultFormat(options));
    });
  addResultFlags(show);
}

function buildShow(config: Config): CommandResult {
  const organization = resolveContextOrganization(config) || "(not set)";
  const result = CommandResult.success("CLI context");
  result.addSection("").field("Organization", organization).field("Backend", config.backend.type);
  return result;
}
