/**
 * The hermetic stage a real coding agent meets Stigmer on, shared by the
 * coding-agent door (test/install/coding-agent-door.mjs) and the coding-agent
 * question bank (test/install/coding-agent-bank.mjs), so the house keeps one
 * copy of it rather than two that drift.
 *
 * All on this machine, and hermetic on Stigmer's side:
 *   - test/support's fake model (lib/fake-model.mjs), answering every
 *     unscripted call with `replyText`;
 *   - test/support's hermetic issuer, and a server from the built shipped
 *     entry that signs its callers in through it and announces a native
 *     client (so `stigmer auth login` finds it); with `local`, a server that
 *     trusts every caller instead, as `stigmer up` does;
 *   - Temporal, and a runner whose model is the fake;
 *   - a `stigmer` on PATH (the shim, in `binDir`) that runs `cliCommand`
 *     with the stage's own HOME (`cliHome`: the CLI's config lives under
 *     HOME, with no other override) and a stand-in `BROWSER` that follows
 *     the authorize address, so the issuer's auto-consent finishes a
 *     sign-in. The shim drops ANTHROPIC_API_KEY: a coding agent's own model
 *     key is never the CLI's.
 *
 * The shim also works inside `claude plugin eval`'s sandbox, where a coding
 * agent's shell commands may read only the directories on PATH (and below
 * them), write only the try's own folders, and reach the network only
 * through the run's HTTP proxy (2026-11, Claude Code 2.1.326):
 *   - where `cliHome` cannot be written, it copies the signed-in config
 *     into the caller's own HOME once and runs there (the hermetic issuer's
 *     refresh tokens do not rotate, so every copy stays signed in);
 *   - where a proxy is named, Node's own proxy support is turned on for the
 *     CLI's HTTP calls (a token refresh) and the preload
 *     lib/loopback-through-proxy.mjs, copied into `binDir` so the sandbox
 *     can read it, carries its HTTP/2 calls to the stage. Elsewhere both
 *     do nothing.
 * A caller whose coding agent runs sandboxed puts `binDir`, `cliHome` and
 * the CLI it names in `cliCommand` inside one directory on PATH, outside the
 * system's temporary folders, which the sandbox never reads.
 *
 * Nothing of the person's own Stigmer config is read or written: everything
 * lives under `scratch`, which the caller owns and removes. The server's and
 * runner's logs are kept there (server.log, runner.log), since a run's side
 * of a failure exists nowhere else after teardown.
 *
 * `stop()` tears down what started, in reverse order, and is safe to call
 * after a start that failed part-way (startHermeticStage stops what it had
 * started before it rethrows).
 */

import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startLocalOidcIssuer } from "../../support/src/local-oidc-issuer.ts";
import { runnerEntryPath } from "../../support/src/runner-build.ts";
import { spawnRunner } from "../../support/src/runner-process.ts";
import { spawnServer } from "../../support/src/server-process.ts";
import { spawnTemporal } from "../../support/src/temporal.ts";
import { tsServerEntryPath } from "../../support/src/ts-build.ts";
import { fakeModelEnv, startFakeModel } from "./fake-model.mjs";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");

/** This checkout's CLI, run from source through the workspace's tsx on this Node: the shim's default command. */
export const SOURCE_CLI_COMMAND = `'${process.execPath}' '${tsxBin}' '${join(repoRoot, "client-apps", "cli", "src", "cli", "stigmer.ts")}'`;

/** The preload that carries the CLI's loopback connections through a sandbox's proxy. */
const LOOPBACK_PRELOAD = fileURLToPath(new URL("./loopback-through-proxy.mjs", import.meta.url));

/** What a built stage needs on disk: each entry's name and path, for a refusal that says what to build. */
export function stageBuildPaths() {
  return [
    ["server", tsServerEntryPath()],
    ["runner", runnerEntryPath()],
    ["tsx", tsxBin],
  ];
}

/**
 * The stand-in browser: it opens the authorize address and follows its one
 * redirect, which is all the hermetic issuer's auto-consent needs.
 */
const FOLLOWER = `
const [url] = process.argv.slice(2);
const authorize = await fetch(url, { redirect: "manual" });
const location = authorize.headers.get("location");
if (location !== null) await fetch(location);
`;

