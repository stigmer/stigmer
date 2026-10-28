#!/usr/bin/env node

/**
 * Verifies the slim runner artifact (dist-slim/) actually runs.
 *
 * Bundling failures are sneaky: a missed transitive dependency, a misplaced
 * wasm asset, or a broken native-bridge shim all produce an artifact that
 * looks complete but dies at boot — sometimes only after connecting to
 * Temporal (Worker.create is where the native bridge and workflow bundle
 * load). So this verifies against a real Temporal dev server, from an
 * isolated copy of the artifact (nothing can accidentally resolve from the
 * repo's node_modules), or, with --in-place, from the artifact itself:
 *
 *   1. Size budget — the artifact's runtime payload (sourcemaps excluded)
 *      stays under SLIM_SIZE_BUDGET_MB (default 120). The whole point of
 *      this artifact is being small (stigmer/stigmer#170); a dependency
 *      creeping past the budget should fail the release, not ship silently.
 *   2. Authenticated boot — boots manager mode on the AUTHENTICATED path
 *      (token + proxy), which every embedder runs and which regressed in
 *      #170, through the harnesses' boot and the agent host to the
 *      proxy-token reconciliation. Needs no Temporal: it stops before any
 *      network I/O.
 *   3. Cloud mode (not on Windows, see 5) — boots static mode as a cloud
 *      sandbox starts it (MODE=cloud, a token, a backend endpoint), so the
 *      cloud-only paths (the http checkpointer, the strict URL guard, the
 *      stdio MCP refusal) load from the bundle, and treats reaching the
 *      Temporal dial (an unroutable sentinel address, refused) as success,
 *      the signal verify-dist-boot.mjs uses. A served turn is the cluster's
 *      proof.
 *   4. The Claude engine's pin, not the engine — no package of Anthropic's
 *      engine is staged and the manifest names none (`bundle-slim.mjs`
 *      `NEVER_STAGED`: the npm package and the desktop app never carry it),
 *      and `claude-engine.json` sits beside the entry, naming the SDK and a
 *      platform package for each machine with a registry URL and an
 *      integrity; when the checkout's lockfile is beside these scripts, the
 *      pin must equal what it records (`claude-engine-pin.mjs`). The image
 *      smoke mounts only this directory, so there the pin's shape is checked
 *      and the lockfile comparison is the build lane's.
 *   4b. The Claude engine an image carries (with --claude-engines <dir>, the
 *      runner layer's /runner/engines): the home for the pinned version holds
 *      exactly the SDK and this machine's glibc platform package, each at
 *      the pin; its `claude --version` exits 0 run as the agent user
 *      (stigmer-agent, when this runs as root, as the image smoke does); and
 *      static mode's boot (check 6) logs the engine ready from that home.
 *   5. Attach entry (not on Windows) — attach/main.js beside the entry serves readiness,
 *      refuses a foreign push and stops cleanly (verify-attach-boot.mjs, run
 *      by the same Node). Skipped on Windows: the waiter runs only in a
 *      Linux sandbox, and Node on Windows cannot deliver SIGTERM as a signal
 *      (kill force-terminates), so the clean-stop check could never pass there
 *      (the desktop's Windows release leg runs this script).
 *   5b. Agent host — the entry started as the runner starts its agent host
 *      (`main.js agent-host`, a pipe on fd 3) announces itself on the pipe and
 *      exits when the pipe closes (verify-agent-host-boot.mjs, run by the same
 *      Node). Runs on every platform: every runner starts one.
 *   6. Static mode — boots, creates a Worker (native bridge + pre-built
 *      workflow bundle + sandbox worker thread), reaches RUNNING, and shuts
 *      down gracefully on SIGINT.
 *   7. Manager mode — full IPC lifecycle: ready → addSession → sessionAdded
 *      → shutdown → shutdownComplete, exit 0 — run both tokenless and on the
 *      authenticated path (so the lifecycle is proven on the proxy path too).
 *      The authenticated run also sets an OTLP endpoint, as a deployment that
 *      exports telemetry does: with one set the manager builds its OTel
 *      interceptors, and this is the path that once died resolving the OTel
 *      workflow module the slim artifact does not stage (stigmer/stigmer#1810).
 *
 * Checks 1–5 need no Temporal; checks 6–7 require a reachable Temporal server
 * (default localhost:7233, override with TEMPORAL_SERVICE_ADDRESS), e.g.:
 *
 *   temporal server start-dev --headless
 *
 * Usage:
 *   node scripts/verify-slim-artifact.mjs               # full suite (needs Temporal)
 *   node scripts/verify-slim-artifact.mjs --no-temporal # checks 1–5 only
 *
 * By default the subject is this package's dist-slim/, booted by `node` from
 * PATH. Two options point the same checks at the artifact as an embedder ships
 * it, run by the engine it ships with:
 *
 *   --node <path>        the Node binary that boots the runner
 *   --artifact <dir>     the staged artifact directory (default: dist-slim/)
 *   --entry <relative>   the entry inside it (default: main.js)
 *   --in-place           boot the artifact where it lives instead of a copy
 *   --claude-engines <dir>  the engines the image carries (check 4b)
 *
 * The desktop app runs exactly that after staging its bundle
 * (client-apps/desktop/scripts/verify-staged-runtime.mjs): its pinned Node
 * runtime against resources/runner, whose entry is dist/main.js. The sandbox
 * image's release smoke runs it inside the image against /runner/dist with
 * /runner/bin/start, the layer's start script, which execs /runner/bin/node,
 * and --in-place: there the artifact already ships isolated, and a sandbox
 * runs it from /runner/dist, so the checks must see the ownership and modes
 * the runner's agent user reads it with (a runner started as root through
 * the start script runs its agent host as that user, and a copy in a private
 * temporary directory is one it cannot read). Everything the checks write
 * goes to a scratch directory of their own, standing in for the workspace
 * and HOME a driver gives a sandbox.
 * The script imports only Node built-ins and its siblings
 * verify-attach-boot.mjs, verify-agent-host-boot.mjs and
 * claude-engine-pin.mjs, so it runs from a mounted checkout.
 */

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { CLAUDE_SDK, ENGINE_PIN_FILE, claudeEnginePinFromLockfile } from "./claude-engine-pin.mjs";

