#!/usr/bin/env node
/**
 * The Go, Python and Java quick starts, run as a developer runs them against
 * the Stigmer on their machine: `stigmer up` from source with the fake model,
 * then each language's quick start file (sdk/go/examples/quickstart/main.go,
 * sdk/python/examples/quickstart.py, sdk/java/examples/Quickstart.java),
 * which each README's "Quick Start" and each SDK page's "Run an agent" show
 * byte for byte (test/install/sdk-quickstarts.test.mjs pins the copies). A
 * quick start connects with no key, applies the `greeter` agent in the
 * `stigmer` organization `stigmer up` makes, sends one message and prints the
 * answer; each run must exit 0 with the scripted answer as its last line.
 *
 * Each language runs from this checkout as its developer would install it:
 *   - Go: `go run ./examples/quickstart` in sdk/go (the module from the tree,
 *     go.work joining the proto stubs);
 *   - Python: a fresh virtual environment with the in-tree stubs and the SDK
 *     installed, as `make -C sdk/python test` installs them, then
 *     `python examples/quickstart.py`;
 *   - Java: the stubs and the SDK installed into a Maven repository (a
 *     private one in this run's folder by default, never the machine's
 *     shared ~/.m2), then `java -cp <the SDK's runtime classpath>
 *     examples/Quickstart.java`, the README's line.
 *
 * The model is test/support's fake, scripted per run: the conversation's
 * title to the runner's title call alone (lib/fake-model.mjs `isTitleCall`),
 * the answer to the turn. `stigmer up` serves on port 7234, so this refuses
 * before anything starts when that port is taken.
 *
 * Its cases are top-level `node:test` cases titled with the UX bar's promise
 * (test/ux-bar.json SDK-01), read by scripts/ux-bar.mjs and the scorecard.
 *
 * Usage:
 *   node test/install/smoke-sdk-quickstarts.mjs [--keep] [--maven-repo=<dir>] [--fake-model=error]
 *   --keep              keep this run's folder and the stack's home.
 *   --maven-repo=<dir>  install the Java stubs and SDK into <dir> (CI passes
 *                       the runner's ~/.m2/repository, which it caches).
 *   --fake-model=error  every model call fails: each quick start must then
 *                       print the server's words and exit non-zero, which is
 *                       how this smoke is shown red.
 * `make smoke-sdk-quickstarts` builds what the source CLI needs first.
 * Needs node, go, python3, java and mvn on PATH.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { anthropicText } from "../support/src/llm-wire.ts";
import { fakeModelEnv, isTitleCall, parseFakeModelArg, startFakeModel } from "./lib/fake-model.mjs";
import { CLI_SERVER_PORT, createCliInstall, spawnCommand } from "./lib/install-cli.mjs";
import { assertPortFree } from "./lib/stigmer-smoke.mjs";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
// A first `go run` compiles the SDK; a first Maven install downloads its dependencies.
const COMMAND_TIMEOUT_MS = 600_000;
/** What the scripted agent answers: the line each quick start must print last. */
const ANSWER = "Hello, and welcome to Stigmer!";

function log(step) {
  console.log(`smoke-sdk-quickstarts: ${step}`);
}