/** The environment keys that would point a CLI or a coding agent somewhere other than the stage. */
export const STAGE_SCRUBBED_ENV = ["STIGMER_SERVER_ADDRESS", "STIGMER_API_KEY", "STIGMER_ORG", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"];

/** The folder under a sandboxed caller's HOME that the shim copies the stage's sign-in into. */
export const SANDBOX_HOME = ".stigmer-stage";

/**
 * The shim's text (the module comment says what it does). Every path is
 * single-quoted, so none may hold a single quote.
 * @param {{ cliHome: string, follower: string, preload: string, node: string, cliCommand: string }} paths
 */
export function stageShim({ cliHome, follower, preload, node, cliCommand }) {
  for (const path of [cliHome, follower, preload, node]) {
    if (path.includes("'")) throw new Error(`the stage's shim cannot quote a path holding a single quote: ${path}`);
  }
  return [
    "#!/bin/sh",
    "unset ANTHROPIC_API_KEY",
    `home='${cliHome}'`,
    `if ( : > "$home/.stigmer-write-check" ) 2>/dev/null; then rm -f "$home/.stigmer-write-check"; else`,
    `  copy="$HOME/${SANDBOX_HOME}"`,
    // The copy is the caller's to write (a token refresh), whatever mode the stage's home has.
    `  [ -d "$copy/.stigmer" ] || { mkdir -p "$copy" && cp -R "$home/.stigmer" "$copy/" && chmod -R u+w "$copy/.stigmer"; }`,
    `  home="$copy"`,
    "fi",
    'if [ -n "${HTTPS_PROXY:-${HTTP_PROXY:-}}" ]; then export NODE_USE_ENV_PROXY=1 NO_PROXY= no_proxy=; fi',
    `HOME="$home" BROWSER='"${node}" "${follower}"' NODE_OPTIONS="--import=${pathToFileURL(preload).href} --disable-warning=UNDICI-EHPA\${NODE_OPTIONS:+ $NODE_OPTIONS}" exec ${cliCommand} "$@"`,
    "",
  ].join("\n");
}

/**
 * Start the stage under `scratch`.
 *
 * @param {{
 *   scratch: string,
 *   audience: string,
 *   nativeClientId: string,
 *   local?: boolean,
 *   replyText?: string,
 *   cliCommand?: string,
 *   binDir?: string,
 *   cliHome?: string,
 * }} opts
 * `cliCommand` is a shell word list the shim execs (this checkout's CLI by
 * default; the door's `--published` walk and the bank pass an installed
 * one). `binDir` and `cliHome` default to folders under `scratch`.
 */
export async function startHermeticStage({
  scratch,
  audience,
  nativeClientId,
  local = false,
  replyText,
  cliCommand = SOURCE_CLI_COMMAND,
  binDir = join(scratch, "bin"),
  cliHome = join(scratch, "cli-home"),
}) {
  for (const dir of [cliHome, binDir]) mkdirSync(dir, { recursive: true });

  const started = [];
  const stop = async () => {
    for (const close of started.splice(0).reverse()) await close();
  };
  try {
    const fake = await startFakeModel(replyText === undefined ? {} : { replyText });
    started.push(() => fake.close());
    const issuer = await startLocalOidcIssuer({ audience });
    started.push(() => issuer.close());
    const temporal = await spawnTemporal();
    started.push(() => temporal.stop());
    const server = await spawnServer(process.execPath, {
      args: [tsServerEntryPath()],
      temporalHostPort: temporal.hostPort,
      env: local
        ? {}
        : {
            STIGMER_OIDC_ISSUER: issuer.issuer,
            STIGMER_OIDC_AUDIENCE: audience,
            STIGMER_OIDC_NATIVE_CLIENT_ID: nativeClientId,
          },
      logFile: join(scratch, "server.log"),
    });
    started.push(() => server.stop());
    const runner = await spawnRunner({
      entryPath: runnerEntryPath(),
      temporalHostPort: temporal.hostPort,
      backendEndpoint: server.baseUrl,
      registryOrigin: server.baseUrl,
      artifactDir: server.artifactBaseDir,
      env: fakeModelEnv(fake),
      logFile: join(scratch, "runner.log"),
    });
    started.push(() => runner.stop());

    const follower = join(binDir, "browser.mjs");
    writeFileSync(follower, FOLLOWER);
    const preload = join(binDir, "loopback-through-proxy.mjs");
    copyFileSync(LOOPBACK_PRELOAD, preload);
    const stigmer = join(binDir, "stigmer");
    writeFileSync(stigmer, stageShim({ cliHome, follower, preload, node: process.execPath, cliCommand }));
    chmodSync(stigmer, 0o755);

    return {
      fake,
      issuer,
      server,
      runner,
      cliHome,
      binDir,
      /** The shim's path: the `stigmer` every caller on the stage runs. */
      stigmer,
      /**
       * `base` with the shim first on PATH and every key that would point
       * elsewhere removed; `extraPath` entries follow the shim.
       */
      env(base = process.env, extraPath = []) {
        const env = { ...base, PATH: [binDir, ...extraPath, base.PATH ?? ""].join(":") };
        for (const key of STAGE_SCRUBBED_ENV) delete env[key];
        return env;
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