// The agent user a runner started as root through the layer runs its engines as (src/shared/agent-identity.ts).
const AGENT_UID = 10001;

const { values: options } = parseArgs({
  options: {
    "no-temporal": { type: "boolean", default: false },
    node: { type: "string", default: "node" },
    artifact: { type: "string" },
    entry: { type: "string", default: "main.js" },
    "in-place": { type: "boolean", default: false },
    "claude-engines": { type: "string" },
  },
});

const artifactDir = options.artifact
  ? resolve(options.artifact)
  : fileURLToPath(new URL("../dist-slim", import.meta.url));
const nodeBinary = options.node;
const entry = options.entry;
const temporalAddress = process.env.TEMPORAL_SERVICE_ADDRESS ?? "localhost:7233";
const sizeBudgetMb = Number(process.env.SLIM_SIZE_BUDGET_MB ?? 120);

// When set, run only the checks that need no Temporal server (1–5 above).
// This is the slice a build with no Temporal server at hand runs (the
// desktop's staged-runtime check), so a slim build is never staged without
// at least proving its authenticated boot survived bundling.
const skipTemporalBoots = options["no-temporal"] || process.env.SLIM_VERIFY_SKIP_TEMPORAL === "1";

const BOOT_TIMEOUT_MS = 90_000;

// Dummy credentials for the authenticated-path checks. They never authenticate
// anything: their sole job is to put the runner on its proxy path (a token +
// a proxy). The proxy host is deliberately unroutable — boot completes long
// before any proxy traffic, so it is never dialed.
const DUMMY_TOKEN = "verify-slim-dummy-token";
const DUMMY_PROXY_ENDPOINT = "https://proxy.invalid";

function fail(message) {
  console.error(`verify-slim-artifact: FAIL — ${message}`);
  process.exit(1);
}

if (!existsSync(join(artifactDir, entry))) {
  fail(
    options.artifact
      ? `${join(artifactDir, entry)} not found`
      : "dist-slim/main.js not found — run `npm run build:slim` first",
  );
}

// ─── 1. Size budget ──────────────────────────────────────────────────────────

function runtimeSize(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) {
    return path.endsWith(".map") || path.endsWith("meta.json") ? 0 : stat.size;
  }
  let total = 0;
  for (const entry of readdirSync(path)) {
    total += runtimeSize(join(path, entry));
  }
  return total;
}