function parseArgs() {
  const parsed = { keep: false, mavenRepo: "", mode: "reply" };
  for (const arg of process.argv.slice(2)) {
    let m;
    const mode = parseFakeModelArg(arg);
    if (mode !== undefined) parsed.mode = mode;
    else if (arg === "--keep") parsed.keep = true;
    else if ((m = arg.match(/^--maven-repo=(.+)$/)) !== null) parsed.mavenRepo = resolve(m[1]);
    else {
      console.error(`smoke-sdk-quickstarts: unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return parsed;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/** A `go env` value, or undefined when Go is not installed (the Go case then says so). */
function goEnv(key) {
  const result = spawnSync("go", ["env", key], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

const args = parseArgs();
const scratch = mkdtempSync(join(tmpdir(), "stigmer-sdk-quickstarts-"));
const mavenRepo = args.mavenRepo === "" ? join(scratch, "m2") : args.mavenRepo;
let fake;
let stack;
let shell;
let failed = false;

/** Runs a line in bash in `cwd` with the developer's shell; throws on a non-zero exit. */
async function run(line, cwd) {
  log(`$ ${line}`);
  const result = await spawnCommand(["bash", "-c", 'cd "$0" || exit 1; eval "$1"'], [cwd, line], shell, COMMAND_TIMEOUT_MS).done;
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(`failed: ${line} (${result.error?.message ?? `exit ${result.status}`})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

/** Scripts one quick start's turn: the title to the title call, the answer to the turn. */
function scriptTurn() {
  fake.enqueue({ kind: "anthropic", body: anthropicText("A first hello"), matches: isTitleCall });
  fake.enqueue({ kind: "anthropic", body: anthropicText(ANSWER), matches: (request) => !isTitleCall(request) });
}

/** Runs a quick start and holds it to the promise: exit 0, the agent's answer as its last line. */
async function runQuickStart(line, cwd) {
  scriptTurn();
  const result = await run(line, cwd);
  const last = result.stdout.trimEnd().split("\n").at(-1);
  if (last !== ANSWER) throw new Error(`${line} printed ${JSON.stringify(last)} last, not the agent's answer ${JSON.stringify(ANSWER)}:\n${result.stdout}`);
  log(`${line}: printed the agent's answer`);
}

before(async () => {
  try {
    await assertPortFree(CLI_SERVER_PORT);
    fake = await startFakeModel({ mode: args.mode });
    stack = createCliInstall({ model: fakeModelEnv(fake), log });
    await stack.start({ kind: "build" });
    shell = {
      ...stack.env,
      // The toolchains read their settings and caches from the machine's own
      // home, not the stack's isolated one: Go its modules and build cache,
      // pip its wheels.
      GOPATH: process.env.GOPATH ?? join(homedir(), "go"),
      GOCACHE: process.env.GOCACHE ?? goEnv("GOCACHE"),
      PIP_CACHE_DIR: process.env.PIP_CACHE_DIR ?? join(homedir(), ".cache", "pip"),
    };
    log(`stigmer up is serving on ${stack.baseUrl}`);
  } catch (error) {
    failed = true;
    throw error;
  }
});

after(async () => {
  if (stack !== undefined) {
    if (failed) console.error(stack.diagnostics());
    await stack.stop({ keepHome: failed || args.keep });
  }
  await fake?.close();
  if (failed || args.keep) log(`folder kept: ${scratch}`);
  else rmSync(scratch, { recursive: true, force: true });
});

/** A case's body, marking the run failed when it throws so the folders are kept. */
async function guarded(body) {
  try {
    await body();
  } catch (error) {
    failed = true;
    throw error;
  }
}

test("SDK-01 the Go quick start prints the agent's answer", () =>
  guarded(async () => {
    await runQuickStart("go run ./examples/quickstart", join(repoRoot, "sdk", "go"));
  }));

test("SDK-01 the Python quick start prints the agent's answer", () =>
  guarded(async () => {
    const venv = join(scratch, "venv");
    const python = join(venv, "bin", "python");
    await run(`python3 -m venv ${shellQuote(venv)}`, scratch);
    await run(
      `${shellQuote(python)} -m pip install --quiet --disable-pip-version-check ${shellQuote(join(repoRoot, "apis", "stubs", "python", "stigmer"))} ${shellQuote(join(repoRoot, "sdk", "python"))}`,
      scratch,
    );
    await runQuickStart(`${shellQuote(python)} examples/quickstart.py`, join(repoRoot, "sdk", "python"));
  }));

test("SDK-01 the Java quick start prints the agent's answer", () =>
  guarded(async () => {
    mkdirSync(mavenRepo, { recursive: true });
    const repo = `-Dmaven.repo.local=${shellQuote(mavenRepo)}`;
    await run(`mvn -q -B install -DskipTests ${repo}`, join(repoRoot, "apis", "stubs", "java"));
    await run(`mvn -q -B install -DskipTests ${repo}`, join(repoRoot, "sdk", "java"));
    const classpathFile = join(scratch, "java-classpath.txt");
    await run(`mvn -q -B dependency:build-classpath -Dmdep.outputFile=${shellQuote(classpathFile)} ${repo}`, join(repoRoot, "sdk", "java"));
    const sdkJar = spawnSync("bash", ["-c", "ls target/stigmer-sdk-*.jar | grep -v -e sources -e javadoc | head -1"], {
      cwd: join(repoRoot, "sdk", "java"),
      encoding: "utf8",
    }).stdout.trim();
    if (sdkJar === "") throw new Error("the Java SDK's install left no target/stigmer-sdk-*.jar");
    await runQuickStart(
      `java -cp ${shellQuote(sdkJar)}:"$(cat ${shellQuote(classpathFile)})" examples/Quickstart.java`,
      join(repoRoot, "sdk", "java"),
    );
  }));
