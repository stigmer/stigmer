/**
 * Where a runner's Claude engine comes from, and which one it runs.
 *
 * The engine is Anthropic's two npm packages exactly as published: the Agent
 * SDK (`@anthropic-ai/claude-agent-sdk`, whose root entry imports only Node
 * built-ins) and its per-platform package holding the `claude` executable,
 * which the SDK resolves from its own location. A directory whose
 * `node_modules/@anthropic-ai` holds the two is a complete engine. An ENGINE
 * HOME is one such directory per version, `<root>/claude/<version>`.
 *
 * {@link findClaudeEngine} looks in two places, in order:
 *
 *  1. The runner's own install: the bare import, resolved from the runner's
 *     location. This is the engine a dev checkout, the test kits and an
 *     embedder that installed the SDK beside `@stigmer/runner` load. It comes
 *     first so a developer's tests never read a home a desktop app or
 *     `stigmer up` on the same machine left behind.
 *  2. The home under the engines root ({@link enginesRoot}):
 *     `STIGMER_ENGINES_DIR` when the deployment sets it, else
 *     `~/.stigmer/engines` beside `stigmer up`'s runtimes, where a local
 *     runner installs the engine on its first Claude turn
 *     (`engine-fetch.ts`).
 *
 * THE PIN. A published runner carries `claude-engine.json` beside its entry
 * (`scripts/bundle-slim.mjs` writes it from the runner's lockfile): the SDK's
 * version and, for the SDK and every platform package, the registry URL and
 * the integrity npm recorded. An engine whose version differs from the pin is
 * skipped and named, the runner's own install included: a runner runs only
 * the engine it was tested with. A runner with no pin file (a dev checkout,
 * the full `@stigmer/runner` package, whose optional peer npm holds to the
 * exact version) loads its own install unchecked and has no home: without a
 * pin it cannot name one, and cannot verify a download.
 *
 * Anthropic's conditions bind this code (`harness/README.md`, "The Claude
 * engine"): the engine's bytes are never changed, re-signed or repacked, so
 * a home holds the packages exactly as npm serves them.
 *
 * Node built-ins and the agent identity only: the adapter's static graph
 * stays SDK-free (`__tests__/adapter-graph-is-sdk-free.test.ts`).
 */

import { closeSync, existsSync, openSync, readFileSync, utimesSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { agentStateHome } from "../../shared/agent-identity.js";

/** The Agent SDK's package name: the engine's entry. */
export const CLAUDE_SDK = "@anthropic-ai/claude-agent-sdk";

/** The pin file a published runner carries beside its entry. */
export const ENGINE_PIN_FILE = "claude-engine.json";

/** Names the engines root. */
export const ENGINES_DIR_ENV = "STIGMER_ENGINES_DIR";

/** The file a load touches in a home, so an install never prunes a home some runner still uses. */
export const LAST_USED_FILE = "last-used";

/** Where a published package is fetched from and what its bytes hash to, as npm's lockfile records them. */
export interface PinnedPackage {
  readonly resolved: string;
  readonly integrity: string;
}

/** The engine a runner was tested with (`claude-engine.json`). */
export interface ClaudeEnginePin {
  readonly version: string;
  /** The SDK and every platform package, by package name. */
  readonly packages: Readonly<Record<string, PinnedPackage>>;
}

/** The pin file beside the running entry: the bundle's `main.js` in a published runner. */
export const ENGINE_PIN_URL = new URL(`./${ENGINE_PIN_FILE}`, import.meta.url);

/**
 * The pin at `file`, or `null` when there is none. Throws, naming the file,
 * when it exists but is not a pin: a published runner with a broken pin is a
 * build defect, and the adapter refuses Claude on it rather than guess.
 */
export function readEnginePin(file: string | URL = ENGINE_PIN_URL): ClaudeEnginePin | null {
  const path = typeof file === "string" ? file : fileURLToPath(file);
  if (!existsSync(path)) return null;
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isPin(parsed)) throw new Error(`${path} is not a Claude engine pin (a version and its packages' resolved URLs and integrity)`);
  if (parsed.packages[CLAUDE_SDK] === undefined) throw new Error(`${path} pins no ${CLAUDE_SDK}`);
  return parsed;
}

function isPin(value: unknown): value is ClaudeEnginePin {
  if (typeof value !== "object" || value === null) return false;
  const { version, packages } = value as { version?: unknown; packages?: unknown };
  if (typeof version !== "string" || version === "" || typeof packages !== "object" || packages === null) return false;
  return Object.values(packages).every(
    (entry: unknown) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as { resolved?: unknown }).resolved === "string" &&
      typeof (entry as { integrity?: unknown }).integrity === "string",
  );
}

/** The directory engine homes hang from: `STIGMER_ENGINES_DIR`, else `<home>/.stigmer/engines`. */
export function enginesRoot(env: NodeJS.ProcessEnv = process.env, home: string = agentStateHome()): string {
  const named = env[ENGINES_DIR_ENV]?.trim();
  return named !== undefined && named !== "" ? named : join(home, ".stigmer", "engines");
}

/** One version's engine home under `root`. */
export function engineHomeDir(root: string, version: string): string {
  return join(root, "claude", version);
}

/** Where a machine is, for choosing its platform package. */
export interface PlatformFacts {
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  /** Linux without glibc (Alpine and the like). */
  readonly musl: boolean;
}

