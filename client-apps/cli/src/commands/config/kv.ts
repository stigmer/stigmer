// `stigmer config get|set|list|path` — generic key/value access to the config
// file. get/list/path print plain values to stdout (pipe-friendly), or with
// `-o json` one JSON document; set emits a structured result.

import type { Command } from "commander";
import { configKeyNames, configPath, getConfigValue, load, save, setConfigValue } from "../../config/index.js";
import { CommandResult, type OutputFlags, renderResult, renderValue } from "../../output/index.js";
import { addResultFlags, addValueFlags, resultFormat } from "../shared.js";

export function addKvCommands(config: Command): void {
  const path = config
    .command("path")
    .description("print the config file path")
    .action((options: OutputFlags) => {
      renderValue(configPath(), { path: configPath() }, resultFormat(options));
    });
  addValueFlags(path);

  const get = config
    .command("get <key>")
    .description("print a single config value")
    .action((key: string, options: OutputFlags) => {
      const value = getConfigValue(load(), key);
      renderValue(value, { key, value }, resultFormat(options));
    });
  addValueFlags(get);

  const list = config
    .command("list")
    .description("list all config values")
    .action((options: OutputFlags) => {
      const cfg = load();
      const values = configKeyNames().map((key) => [key, getConfigValue(cfg, key)] as const);
      renderValue(values.map(([key, value]) => `${key}=${value}`).join("\n"), Object.fromEntries(values), resultFormat(options));
    });
  addValueFlags(list);

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