const sizeMb = runtimeSize(artifactDir) / 1024 / 1024;
if (sizeMb > sizeBudgetMb) {
  fail(
    `artifact runtime payload is ${sizeMb.toFixed(1)} MB, over the ${sizeBudgetMb} MB budget. ` +
      "A dependency likely grew or escaped the bundle — inspect dist-slim/meta.json before raising the budget.",
  );
}
console.log(`[size]   OK: ${sizeMb.toFixed(1)} MB <= ${sizeBudgetMb} MB (sourcemaps excluded)`);

// ─── Where the runner runs, and where it writes ─────────────────────────────

// runDir holds the artifact the checks boot: an isolated copy, or with
// --in-place the artifact itself. scratchDir takes what the runner writes
// (its workspace and HOME): the copy itself, or with --in-place a directory
// of its own, standing in for the workspace and HOME a driver gives a sandbox.
const scratchDir = mkdtempSync(join(tmpdir(), "stigmer-slim-verify-"));
const runDir = options["in-place"] ? artifactDir : scratchDir;
if (runDir === scratchDir) cpSync(artifactDir, scratchDir, { recursive: true });
const cleanup = () => rmSync(scratchDir, { recursive: true, force: true });
process.on("exit", cleanup);

const baseEnv = {
  ...process.env,
  TEMPORAL_SERVICE_ADDRESS: temporalAddress,
  WORKSPACE_ROOT_DIR: join(scratchDir, "workspace"),
};

function bootRunner(extraEnv) {
  return spawn(nodeBinary, [join(runDir, entry)], {
    cwd: runDir,
    env: { ...baseEnv, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

// ─── Authenticated boot (no Temporal required) ──────────────────────────────

/**
 * Boots manager mode on the authenticated path — token + proxy set — the path
 * every embedder runs and the one stigmer/stigmer#170 broke in the bundle.
 *
 * This needs no Temporal server: an explicit (unroutable) TEMPORAL_SERVICE_ADDRESS
 * makes bootstrap skip control-plane discovery. Success is the deterministic
 * log line emitted, once the harnesses booted, when a proxy is configured but
 * no runner token was minted (runner-manager.ts); we detect it and stop,
 * never reaching the Temporal connection attempt.
 */
async function verifyAuthedBoot() {
  return new Promise((resolve, reject) => {
    const proc = bootRunner({
      STIGMER_RUNNER_MODE: "manager",
      STIGMER_BACKEND_ENDPOINT: "http://localhost:7234",
      STIGMER_TOKEN: DUMMY_TOKEN,
      STIGMER_PROXY_ENDPOINT: DUMMY_PROXY_ENDPOINT,
      // Explicit + unroutable: skips bootstrap discovery and is never dialed
      // because we resolve before the NativeConnection attempt.
      TEMPORAL_SERVICE_ADDRESS: "127.0.0.1:65000",
    });

    let output = "";
    let settled = false;
    const done = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill("SIGKILL");
      fn(arg);
    };

    const timer = setTimeout(
      () => done(reject, new Error(`authenticated boot did not reach the token reconciliation within ${BOOT_TIMEOUT_MS}ms.\n${output.slice(-2000)}`)),
      BOOT_TIMEOUT_MS,
    );

    const onData = (chunk) => {
      output += chunk;
      // Bootstrap resolved and we reached the proxy-token reconciliation,
      // which runs only after the harnesses booted.
      if (/no runner token was minted|Adopted minted proxy token/.test(output)) {
        done(resolve);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);

    proc.on("exit", (code) => {
      // Exit before the signal means it died at init (a missing dependency,
      // a broken boot) — surface the tail so the cause is visible.
      done(reject, new Error(`authenticated boot exited (code ${code}) before the token reconciliation.\n${output.slice(-2000)}`));
    });
  });
}

// ─── Cloud mode (no Temporal required) ──────────────────────────────────────

/**
 * Boots static mode the way a cloud sandbox starts the runner and succeeds at
 * the Temporal dial: the runner logs its mode once its configuration loaded,
 * then dies dialing a sentinel address only this script uses. A fatal error
 * that does not name the sentinel is a load failure before the dial.
 */
const CLOUD_SENTINEL_ADDRESS = "127.0.0.1:65003";

async function verifyCloudMode() {
  return new Promise((resolve, reject) => {
    const proc = bootRunner({
      MODE: "cloud",
      STIGMER_TOKEN: DUMMY_TOKEN,
      STIGMER_BACKEND_ENDPOINT: "http://127.0.0.1:65004",
      STIGMER_TASK_QUEUE: "session:verify-slim",
      TEMPORAL_SERVICE_ADDRESS: CLOUD_SENTINEL_ADDRESS,
      HOME: join(scratchDir, "home"),
    });
    let output = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`cloud mode did not reach the Temporal dial within ${BOOT_TIMEOUT_MS}ms.\n${output.slice(-2000)}`));
    }, BOOT_TIMEOUT_MS);
    proc.stdout.on("data", (chunk) => (output += chunk));
    proc.stderr.on("data", (chunk) => (output += chunk));
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (/Mode: cloud/.test(output) && output.includes(CLOUD_SENTINEL_ADDRESS)) resolve();
      else reject(new Error(`cloud mode exited (code ${code}) before the Temporal dial.\n${output.slice(-2000)}`));
    });
  });
}

