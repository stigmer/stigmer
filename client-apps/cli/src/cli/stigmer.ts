#!/usr/bin/env node
// Entry point for the `stigmer` CLI. Builds the commander program and runs it.
//
// Every command-action failure (and any parse-time rejection) funnels through
// clierr.handle, the single exit point that maps the error to a stable exit
// code and prints a user-facing message to stderr.

import { handle } from "../errors/index.js";
import { buildProgram } from "../program.js";

async function main(): Promise<void> {
  const program = buildProgram();
  await program.parseAsync(process.argv);
}

main().catch(handle);
