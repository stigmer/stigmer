/**
 * Installs the sandbox's Environment packages: started once at boot, beside
 * the worker rather than before it (a turn's activity must start within its
 * schedule-to-start window), and awaited by each turn's setup
 * (`harness/run-turn.ts`, the `environment` phase) under the turn's
 * periodic heartbeat.
 *
 * Who runs what (a package's install script is third-party code):
 *   - apt runs as root, with an allow-listed environment: Debian's archive
 *     is signed and its maintainer scripts are the base image's own trust.
 *   - cargo, gem, go, npm and pip run as the agent's own user
 *     (`shared/agent-identity.ts` setprivArgs), with the agent host's
 *     allow-listed environment plus the agent's HOME and the CA variables
 *     the sandbox sets, into an agent-owned prefix,
 *     `/opt/stigmer/environment`: an npm `postinstall` gets exactly the
 *     rights the agent's own `npm install` would, and never runs as root
 *     beside the runner's credentials. The prefix's `bin` (and its Python
 *     venv's) is put first on the agent host's PATH (`environment.ts`), so
 *     the agent's shell and the commands Cursor starts both find them; the
 *     runner's own PATH is never touched.
 *
 * Each entry is argv, never a shell word; the contract's grammar keeps out
 * options, URLs, git sources and paths (`spec.ts`). Managers run in the
 * order apt, cargo, gem, go, npm, pip. A manager the image lacks fails the
 * install naming what to add. Each command has a deadline and the whole
 * install another; past either it is killed and the install fails, saying
 * so, as `run-turn.ts` requires of every wait under its heartbeat.
 *
 * A command that exits non-zero runs once more after a short pause, while
 * the install has time left for it: a registry can fail one fetch, and
 * Agent Substrate's gateway can refuse an allowed host in a sandbox's first
 * seconds (stigmer#2413). A second failure fails the install with both
 * outputs' tails. A command killed at its deadline is not retried.
 *
 * It runs once per package set: after a clean install the set's digest is
 * written beside the prefix, in its parent (`/opt/stigmer`, root's), never
 * inside it: the prefix is the agent's, so a file the root runner wrote
 * there could be a link the agent planted at any file root may write. A
 * runner that starts again over the same files (a docker restart, a
 * Substrate thaw) skips a matching set.
 *
 * Times go to the log and to an `environment.install` span per manager.
 *
 * Tests: __tests__/install.test.ts.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chownSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { trace } from "@opentelemetry/api";

import { agentHostEnvironment } from "../agent-host/environment.js";
import { TRACER_NAME } from "../gen-ai-conventions.js";
import { agentIdentity, programOnPath, setprivArgs, type AgentIdentity } from "../shared/agent-identity.js";
import { environmentPathEntries, environmentPrefix } from "./prefix.js";
import { hasPackages, MANAGERS, type Manager, type PackageSet, type SandboxEnvironment } from "./spec.js";

export { ENVIRONMENT_PREFIX, environmentPathEntries, environmentPrefix } from "./prefix.js";

/** The whole install's deadline: past it the install is killed and fails. */
export const ENVIRONMENT_INSTALL_DEADLINE_MS = 15 * 60_000;
/** One command's deadline. */
export const COMMAND_DEADLINE_MS = 10 * 60_000;
/** The pause before a failed command's one retry. */
export const RETRY_PAUSE_MS = 2_000;
/** How much of a failed command's output the failure carries. */
export const OUTPUT_TAIL_BYTES = 4096;
/** The file beside the prefix that names the set installed in it. */
const DIGEST_SUFFIX = ".digest";

