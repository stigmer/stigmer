#!/usr/bin/env node

/**
 * CLI E2E smoke (born as the D4 #24 cutover gate): `stigmer up` → apply →
 * run → stream → `stigmer down`, against an ISOLATED home, proving the
 * daemon launches the packaged server end-to-end. Nothing else exercises
 * `stigmer up` whole — the e2e suites boot the server entry directly,
 * bypassing the CLI (verified during #24 planning).
 *
 * The script stages the SLIM server artifact (dist-slim) as a server
 * package and launches it through the daemon's node+entry path — the exact
 * packaged entry users get from @stigmer/server-slim. (The script's second
 * arm — the STIGMER_SERVER_BIN Go rollback — retired with #25
 * go-server-retirement.)
 *
 * The launch is verified, not assumed: after `up`, the server child's real
 * command line (via its PID file) must be a node+entry process.
 *
 * The workflow under test is a single deterministic set_vars task — no LLM,
 * no API keys, no network beyond npm/Temporal's own machinery. What it
 * proves: CLI daemon → server (gRPC gate) → bootstrap → workflow apply
 * → Temporal orchestration → runner execution → event streaming → clean
 * shutdown. Then an agent is applied and run with `stigmer run <agent> -m`:
 * the shell `stigmer up` starts from carries the model settings a user
 * exports (ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL), pointed at a fake
 * Anthropic API on loopback (scripts/lib/fake-model.mjs), and the streamed
 * run must carry the fake's reply — what a CLI user sees as the answer.
 * Since the console restoration (DD-012) it also proves the
 * unified port serves the bundled web console: /config.json synthesis, a
 * dynamic deep link, and the 404 posture — the P3 acceptance's
 * "`stigmer up` serves the console end-to-end" arm.
 *
 * The CLI itself runs from source under tsx — the repo's documented dev
 * launch (its `start` script; the daemon re-exec replays the loader via
 * process.execArgv, see daemon/launch.ts). The packaged artifact under test
 * here is the SERVER slim bundle, staged byte-for-byte.
 *
 * How the CLI is installed, started and stopped in its isolated home is
 * scripts/lib/install-cli.mjs, the one boot the upgrade rehearsal shares.
 *
 * Prereqs (the gate's build steps): backend/services/runner built (dist/)
 * and the server's dist-slim/ (make smoke-cli-cutover builds both).
 *
 * Usage:
 *   node scripts/smoke-cli-cutover.mjs
 *       The CLI from source, the staged slim server (the gate's mode).
 *   node scripts/smoke-cli-cutover.mjs --published --version=X.Y.Z
 *       The published CLI, installed by site/public/install.sh into the
 *       isolated home, which acquires its own published server and runner
 *       on `up` — a user's install, end to end.
 *   --fake-model=error   the fake answers every model call with an error,
 *       so the agent run must fail (its red-first check).
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fakeModelEnv, parseFakeModelArg, startFakeModel } from "./lib/fake-model.mjs";
import { CLI_SERVER_PORT, createCliInstall } from "./lib/install-cli.mjs";
import { assertConsoleServed } from "./lib/stigmer-smoke.mjs";

/** The org `stigmer up`'s bootstrap creates — the CLI's fallback on a local backend. */
const ORG = "stigmer";
const RUN_TIMEOUT_MS = 120_000;
/** The agent the smoke applies and runs by slug. */
const AGENT = "cutover-smoke-agent";

function log(step) {
  console.log(`smoke-cli-cutover: ${step}`);
}

function parseArgs() {
  const parsed = { published: false, version: "", fakeModel: "reply" };
  for (const arg of process.argv.slice(2)) {
    let m;
    const fakeModelMode = parseFakeModelArg(arg);
    if (fakeModelMode !== undefined) parsed.fakeModel = fakeModelMode;
    else if (arg === "--published") parsed.published = true;
    else if ((m = arg.match(/^--version=(.+)$/)) !== null) parsed.version = m[1].replace(/^v/, "");
    else
      usage(
        `unknown argument: ${arg} (usage: node scripts/smoke-cli-cutover.mjs [--published --version=X.Y.Z] [--fake-model=error])`,
      );
  }
  if (parsed.published && parsed.version === "") usage("--published requires --version=X.Y.Z (the published @stigmer/cli)");
  if (!parsed.published && parsed.version !== "") usage("--version applies only with --published");
  return parsed;
}

function usage(message) {
  console.error(`smoke-cli-cutover: ${message}`);
  process.exit(1);
}

const args = parseArgs();
const release = args.published ? { kind: "published", version: args.version } : { kind: "build" };

// The model the stack is started with: the fake on loopback, configured the
// way a user exports a gateway for `stigmer up`.
const fake = await startFakeModel({ mode: args.fakeModel });
const stack = createCliInstall({ model: fakeModelEnv(fake), log });
const { home, cli } = stack;
let failed = false;

