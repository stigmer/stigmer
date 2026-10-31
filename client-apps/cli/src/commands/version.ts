// `stigmer version` — print the CLI version. No backend; `-o json` prints
// it as `{"version": ...}`.

import type { Command } from "commander";
import { renderValue } from "../output/command-result.js";
import type { OutputFlags } from "../output/format.js";
import { VERSION } from "../version.js";
import { addValueFlags, resultFormat } from "./shared.js";

export function registerVersion(program: Command): void {
  const version = program
    .command("version")
    .description("print the CLI version")
    .action((options: OutputFlags) => {
      renderValue(VERSION, { version: VERSION }, resultFormat(options));
    });
  addValueFlags(version);
}