// ─── No Claude engine (no Temporal required) ────────────────────────────────

/** A package of Anthropic's engine, by its name under the `@anthropic-ai` scope: the SDK and its per-platform executables. */
const CLAUDE_ENGINE_PACKAGE = /^claude-agent-sdk(-|$)/;

/**
 * Fails when the artifact carries any package of the Claude engine, or its
 * manifest names one. The whole tree is walked, so a copy staged anywhere
 * (a nested node_modules included) is found.
 */
function verifyNoClaudeEngine() {
  const staged = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (basename(dir) === "@anthropic-ai" && CLAUDE_ENGINE_PACKAGE.test(entry.name)) staged.push(path);
      else walk(path);
    }
  };
  walk(artifactDir);
  if (staged.length > 0) throw new Error(`the Claude engine is staged in the artifact: ${staged.join(", ")}`);
  const manifest = join(artifactDir, "package.json");
  if (!existsSync(manifest)) return;
  const pkg = JSON.parse(readFileSync(manifest, "utf8"));
  const named = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).filter((name) => name.startsWith("@anthropic-ai/claude-agent-sdk"));
  if (named.length > 0) throw new Error(`the artifact's manifest names the Claude engine: ${named.join(", ")}`);
}

/**
 * The pin beside the entry: present, well formed, and, when the lockfile is
 * reachable, equal to it. Returns the line the check prints.
 */
function verifyClaudeEnginePin() {
  const file = join(dirname(join(artifactDir, entry)), ENGINE_PIN_FILE);
  if (!existsSync(file)) throw new Error(`${file} is missing: a local runner built from this artifact cannot install the Claude engine`);
  const pin = JSON.parse(readFileSync(file, "utf8"));
  const packages = Object.entries(pin.packages ?? {});
  if (typeof pin.version !== "string" || pin.packages?.[CLAUDE_SDK] === undefined || packages.length < 2) {
    throw new Error(`${file} does not pin ${CLAUDE_SDK} and its platform packages`);
  }
  for (const [name, { resolved, integrity }] of packages) {
    if (!/^https:\/\/registry\.npmjs\.org\//.test(resolved) || !/^sha512-/.test(integrity)) {
      throw new Error(`${file} pins ${name} at ${resolved} (${integrity}), not a registry tarball with a sha512 integrity`);
    }
  }
  const lockfile = fileURLToPath(new URL("../package-lock.json", import.meta.url));
  if (!existsSync(lockfile)) return `pin ${pin.version} (${packages.length} packages); no lockfile beside these scripts to compare`;
  const expected = JSON.stringify(claudeEnginePinFromLockfile(lockfile));
  if (JSON.stringify(pin) !== expected) throw new Error(`${file} differs from the pin ${lockfile} records:\n${expected}`);
  return `pin ${pin.version} (${packages.length} packages) equals the lockfile`;
}

/**
 * 4c: the engine home an image carries. Returns the ready line static mode's
 * boot must print, and the line the check prints.
 */
