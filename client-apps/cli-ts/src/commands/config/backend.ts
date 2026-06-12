// `stigmer config backend status|set` — inspect and switch the active backend.

import type { Command } from "commander";
import { type Config, isCloudMode, load, resolveEndpoint, save } from "../../config/index.js";
import { UsageError } from "../../errors/index.js";
import { CommandResult, type OutputFlags, renderResult } from "../../output/index.js";
import { addResultFlags, resultFormat } from "../shared.js";

const DEFAULT_CLOUD_ENDPOINT = "api.stigmer.ai:443";

export function addBackendCommands(backend: Command): void {
  const status = backend
    .command("status")
    .description("show the current backend")
    .action((options: OutputFlags) => {
      renderResult(buildStatus(load()), resultFormat(options));
    });
  addResultFlags(status);

  const set = backend
    .command("set <type>")
    .description("set the backend type (local or cloud)")
    .action((type: string, options: OutputFlags) => {
      renderResult(applySet(type), resultFormat(options));
    });
  addResultFlags(set);
}

function buildStatus(config: Config): CommandResult {
  const result = CommandResult.success("Backend configuration");
  const section = result.addSection("").field("Type", config.backend.type).field("Endpoint", resolveEndpoint(config));
  if (isCloudMode(config)) {
    section.field("Auth", config.backend.cloud?.token ? "Logged in" : "Not logged in");
  }
  return result;
}

function applySet(type: string): CommandResult {
  if (type !== "local" && type !== "cloud") {
    throw new UsageError(`invalid backend type "${type}" (expected: local, cloud)`);
  }

  const config = load();
  config.backend.type = type;

  if (type === "cloud") {
    if (config.backend.cloud === undefined) {
      config.backend.cloud = { endpoint: DEFAULT_CLOUD_ENDPOINT };
    }
    save(config);
    return CommandResult.success("Backend set to cloud")
      .hint("Please authenticate:")
      .hint("  stigmer auth login");
  }

  save(config);
  return CommandResult.success("Backend set to local").hint("Make sure the Stigmer server is running.");
}
