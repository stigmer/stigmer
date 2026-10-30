#!/usr/bin/env node
// stigmer-ink: a Stigmer agent turn as one child process, for a host written
// in any language (the docs' Go, Python and Rust bridges spawn it). Its work
// is runCli (main.tsx); this file wires the process to it. The shebang is
// `node` and the published file is compiled JavaScript, so it runs on Node
// alone. The process's signals are the bin's to map (a library takes none):
// SIGINT and SIGTERM stop the wait as Ctrl+C does, the run goes on on the
// server, and the code is 130.
//
// Proven by test/install/smoke-terminal-kit.mjs (the packed bin, on a
// terminal and off one); its work by __tests__/cli-main.test.tsx.

import { runCli } from "./main.js";

/* v8 ignore start -- @preserve: process wiring only; the packed bin is run by test/install/smoke-terminal-kit.mjs, which no unit suite measures */
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

runCli(process.argv.slice(2), {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  env: process.env,
  signal: controller.signal,
}).then(
  (code) => {
    process.exitCode = code;
    // Ink has flushed its last frame; an idle client connection must not hold the process.
    setTimeout(() => process.exit(code), 200).unref();
  },
  (error: unknown) => {
    process.stderr.write(`stigmer-ink: ${String(error)}\n`);
    process.exit(1);
  },
);
/* v8 ignore stop */