try {
  // 1. Up — the daemon resolves the staged server (or acquires the published
  //    one), gates on the gRPC port, and bootstraps the backend (which
  //    creates the org).
  await stack.start(release);

  // 2. Prove WHICH server is running: the server child's command line must
  //    be the node+entry launch. The PID file is the daemon's own record.
  const server = stack.serverCommand();
  log(`server pid ${server.pid}: ${server.command}`);
  if (!(server.command.includes("node") && server.command.includes("main.js"))) {
    throw new Error(`expected a node+entry server process, got: ${server.command}`);
  }

  // 3. Console restoration (DD-012): the slim artifact ships the web
  //    console and the server serves it from the unified port. Probe the
  //    three load-bearing arms a browser exercises: the synthesized
  //    /config.json (the one trusted-local document, asserted by the shared
  //    probe in scripts/lib/stigmer-smoke.mjs together with / as HTML), a
  //    dynamic deep link resolving to its placeholder document, and the 404
  //    posture (the export's not-found page WITH a 404 status — never the
  //    blank app shell). `--no-web` only suppresses URL reporting; serving
  //    is unconditional.
  const consoleBase = `http://127.0.0.1:${CLI_SERVER_PORT}`;
  await assertConsoleServed(consoleBase).catch((error) => {
    throw new Error(`console ${error instanceof Error ? error.message : String(error)}`);
  });
  const deepLink = await fetch(`${consoleBase}/sessions/zz-smoke-probe`);
  if (
    deepLink.status !== 200 ||
    !(deepLink.headers.get("content-type") ?? "").includes("text/html")
  ) {
    throw new Error(
      `console deep link answered ${deepLink.status} ${deepLink.headers.get("content-type")}`,
    );
  }
  const notFound = await fetch(`${consoleBase}/zz-no-such-route`);
  if (notFound.status !== 404) {
    throw new Error(`console unknown URL answered ${notFound.status}, expected 404`);
  }
  log("console serving verified");

  // 4. Apply the deterministic workflow.
  const workflowPath = join(home, "cutover-smoke.yaml");
  writeFileSync(
    workflowPath,
    `apiVersion: agentic.stigmer.ai/v1
kind: Workflow
metadata:
  name: cutover-smoke
spec:
  description: Deterministic no-LLM workflow for the CLI cutover smoke.
  document:
    dsl: "1.0.0"
    namespace: stigmer
    name: cutover-smoke
    version: "1.0.0"
  tasks:
    - name: set_greeting
      kind: set_vars
      task_config:
        variables:
          greeting: hello-from-the-cutover-smoke
      export:
        as: "\${ . }"
`,
  );
  // --org is a root-level global option, so it precedes the subcommand.
  await cli(["--org", ORG, "apply", "-f", workflowPath]);

  // 5. Run it and stream to completion (JSON events on stdout) — a clean
  //    exit is required.
  const run = await cli(["--org", ORG, "run", "workflow", "cutover-smoke", "--json"], {
    timeoutMs: RUN_TIMEOUT_MS,
  });
  if (!/completed/i.test(run.stdout)) {
    throw new Error(
      `run did not reach COMPLETED\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`,
    );
  }

  // 6. Apply an agent and run it by slug: the stream must carry the model's
  //    reply, which only happens when `stigmer up` handed the runner the
  //    model settings from its shell and the runner reached the model.
  const agentPath = join(home, "cutover-smoke-agent.yaml");
  writeFileSync(
    agentPath,
    `apiVersion: agentic.stigmer.ai/v1
kind: Agent
metadata:
  name: ${AGENT}
spec:
  description: A tool-less agent for the CLI smoke; its model is the smoke's fake.
  instructions: Answer the message in one short sentence.
`,
  );
  await cli(["--org", ORG, "apply", "-f", agentPath]);
  const agentRun = await cli(["--org", ORG, "run", AGENT, "-m", "Say hello.", "--json"], {
    timeoutMs: RUN_TIMEOUT_MS,
  });
  if (!agentRun.stdout.includes(fake.replyText)) {
    throw new Error(
      `the agent run's stream does not carry the model's reply (${fake.requests()} model calls)\n` +
        `stdout:\n${agentRun.stdout}\nstderr:\n${agentRun.stderr}`,
    );
  }
  log(`agent run streamed the model's reply (${fake.requests()} model calls)`);

  // 7. Down — clean teardown, port released.
  await cli(["down"]);
  const status = await cli(["status"], { allowFailure: true });
  if (
    /running/i.test(status.stdout) &&
    !/not running|stopped/i.test(status.stdout)
  ) {
    throw new Error(`stack still reports running after down\n${status.stdout}`);
  }
  log("PASS");
} catch (error) {
  failed = true;
  console.error(`smoke-cli-cutover: ${error instanceof Error ? error.message : String(error)}`);
  console.error(stack.diagnostics());
} finally {
  // Success-path hygiene: the isolated home carries a full slim copy plus a
  // Temporal binary (~100 MB) — keep failures around for debugging, never
  // successes.
  await stack.stop({ keepHome: failed });
  await fake.close();
}
process.exit(failed ? 1 : 0);