function verifyClaudeEngineHome(enginesDir) {
  const pin = JSON.parse(readFileSync(join(dirname(join(artifactDir, entry)), ENGINE_PIN_FILE), "utf8"));
  const home = join(enginesDir, "claude", pin.version);
  const platformPackage = `${CLAUDE_SDK}-${process.platform}-${process.arch}`;
  const scope = join(home, "node_modules", "@anthropic-ai");
  if (!existsSync(scope)) throw new Error(`no engine home for the pinned ${pin.version} at ${home}`);
  const held = readdirSync(scope).sort();
  const expected = [CLAUDE_SDK, platformPackage].map((name) => name.slice("@anthropic-ai/".length)).sort();
  if (JSON.stringify(held) !== JSON.stringify(expected)) {
    throw new Error(`the engine home holds ${held.join(", ")}, not exactly ${expected.join(", ")}`);
  }
  for (const name of [CLAUDE_SDK, platformPackage]) {
    const { version } = JSON.parse(readFileSync(join(home, "node_modules", name, "package.json"), "utf8"));
    if (version !== pin.version) throw new Error(`${name} in the engine home is ${version}, not the pinned ${pin.version}`);
  }
  const executable = join(home, "node_modules", platformPackage, process.platform === "win32" ? "claude.exe" : "claude");
  const asAgent = typeof process.getuid === "function" && process.getuid() === 0;
  const [command, args] = asAgent
    ? ["setpriv", [`--reuid=${AGENT_UID}`, `--regid=${AGENT_UID}`, "--clear-groups", executable, "--version"]]
    : [executable, ["--version"]];
  const run = spawnSync(command, args, { encoding: "utf8", cwd: "/", env: { PATH: process.env.PATH, HOME: tmpdir() }, timeout: BOOT_TIMEOUT_MS });
  if (run.status !== 0) {
    throw new Error(`${executable} --version exited ${run.status}${asAgent ? " as the agent user" : ""}: ${`${run.stdout}${run.stderr}`.slice(-1000)}`);
  }
  return {
    readyLine: `[claude] engine ready ${pin.version} (${home})`,
    report: `engine ${pin.version} at ${home}: ${held.join(" and ")}; claude --version exits 0${asAgent ? " as the agent user" : ""} (${run.stdout.trim()})`,
  };
}

// ─── Attach entry (no Temporal required) ────────────────────────────────────

function verifyAttachEntry() {
  const script = fileURLToPath(new URL("./verify-attach-boot.mjs", import.meta.url));
  const artifact = dirname(join(runDir, entry));
  const result = spawnSync(nodeBinary, [script, "--node", nodeBinary, "--artifact", artifact], {
    encoding: "utf8",
    timeout: BOOT_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    throw new Error(`the attach entry failed its boot.\n${`${result.stdout}${result.stderr}`.slice(-2000)}`);
  }
}

// ─── 5b. Agent host (no Temporal required) ──────────────────────────────────

function verifyAgentHost() {
  const script = fileURLToPath(new URL("./verify-agent-host-boot.mjs", import.meta.url));
  const result = spawnSync(nodeBinary, [script, "--node", nodeBinary, "--entry", join(runDir, entry)], {
    encoding: "utf8",
    timeout: BOOT_TIMEOUT_MS,
  });
  if (result.status !== 0) {
    throw new Error(`the agent host failed its boot.\n${`${result.stdout}${result.stderr}`.slice(-2000)}`);
  }
}

// ─── 6. Static mode ──────────────────────────────────────────────────────────

async function verifyStaticMode(readyLine) {
  return new Promise((resolve, reject) => {
    const proc = bootRunner({});
    let output = "";
    let sawRunning = false;

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`static mode did not reach RUNNING within ${BOOT_TIMEOUT_MS}ms.\n${output.slice(-2000)}`));
    }, BOOT_TIMEOUT_MS);

    const onData = (chunk) => {
      output += chunk;
      if (!sawRunning && /state: 'RUNNING'/.test(output)) {
        sawRunning = true;
        proc.kill("SIGINT");
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);

    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (!sawRunning) {
        reject(new Error(`static mode exited (code ${code}) before reaching RUNNING.\n${output.slice(-2000)}`));
      } else if (code !== 0) {
        reject(new Error(`static mode shutdown was not graceful (exit ${code}).\n${output.slice(-2000)}`));
      } else if (readyLine !== undefined && !output.includes(readyLine)) {
        reject(new Error(`static mode's boot did not log the Claude engine ready ("${readyLine}").\n${output.slice(-2000)}`));
      } else {
        resolve();
      }
    });
  });
}

// ─── 7. Manager mode ─────────────────────────────────────────────────────────