/** The CA variables a sandbox's tools trust its gateway by; outside the host's allow-list, added for the install alone. */
const TRUST_VARIABLES = ["SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "GIT_SSL_CAINFO"] as const;
/** The names apt runs with, besides those. */
const APT_NAMES = ["PATH", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy"] as const;

/** The program each manager needs, and what to add when the image lacks it. */
const PROGRAMS: { readonly [M in Manager]: { readonly program: string; readonly remedy: string } } = {
  apt: { program: "apt-get", remedy: "use a Debian or Ubuntu based image" },
  cargo: { program: "cargo", remedy: "add cargo to the environment's apt packages, or use an image with Rust" },
  gem: { program: "gem", remedy: "add ruby-full to the environment's apt packages, or use an image with Ruby" },
  go: { program: "go", remedy: "add golang-go to the environment's apt packages, or use an image with Go" },
  npm: { program: "npm", remedy: "add npm to the environment's apt packages, or use an image with Node.js" },
  pip: { program: "python3", remedy: "add python3-venv to the environment's apt packages, or use an image with Python" },
};

/** One command of the install. */
export interface InstallCommand {
  readonly manager: Manager;
  readonly argv: readonly string[];
  /** Run as the agent's own user (every manager but apt). */
  readonly asAgent: boolean;
  /** The variables the manager needs beside the base environment. */
  readonly env: Readonly<Record<string, string>>;
}


/** A failed install: the manager, how it ended, and the tail of its output. */
export class EnvironmentInstallError extends Error {
  constructor(
    readonly manager: Manager,
    readonly detail: string,
    readonly output: string,
  ) {
    super(`the environment's ${manager} packages did not install: ${detail}${output === "" ? "" : `\n${output}`}`);
    this.name = "EnvironmentInstallError";
  }
}

/** The digest naming a package set. */
export function packageDigest(packages: PackageSet): string {
  return createHash("sha256")
    .update(JSON.stringify(MANAGERS.map((manager) => [manager, [...packages[manager]]])))
    .digest("hex");
}

/** A gem entry's name and, when pinned, its version. */
function gemSpec(entry: string): { readonly name: string; readonly version?: string } {
  const colon = entry.indexOf(":");
  return colon < 0 ? { name: entry } : { name: entry.slice(0, colon), version: entry.slice(colon + 1) };
}

/** The commands that install a set, in the managers' order. */
export function installCommands(packages: PackageSet, prefix: string): InstallCommand[] {
  const commands: InstallCommand[] = [];
  const bin = join(prefix, "bin");
  if (packages.apt.length > 0) {
    const env = { DEBIAN_FRONTEND: "noninteractive" };
    commands.push({ manager: "apt", argv: ["apt-get", "update"], asAgent: false, env });
    commands.push({ manager: "apt", argv: ["apt-get", "install", "-y", "--no-install-recommends", "--", ...packages.apt], asAgent: false, env });
  }
  if (packages.cargo.length > 0) {
    commands.push({ manager: "cargo", argv: ["cargo", "install", "--root", prefix, ...packages.cargo], asAgent: true, env: { CARGO_HOME: join(prefix, "cargo") } });
  }
  if (packages.gem.length > 0) {
    const unpinned = packages.gem.map(gemSpec).filter((gem) => gem.version === undefined).map((gem) => gem.name);
    const gemArgs = ["gem", "install", "--no-document", "--install-dir", join(prefix, "gem"), "--bindir", bin];
    const env = { GEM_HOME: join(prefix, "gem") };
    if (unpinned.length > 0) commands.push({ manager: "gem", argv: [...gemArgs, ...unpinned], asAgent: true, env });
    for (const gem of packages.gem.map(gemSpec)) {
      if (gem.version !== undefined) commands.push({ manager: "gem", argv: [...gemArgs, gem.name, "-v", gem.version], asAgent: true, env });
    }
  }
  for (const module of packages.go) {
    commands.push({
      manager: "go",
      argv: ["go", "install", module],
      asAgent: true,
      env: { GOBIN: bin, GOPATH: join(prefix, "go"), GOCACHE: join(prefix, "go", "cache") },
    });
  }
  if (packages.npm.length > 0) {
    commands.push({
      manager: "npm",
      argv: ["npm", "install", "--global", "--prefix", prefix, "--no-fund", "--no-audit", "--", ...packages.npm],
      asAgent: true,
      env: {},
    });
  }
  if (packages.pip.length > 0) {
    const venv = join(prefix, "python");
    commands.push({ manager: "pip", argv: ["python3", "-m", "venv", "--system-site-packages", venv], asAgent: true, env: {} });
    commands.push({
      manager: "pip",
      argv: [join(venv, "bin", "pip"), "install", "--disable-pip-version-check", "--", ...packages.pip],
      asAgent: true,
      env: {},
    });
  }
  return commands;
}

/** The environment one command runs with (the module header). */
export function commandEnvironment(
  command: InstallCommand,
  source: NodeJS.ProcessEnv,
  identity: AgentIdentity | null,
  prefix: string,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  if (command.asAgent) {
    Object.assign(env, agentHostEnvironment(source, identity !== null));
    if (identity !== null) env["HOME"] = identity.home;
  } else {
    for (const name of APT_NAMES) if (source[name] !== undefined) env[name] = source[name];
  }
  for (const name of TRUST_VARIABLES) if (source[name] !== undefined) env[name] = source[name];
  // The prefix is the agent's to write: only a command that runs as the
  // agent finds programs there. A root command keeps the system's PATH, so
  // neither apt nor a maintainer script it runs can pick up a binary the
  // agent planted.
  env["PATH"] = command.asAgent ? [...environmentPathEntries(prefix), source["PATH"] ?? ""].join(delimiter) : (source["PATH"] ?? "");
  return { ...env, ...command.env };
}

/** How one command ended. */
export interface CommandResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly output: string;
}

/** What runs one command; the tests stand one in. */
export type CommandRunner = (argv: readonly string[], env: NodeJS.ProcessEnv, deadlineMs: number) => Promise<CommandResult>;

/** Runs a command in a process group of its own, killed whole at its deadline; keeps its output's tail. */
export const spawnCommand: CommandRunner = (argv, env, deadlineMs) =>
  new Promise((resolve) => {
    const [program, ...args] = argv;
    let tail = "";
    let timedOut = false;
    const child = spawn(program ?? "", args, { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    const keep = (chunk: Buffer): void => {
      tail = (tail + chunk.toString("utf8")).slice(-OUTPUT_TAIL_BYTES);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, deadlineMs);
    child.on("error", (err) => keep(Buffer.from(err.message)));
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, timedOut, output: tail });
    });
  });

