// `stigmer version` — print the CLI version. No backend, no flags.

import type { Command } from "commander";
import { VERSION } from "../version.js";

export function registerVersion(program: Command): void {
  program
    .command("version")
    .description("print the CLI version")
    .action(() => {
      process.stdout.write(`${VERSION}\n`);
    });
}
