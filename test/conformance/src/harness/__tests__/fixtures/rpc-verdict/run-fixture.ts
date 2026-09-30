// Runs one call-verdict fixture in a vitest of its own and writes its JSON
// report: `tsx run-fixture.ts <fixture> <report.json> [--no-setup]`.
// Domain: conformance harness (the RPC contract's call verdict).
//
// The recorder's unit arms (../../rpc-recorder.test.ts) need a vitest run
// whose tests are meant to fail, and their files must not look like tests to
// anything else: the unit config collects `*.test.ts` and the test-integrity
// tool reads every `*.test.ts` and `*.spec.ts`. So the fixtures are named
// `*.fixture.ts`, and only this driver runs them, through vitest's Node API
// with no config file (the CLI has no `include`). It runs in its own process
// because a vitest started inside a vitest worker would share that worker's
// runner state, the very state the recorder reads.
//
// The run loads rpc-verdict-setup.ts as every suite config does; `--no-setup`
// leaves it out, to show what a config that forgets it gets.
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startVitest } from "vitest/node";

const SETUP = fileURLToPath(new URL("../../../rpc-verdict-setup.ts", import.meta.url));

const [fixtureArg, reportArg, flag] = process.argv.slice(2);
if (fixtureArg === undefined || reportArg === undefined || (flag !== undefined && flag !== "--no-setup")) {
  console.error("usage: tsx run-fixture.ts <fixture> <report.json> [--no-setup]");
  process.exit(2);
}
const fixture = resolve(fixtureArg);
const vitest = await startVitest("test", [], {
  config: false,
  root: dirname(fixture),
  include: [basename(fixture)],
  setupFiles: flag === "--no-setup" ? [] : [SETUP],
  watch: false,
  reporters: ["json"],
  outputFile: resolve(reportArg),
});
await vitest.close();
// The report is the result; a red fixture is the expected outcome of most
// arms, so the exit code says only whether the run itself completed.
process.exit(0);