async function verifyManagerMode(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const proc = bootRunner({
      STIGMER_RUNNER_MODE: "manager",
      STIGMER_BACKEND_ENDPOINT: "http://localhost:7234",
      ...extraEnv,
    });
    let stdout = "";
    let stderr = "";
    let consumed = 0;
    const expected = ["ready", "sessionAdded", "shutdownComplete"];
    let step = 0;

    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(
        new Error(
          `manager mode stalled waiting for "${expected[step]}" within ${BOOT_TIMEOUT_MS}ms.\n${stderr.slice(-2000)}`,
        ),
      );
    }, BOOT_TIMEOUT_MS);

    const send = (msg) => proc.stdin.write(JSON.stringify(msg) + "\n");

    proc.stdout.on("data", (chunk) => {
      stdout += chunk;
      // Process complete lines exactly once.
      let newlineIdx;
      while ((newlineIdx = stdout.indexOf("\n", consumed)) !== -1) {
        const line = stdout.slice(consumed, newlineIdx).trim();
        consumed = newlineIdx + 1;
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === "error") {
          clearTimeout(timer);
          proc.kill("SIGKILL");
          reject(new Error(`manager mode IPC error: ${line}`));
          return;
        }
        if (msg.type !== expected[step]) continue;
        step += 1;
        if (msg.type === "ready") {
          send({ type: "addSession", sessionId: "verify-slim" });
        } else if (msg.type === "sessionAdded") {
          send({ type: "shutdown" });
        }
      }
    });
    proc.stderr.on("data", (chunk) => (stderr += chunk));

    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (step === expected.length && code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `manager mode exited with code ${code} at step ${step}/${expected.length} (${expected.join(" → ")}).\n` +
              stderr.slice(-2000),
          ),
        );
      }
    });
  });
}

try {
  // Runs everywhere (no Temporal needed): proves the authenticated boot path —
  // the one every embedder runs and the one that regressed in #170 — survives
  // bundling. This is the check the dev-publish fast path relies on.
  await verifyAuthedBoot();
  console.log("[guard]  OK: the authenticated boot reached the proxy-token reconciliation");
  // Cloud mode and the attach waiter run only in Linux sandboxes; Windows
  // (the desktop's release leg runs this script there) has neither, and its
  // Node cannot deliver SIGTERM as a signal, so both are skipped there.
  const windows = process.platform === "win32";
  if (windows) {
    console.log("[cloud]  skipped on Windows: cloud mode runs only in Linux sandboxes");
  } else {
    await verifyCloudMode();
    console.log("[cloud]  OK: MODE=cloud loaded its configuration and reached the Temporal dial");
  }
  verifyNoClaudeEngine();
  console.log("[claude] OK: no package of the Claude engine is staged and the manifest names none");
  console.log(`[claude] OK: ${verifyClaudeEnginePin()}`);
  const engineHome = options["claude-engines"] === undefined ? undefined : verifyClaudeEngineHome(options["claude-engines"]);
  if (engineHome !== undefined) console.log(`[claude] OK: ${engineHome.report}`);
  if (windows) {
    console.log("[attach] skipped on Windows: the attach waiter runs only in Linux sandboxes");
  } else {
    verifyAttachEntry();
    console.log("[attach] OK: the attach entry served readiness, refused a foreign push and stopped cleanly");
  }
  verifyAgentHost();
  console.log("[host]   OK: the entry started as the agent host announced itself on its pipe and exited when it closed");

  if (skipTemporalBoots) {
    console.log("verify-slim-artifact: PASS (checks 1–5; Temporal boots skipped via --no-temporal)");
  } else {
    await verifyStaticMode(engineHome?.readyLine);
    console.log(`[static] OK: worker reached RUNNING and shut down gracefully${engineHome === undefined ? "" : ", its boot logging the Claude engine ready"}`);
    await verifyManagerMode();
    console.log("[mgr]    OK: ready → addSession → shutdown lifecycle, exit 0");
    // Same lifecycle, but on the authenticated path (token + proxy): the full
    // ready→addSession→shutdown lifecycle still completes against Temporal —
    // proving the auth path the verify gate previously never exercised (#170).
    // The OTLP endpoint makes the manager build its OTel interceptors, the
    // boot that died in the slim artifact (stigmer/stigmer#1810). Unreachable
    // on purpose: what matters is that the interceptors load, not that
    // anything exports.
    await verifyManagerMode({
      STIGMER_TOKEN: DUMMY_TOKEN,
      STIGMER_PROXY_ENDPOINT: DUMMY_PROXY_ENDPOINT,
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:65005",
    });
    console.log("[mgr+auth] OK: authenticated manager lifecycle with an OTLP endpoint booted end-to-end against Temporal");
    console.log("verify-slim-artifact: PASS");
  }
} catch (err) {
  fail(err.message);
}