/** This process's platform facts. */
export function currentPlatform(): PlatformFacts {
  return { platform: process.platform, arch: process.arch, musl: process.platform === "linux" && isMusl() };
}

// The SDK's own rule (its resolver, `preferMusl`): a Linux whose process
// report names no glibc runtime is musl.
function isMusl(): boolean {
  const report = process.report.getReport() as { header?: { glibcVersionRuntime?: string } };
  return report.header?.glibcVersionRuntime === undefined;
}

/**
 * The platform packages this machine's engine may come from, in the order the
 * SDK tries them: on Linux the libc's own first and the other second, else the
 * one for the platform and arch. The first is the one a download fetches.
 */
export function platformPackages(facts: PlatformFacts): readonly string[] {
  if (facts.platform === "linux") {
    const glibc = `${CLAUDE_SDK}-linux-${facts.arch}`;
    const musl = `${glibc}-musl`;
    return facts.musl ? [musl, glibc] : [glibc, musl];
  }
  return [`${CLAUDE_SDK}-${facts.platform}-${facts.arch}`];
}

/** The executable's file name inside a platform package. */
export function engineExecutable(platform: NodeJS.Platform): string {
  return platform === "win32" ? "claude.exe" : "claude";
}

/** An engine the runner can load: the SDK's entry, its version, and where it was found. */
export interface FoundEngine {
  /** The SDK's resolved entry file. */
  readonly entry: string;
  readonly version: string;
  /** The home it lives in, or `null` for the runner's own install. */
  readonly home: string | null;
}

/** What a search found, and every engine it passed over with the reason. */
export type EngineSearch =
  | { readonly kind: "found"; readonly engine: FoundEngine; readonly skipped: readonly string[] }
  | { readonly kind: "missing"; readonly skipped: readonly string[] };

export interface FindEngineOptions {
  /** The runner's pin, or `null` for a runner without one. */
  readonly pin: ClaudeEnginePin | null;
  /** The engines root ({@link enginesRoot}). */
  readonly root: string;
  /** The SDK's entry as the runner's own install resolves it, or `null` when it does not. */
  readonly resolveFromRunner?: () => string | null;
  readonly platform?: PlatformFacts;
}

/** The SDK's entry, resolved from the runner's own location (or `from`); `null` when there is no install of it there. */
export function resolveFromRunner(from: string | URL = import.meta.url): string | null {
  try {
    return createRequire(from).resolve(CLAUDE_SDK);
  } catch {
    return null;
  }
}

/** Finds the engine this runner runs, by the order in the module header. */
export function findClaudeEngine(options: FindEngineOptions): EngineSearch {
  const skipped: string[] = [];
  const { pin } = options;

  const own = (options.resolveFromRunner ?? resolveFromRunner)();
  if (own !== null) {
    const version = sdkVersion(own);
    if (pin === null || version === pin.version) return { kind: "found", engine: { entry: own, version, home: null }, skipped };
    skipped.push(`the runner's own install holds ${version}, not the pinned ${pin.version}`);
  }
  if (pin === null) return { kind: "missing", skipped };

  const home = engineHomeDir(options.root, pin.version);
  if (!existsSync(home)) return { kind: "missing", skipped };
  const found = readHome(home, pin.version, options.platform ?? currentPlatform());
  if (typeof found === "string") {
    skipped.push(`${home}: ${found}`);
    return { kind: "missing", skipped };
  }
  return { kind: "found", engine: found, skipped };
}

// A home's engine, or why it is not one: the SDK resolves inside the home at
// the pinned version and the SDK resolves one of this machine's executables.
function readHome(home: string, version: string, facts: PlatformFacts): FoundEngine | string {
  const inside = createRequire(join(home, "node_modules", "index.js"));
  let entry: string;
  try {
    entry = inside.resolve(CLAUDE_SDK);
  } catch {
    return `no ${CLAUDE_SDK} in it`;
  }
  const found = sdkVersion(entry);
  if (found !== version) return `it holds ${found}, not the pinned ${version}`;
  const fromSdk = createRequire(entry);
  const executable = engineExecutable(facts.platform);
  const resolves = platformPackages(facts).some((pkg) => {
    try {
      fromSdk.resolve(`${pkg}/${executable}`);
      return true;
    } catch {
      return false;
    }
  });
  if (!resolves) return `no executable for ${facts.platform}-${facts.arch} in it`;
  return { entry, version, home };
}

// The version in the package.json beside the SDK's entry. The SDK's exports
// map has no `./package.json`, so it is read from the entry's directory, not
// resolved by subpath.
function sdkVersion(entry: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(dirname(entry), "package.json"), "utf8")) as { version?: unknown };
    return typeof manifest.version === "string" ? manifest.version : "an unknown version";
  } catch {
    return "an unknown version";
  }
}

/**
 * Touches the home's {@link LAST_USED_FILE}, best effort: a home the runner
 * cannot write (every image's, root-owned; the all-in-one's under `/opt`) is
 * simply not stamped, and a failed stamp never fails a turn.
 */
export function touchLastUsed(home: string, now: Date = new Date()): boolean {
  const stamp = join(home, LAST_USED_FILE);
  try {
    if (!existsSync(stamp)) closeSync(openSync(stamp, "a"));
    utimesSync(stamp, now, now);
    return true;
  } catch {
    return false;
  }
}