/** What one install reads; every field defaults to this process's. */
export interface InstallDeps {
  readonly identity?: AgentIdentity | null;
  readonly prefix?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly run?: CommandRunner;
  readonly now?: () => number;
  readonly deadlineMs?: number;
  readonly log?: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** How a command's exit reads in a sentence. */
function exitOf(result: CommandResult): string {
  return result.exitCode === null ? "on a signal" : String(result.exitCode);
}

/** Installs the set, or skips one already installed in the prefix; throws EnvironmentInstallError. */
export async function installEnvironment(environment: SandboxEnvironment, deps: InstallDeps = {}): Promise<"installed" | "already-installed" | "nothing"> {
  const { packages } = environment;
  if (!hasPackages(packages)) return "nothing";
  const identity = deps.identity === undefined ? agentIdentity() : deps.identity;
  const prefix = deps.prefix ?? environmentPrefix(identity);
  const env = deps.env ?? process.env;
  const run = deps.run ?? spawnCommand;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((line: string) => console.log(line));
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + (deps.deadlineMs ?? ENVIRONMENT_INSTALL_DEADLINE_MS);
  const digest = packageDigest(packages);
  const digestFile = `${prefix}${DIGEST_SUFFIX}`;
  if (existsSync(digestFile) && readFileSync(digestFile, "utf8").trim() === digest) {
    log(`[environment] packages already installed (${digest.slice(0, 12)})`);
    return "already-installed";
  }
  mkdirSync(prefix, { recursive: true });
  if (identity !== null) chownSync(prefix, identity.uid, identity.gid);

  const commands = installCommands(packages, prefix);
  const tracer = trace.getTracer(TRACER_NAME);
  for (const manager of MANAGERS) {
    const own = commands.filter((command) => command.manager === manager);
    if (own.length === 0) continue;
    const { program, remedy } = PROGRAMS[manager];
    if (programOnPath(program, env["PATH"] ?? "") === undefined) {
      throw new EnvironmentInstallError(manager, `this sandbox's image has no ${program}; ${remedy}`, "");
    }
    if (manager === "apt" && identity === null && process.getuid?.() !== 0) {
      throw new EnvironmentInstallError(manager, "apt packages install as root, and this runner does not run as root", "");
    }
    const span = tracer.startSpan("environment.install", { attributes: { "stigmer.environment.manager": manager, "stigmer.environment.packages": packages[manager].length } });
    const started = now();
    try {
      for (const command of own) {
        const label = `\`${command.argv.slice(0, 2).join(" ")}\``;
        // Root starts every program by the absolute path its own PATH gives
        // (setpriv, or apt's): never through the PATH it hands the child,
        // which for an agent command leads with the agent's own folders.
        const argv = rootArgv(command, identity, env["PATH"] ?? "");
        const commandEnv = commandEnvironment(command, env, identity, prefix);
        let failed: CommandResult | undefined;
        for (;;) {
          const left = deadline - now();
          if (left <= 0) {
            throw new EnvironmentInstallError(manager, `the install passed its ${Math.round((deps.deadlineMs ?? ENVIRONMENT_INSTALL_DEADLINE_MS) / 60_000)}-minute deadline`, "");
          }
          const result = await run(argv, commandEnv, Math.min(COMMAND_DEADLINE_MS, left));
          if (result.timedOut) {
            throw new EnvironmentInstallError(manager, `${label} was killed at its deadline`, result.output);
          }
          if (result.exitCode === 0) break;
          if (failed !== undefined) {
            throw new EnvironmentInstallError(manager, `${label} exited ${exitOf(failed)}, then ${exitOf(result)} on its retry`, `${failed.output}\n--- the retry ---\n${result.output}`);
          }
          if (deadline - now() <= RETRY_PAUSE_MS) {
            throw new EnvironmentInstallError(manager, `${label} exited ${exitOf(result)}`, result.output);
          }
          log(`[environment] ${label} exited ${exitOf(result)}; retrying once`);
          failed = result;
          await sleep(RETRY_PAUSE_MS);
        }
      }
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
    log(`[environment] ${manager}: ${packages[manager].length} package(s) installed in ${now() - started} ms`);
  }
  writeFileSync(digestFile, `${digest}\n`);
  return "installed";
}

/** What root runs for one command: setpriv by its absolute path before an agent's command, a root command's program by its own. */
export function rootArgv(command: InstallCommand, identity: AgentIdentity | null, rootPath: string): readonly string[] {
  if (command.asAgent && identity !== null) {
    const setpriv = programOnPath("setpriv", rootPath);
    if (setpriv === undefined) {
      throw new EnvironmentInstallError(command.manager, "this sandbox's image has no setpriv to start the install as the agent", "");
    }
    return [setpriv, ...setprivArgs(identity), "--", ...command.argv];
  }
  if (command.asAgent) return command.argv;
  const [program, ...args] = command.argv;
  const resolved = program === undefined ? undefined : programOnPath(program, rootPath);
  if (resolved === undefined) {
    throw new EnvironmentInstallError(command.manager, `this sandbox's image has no ${program ?? "program"}`, "");
  }
  return [resolved, ...args];
}

/** The install this runner started at boot; `undefined` until then, and when the sandbox has no Environment. */
let started: Promise<void> | undefined;

/** Starts the install once, in the background; a failure is kept for the turns that await it. */
export function startEnvironmentInstall(environment: SandboxEnvironment | undefined, deps: InstallDeps = {}): void {
  if (environment === undefined || started !== undefined) return;
  const promise = installEnvironment(environment, deps).then(() => undefined);
  // Observed here so an install no turn awaits yet is never an unhandled
  // rejection; each turn awaits the same promise and meets the failure.
  promise.catch((err: unknown) => console.error(`[environment] ${err instanceof Error ? err.message : String(err)}`));
  started = promise;
}

/** What a turn awaits: the boot's install, or nothing when there is none. */
export function environmentInstalled(): Promise<void> {
  return started ?? Promise.resolve();
}

/** Forgets the started install; the tests' alone. */
export function resetEnvironmentInstallForTests(): void {
  started = undefined;
}
