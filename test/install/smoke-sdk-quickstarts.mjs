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
 * Then the token routes the console hands a builder (`buildAppHandover`,
 * sdk/typescript/src/app-handover.ts; the UX bar's CON-10), each run as
 * written: Python, Go and Java with the same toolchains, Node and Next.js
 * with tsx. They mint, so they need a Stigmer that signs its callers in,
 * which `stigmer up` is not: a second server, from the built entry, trusts
 * test/support's hermetic issuer and is made ready as the console's tab
 * makes it (lib/signed-in-server.mjs). Each route, given the service
 * account's key and STIGMER_DEV_USER, must answer one GET with a token the
 * server reads as an app user's; started without STIGMER_DEV_USER, it must
 * refuse with 401. The address is http://, so Go, Python and Java take their
 * SDK's plaintext option, the branch a server on a laptop takes.
 *
 * Usage:
 *   node test/install/smoke-sdk-quickstarts.mjs [--keep] [--maven-repo=<dir>] [--fake-model=error]
 *   --keep              keep this run's folder and the stack's home.
 *   --maven-repo=<dir>  install the Java stubs and SDK into <dir> (CI passes
 *                       the runner's ~/.m2/repository, which it caches).
 *   --fake-model=error  every model call fails: each quick start must then
 *                       print the server's words and exit non-zero, which is
 *                       how this smoke is shown red.
 * `make smoke-sdk-quickstarts` builds what the source CLI needs first, and the
 * workspace libraries the handover's writer and client come from.
 * Needs node, go, python3, java and mvn on PATH.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { anthropicText } from "../support/src/llm-wire.ts";
import { fakeModelEnv, isTitleCall, parseFakeModelArg, startFakeModel } from "./lib/fake-model.mjs";
import { CLI_SERVER_PORT, createCliInstall, spawnCommand } from "./lib/install-cli.mjs";
import { startSignedInServer } from "./lib/signed-in-server.mjs";
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
let signedIn;
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
  if (signedIn !== undefined) {
    if (failed) console.error(signedIn.logTail());
    await signedIn.stop();
  }
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

/** A virtual environment with the in-tree stubs and SDK installed, made once: its python. */
let pythonMade;
function pythonVenv() {
  pythonMade ??= (async () => {
    const venv = join(scratch, "venv");
    const python = join(venv, "bin", "python");
    await run(`python3 -m venv ${shellQuote(venv)}`, scratch);
    await run(
      `${shellQuote(python)} -m pip install --quiet --disable-pip-version-check ${shellQuote(join(repoRoot, "apis", "stubs", "python", "stigmer"))} ${shellQuote(join(repoRoot, "sdk", "python"))}`,
      scratch,
    );
    return python;
  })();
  return pythonMade;
}

/** The stubs and SDK installed into the Maven repository, made once: the `-cp` a single-file program runs with. */
let javaMade;
function javaClasspath() {
  javaMade ??= (async () => {
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
    return `${shellQuote(join(repoRoot, "sdk", "java", sdkJar))}:"$(cat ${shellQuote(classpathFile)})"`;
  })();
  return javaMade;
}

test("SDK-01 the Python quick start prints the agent's answer", () =>
  guarded(async () => {
    const python = await pythonVenv();
    await runQuickStart(`${shellQuote(python)} examples/quickstart.py`, join(repoRoot, "sdk", "python"));
  }));

test("SDK-01 the Java quick start prints the agent's answer", () =>
  guarded(async () => {
    const classpath = await javaClasspath();
    await runQuickStart(`java -cp ${classpath} examples/Quickstart.java`, join(repoRoot, "sdk", "java"));
  }));

// ---------------------------------------------------------------------------
// The token routes the console hands a builder
// ---------------------------------------------------------------------------

/** The person a route signs in while its builder has not wired their own sign-in. */
const DEV_USER = "dana@handover.stigmer.test";
/** How long a route may take to answer its first request: Go and Java compile first. */
const ROUTE_READY_MS = 300_000;
/** An app user, as the server provisions one (IdentityAccountProvisioningMode.app_user). */
const APP_USER = 4;

/** A port nothing listens on now. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

/** The handover's writer, as the workspace's build emits it. */
async function handoverFor(stack) {
  signedIn ??= await startSignedInServer({ log });
  const { buildAppHandover } = await import(new URL("../../sdk/typescript/dist/app-handover.js", import.meta.url).href);
  const { backend } = buildAppHandover({ mode: "sign-in", stack, baseUrl: signedIn.baseUrl, org: signedIn.orgSlug, agent: "greeter" });
  if (backend === undefined) throw new Error(`the handover wrote no ${stack} route`);
  return backend;
}

/** Writes the route's file into a folder of its own (its path may hold folders). */
function writeRoute(folder, backend) {
  const file = join(folder, backend.file);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, backend.code);
  log(`wrote ${backend.file} in ${folder}`);
}

/** Starts a route's process and asks GET /api/stigmer-token until it answers (any status); kills it after. */
async function askRoute(command, cwd, { devUser }) {
  const port = await freePort();
  const env = { ...shell, STIGMER_API_KEY: signedIn.apiKey, PORT: String(port) };
  if (devUser) env.STIGMER_DEV_USER = DEV_USER;
  else delete env.STIGMER_DEV_USER;
  log(`$ ${command} (port ${port}${devUser ? `, STIGMER_DEV_USER=${DEV_USER}` : ", no STIGMER_DEV_USER"})`);
  const child = spawn("bash", ["-c", command], { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  let exited = false;
  child.once("exit", () => (exited = true));
  try {
    const deadline = Date.now() + ROUTE_READY_MS;
    while (Date.now() < deadline) {
      if (exited) throw new Error(`${command} exited before answering:
${output}`);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/stigmer-token`);
        return { status: res.status, body: await res.text() };
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error(`${command} did not answer within ${ROUTE_READY_MS} ms:
${output}`);
  } finally {
    if (!exited) process.kill(-child.pid, "SIGKILL");
  }
}

/** Holds a route's two answers to the promise: a token the server reads as an app user's, then a refusal. */
async function holdRoute(stack, signedInAnswer, refusedAnswer) {
  if (signedInAnswer.status !== 200) throw new Error(`the ${stack} route answered ${signedInAnswer.status}: ${signedInAnswer.body}`);
  const { accessToken, expiresAt } = JSON.parse(signedInAnswer.body);
  if (!(new Date(expiresAt).getTime() > Date.now())) throw new Error(`the ${stack} route's expiresAt is not a future time: ${expiresAt}`);
  const mode = await signedIn.provisioningModeOf(accessToken);
  if (mode !== APP_USER) throw new Error(`the ${stack} route's token names an account provisioned as ${mode}, not an app user`);
  if (refusedAnswer.status !== 401) throw new Error(`with nobody signed in, the ${stack} route answered ${refusedAnswer.status}, not 401: ${refusedAnswer.body}`);
  log(`the ${stack} route answered a token for an app user, and refused with nobody signed in`);
}

/** Runs a route twice, signed in and not, and holds it to the promise. */
async function runRoute(stack, command, cwd) {
  const signedInAnswer = await askRoute(command, cwd, { devUser: true });
  const refusedAnswer = await askRoute(command, cwd, { devUser: false });
  await holdRoute(stack, signedInAnswer, refusedAnswer);
}

/** A folder whose `node_modules` is the workspace's, so the TypeScript routes resolve the client as a builder's install does. */
function nodeFolder(name) {
  const folder = join(scratch, name);
  mkdirSync(folder, { recursive: true });
  symlinkSync(join(repoRoot, "node_modules"), join(folder, "node_modules"), "dir");
  return folder;
}

const TSX = shellQuote(join(repoRoot, "node_modules", ".bin", "tsx"));

test("CON-10 the handed-over Python token route answers a token for an app user, and refuses when nobody is signed in", () =>
  guarded(async () => {
    const python = await pythonVenv();
    const backend = await handoverFor("python");
    const folder = join(scratch, "route-python");
    writeRoute(folder, backend);
    await runRoute("python", `exec ${shellQuote(python)} ${backend.file}`, folder);
  }));

test("CON-10 the handed-over Go token route answers a token for an app user, and refuses when nobody is signed in", () =>
  guarded(async () => {
    const backend = await handoverFor("go");
    const folder = join(scratch, "route-go");
    writeRoute(folder, backend);
    // A builder's own module, joined to the SDK in this tree as go.work joins it.
    writeFileSync(join(folder, "go.mod"), "module example.com/handover\n\ngo 1.25.6\n");
    writeFileSync(
      join(folder, "go.work"),
      `go 1.25.6\n\nuse (\n\t.\n\t${join(repoRoot, "sdk", "go")}\n\t${join(repoRoot, "apis", "stubs", "go")}\n)\n\nreplace google.golang.org/genproto => google.golang.org/genproto v0.0.0-20260519071638-aa98bba5eb94\n`,
    );
    copyFileSync(join(repoRoot, "go.work.sum"), join(folder, "go.work.sum"));
    await run("go build -o route .", folder);
    await runRoute("go", "exec ./route", folder);
  }));

test("CON-10 the handed-over Java token route answers a token for an app user, and refuses when nobody is signed in", () =>
  guarded(async () => {
    const classpath = await javaClasspath();
    const backend = await handoverFor("java");
    const folder = join(scratch, "route-java");
    writeRoute(folder, backend);
    await runRoute("java", `exec java -cp ${classpath} ${backend.file}`, folder);
  }));

test("CON-10 the handed-over Node token route answers a token for an app user, and refuses when nobody is signed in", () =>
  guarded(async () => {
    const backend = await handoverFor("node");
    const folder = nodeFolder("route-node");
    writeRoute(folder, backend);
    await runRoute("node", `exec ${TSX} ${backend.file}`, folder);
  }));

test("CON-10 the handed-over Next.js route handler answers a token for an app user, and refuses when nobody is signed in", () =>
  guarded(async () => {
    const backend = await handoverFor("nextjs");
    const folder = nodeFolder("route-nextjs");
    writeRoute(folder, backend);
    // A Next.js app's modules are ES modules, and the runner below awaits at its top.
    writeFileSync(join(folder, "package.json"), '{ "type": "module" }\n');
    // Next.js calls the module's GET with the request; so does this.
    writeFileSync(
      join(folder, "ask.ts"),
      [
        `import { GET } from "./${backend.file}";`,
        `const res = await GET(new Request("http://localhost/api/stigmer-token"));`,
        `console.log(JSON.stringify({ status: res.status, body: await res.text() }));`,
        "",
      ].join("\n"),
    );
    const ask = async (devUser) => {
      const env = devUser ? `STIGMER_DEV_USER=${shellQuote(DEV_USER)} ` : "";
      const result = await run(`STIGMER_API_KEY=${shellQuote(signedIn.apiKey)} ${env}${TSX} ask.ts`, folder);
      return JSON.parse(result.stdout.trim().split("\n").at(-1));
    };
    await holdRoute("nextjs", await ask(true), await ask(false));
  }));
