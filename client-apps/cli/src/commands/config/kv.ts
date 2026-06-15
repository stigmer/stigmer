// `stigmer config get|set|list|path` — generic key/value access to the config
// file. get/list/path print plain values to stdout (pipe-friendly); set emits a
// structured result.

import type { Command } from "commander";
import { configKeyNames, configPath, getConfigValue, load, save, setConfigValue } from "../../config/index.js";
import { CommandResult, type OutputFlags, renderResult } from "../../output/index.js";
import { addResultFlags, resultFormat } from "../shared.js";

export function addKvCommands(config: Command): void {
  config
    .command("path")
    .description("print the config file path")
    .action(() => {
      process.stdout.write(configPath() + "\n");
    });

  config
    .command("get <key>")
    .description("print a single config value")
    .action((key: string) => {
      process.stdout.write(getConfigValue(load(), key) + "\n");
    });

  config
    .command("list")
    .description("list all config values")
    .action(() => {
      const cfg = load();
      const lines = configKeyNames().map((key) => `${key}=${getConfigValue(cfg, key)}`);
      process.stdout.write(lines.join("\n") + "\n");
    });

  const set = config
    .command("set <key> <value>")
    .description("set a config value")
    .action((key: string, value: string, options: OutputFlags) => {
      const cfg = load();
      setConfigValue(cfg, key, value);
      save(cfg);
      renderResult(CommandResult.success(`Set ${key} = ${value}`), resultFormat(options));
    });
  addResultFlags(set);
}
