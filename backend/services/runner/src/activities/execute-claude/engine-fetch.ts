/**
 * Installs the Claude engine into an engine home (`engine-home.ts`) on a
 * runner that does not carry it: the desktop app's embedded runner, `stigmer
 * up`, the `local-process` driver and the all-in-one image's staging. Never
 * on a runner started from the runner layer, which carries the engine in a
 * layer of its own (the adapter decides; `adapter.ts`).
 *
 * WHAT IS FETCHED: exactly the pin (`claude-engine.json`): the SDK's tarball
 * and this machine's platform package, from the URLs npm's lockfile recorded,
 * each streamed to a file while it is hashed and extracted only after its
 * integrity matched (`@stigmer/artifact-fetch`). Extraction writes regular
 * files under `package/` and refuses any other entry, so the archive cannot
 * write outside the home. The executable keeps the mode the archive gives it,
 * and nothing is changed, re-signed or repacked.
 *
 * ATOMIC AND SHARED: everything is written into `claude/.partial-<random>`,
 * then renamed to `claude/<version>` under a cross-process lock
 * (proper-lockfile, the workspace lock's idiom), so a desktop app and a
 * `stigmer up` sharing one root download once, and no runner ever loads a
 * half-written home. A waiter takes the lock once it is free and finds the
 * home the first process installed. Inside one
 * process, {@link installForTurn} shares one install among every turn waiting
 * on it, and stops it only when every one of them has stopped.
 *
 * OLD VERSIONS: under the lock, an install removes another version's home
 * whose `last-used` stamp (or, unstamped, the home itself) is older than
 * {@link PRUNE_AFTER_MS}, and a partial directory a crashed install left
 * older than {@link PARTIAL_STALE_MS}. Every Claude turn on a home stamps it
 * (`adapter.ts`), so a home a runner of another release used in the last 30
 * days is kept; a runner whose home was removed while it sat idle longer
 * downloads it again on its next Claude turn.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { downloadToFile, extractPackageTarball, parseIntegrity } from "@stigmer/artifact-fetch";
import lockfile from "proper-lockfile";

import { CLAUDE_SDK, LAST_USED_FILE, engineHomeDir, type ClaudeEnginePin } from "./engine-home.js";

/** An engine home unused this long is removed by the next install of another version. */
export const PRUNE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** A partial directory this old belongs to an install that died. */
export const PARTIAL_STALE_MS = 24 * 60 * 60 * 1000;

const PARTIAL_PREFIX = ".partial-";
const LOCK_FILE = ".install.lock";
/** How long the lock's artifact may go unrefreshed before a waiter takes it over (the workspace lock's figure). */
const LOCK_STALE_MS = 10_000;
const DEFAULT_LOCK_POLL_MS = 1_000;

export interface InstallOptions {
  /** The engines root. */
  readonly root: string;
  readonly pin: ClaudeEnginePin;
  /** The platform package to fetch beside the SDK (`platformPackages(...)[0]`). */
  readonly platformPackage: string;
  /** Stops the install; the partial directory is removed and the signal's reason thrown. */
  readonly signal: AbortSignal;
  /** The share of the engine's bytes received so far, 0 to 1, once the platform package's length is known. */
  readonly onProgress?: (fraction: number) => void;
  /** Called on every chunk, so a watchdog sees the install moving. */
  readonly onActivity?: () => void;
  /** Override the fetch implementation (tests). */
  readonly fetchImpl?: typeof fetch;
  /** Override the wait between download attempts (tests). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** How often a waiter re-checks a busy lock (tests). */
  readonly lockPollMs?: number;
  /** The lock's stale window (tests; proper-lockfile takes no less than 2 s, and refreshes at half of it). */
  readonly lockStaleMs?: number;
  /** The clock pruning reads (tests). */
  readonly now?: () => number;
}

/** What an install did: downloaded the engine, or found another process had. */
export interface Installed {
  readonly home: string;
  readonly downloaded: boolean;
}

/** Installs the pinned engine into its home under `root`, by the rules in the module header. */
export async function installClaudeEngine(options: InstallOptions): Promise<Installed> {
  const { root, pin, signal } = options;
  const home = engineHomeDir(root, pin.version);
  const claudeDir = join(root, "claude");
  const sdk = pinned(pin, CLAUDE_SDK);
  const platform = pinned(pin, options.platformPackage);
  await mkdir(claudeDir, { recursive: true });

  const release = await acquire(claudeDir, signal, options.lockPollMs ?? DEFAULT_LOCK_POLL_MS, options.lockStaleMs ?? LOCK_STALE_MS);
  try {
    if (await exists(home)) return { home, downloaded: false };
    await prune(claudeDir, pin.version, (options.now ?? Date.now)());

    const partial = join(claudeDir, `${PARTIAL_PREFIX}${randomBytes(6).toString("hex")}`);
    try {
      await mkdir(join(partial, ".tarballs"), { recursive: true });
      let sdkBytes = 0;
      const sdkTarball = join(partial, ".tarballs", "sdk.tgz");
      await downloadToFile({
        url: sdk.resolved,
        dest: sdkTarball,
        expected: parseIntegrity(sdk.integrity),
        label: `the Claude Agent SDK (${CLAUDE_SDK})`,
        signal,
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
        onProgress: (received) => {
          sdkBytes = received;
          options.onActivity?.();
        },
      });
      const platformTarball = join(partial, ".tarballs", "platform.tgz");
      await downloadToFile({
        url: platform.resolved,
        dest: platformTarball,
        expected: parseIntegrity(platform.integrity),
        label: `the Claude Agent SDK (${options.platformPackage})`,
        signal,
        fetchImpl: options.fetchImpl,
        sleep: options.sleep,
        onProgress: (received, total) => {
          options.onActivity?.();
          if (total !== undefined) options.onProgress?.((sdkBytes + received) / (sdkBytes + total));
        },
      });
      await extractPackageTarball(sdkTarball, join(partial, "node_modules", ...CLAUDE_SDK.split("/")), {
        prefix: "package/",
        label: CLAUDE_SDK,
        signal,
      });
      await extractPackageTarball(platformTarball, join(partial, "node_modules", ...options.platformPackage.split("/")), {
        prefix: "package/",
        label: options.platformPackage,
        signal,
      });
      await rm(join(partial, ".tarballs"), { recursive: true, force: true });
      signal.throwIfAborted();
      try {
        await rename(partial, home);
      } catch (err) {
        // A second install whose lock was compromised can reach here after
        // the first renamed its verified home into place: that home serves.
        if (!(await exists(home))) throw err;
        await rm(partial, { recursive: true, force: true });
        return { home, downloaded: false };
      }
      return { home, downloaded: true };
    } catch (err) {
      await rm(partial, { recursive: true, force: true });
      throw err;
    }
  } finally {
    await release();
  }
}

function pinned(pin: ClaudeEnginePin, name: string): { resolved: string; integrity: string } {
  const entry = pin.packages[name];
  if (entry === undefined) throw new Error(`the runner's Claude engine pin names no ${name}`);
  return entry;
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

// The install lock. Polls rather than queueing inside proper-lockfile, so a
// stop is honoured between attempts; a waiter that gets the lock after
// another process installed the home finds it there, under the lock.
async function acquire(claudeDir: string, signal: AbortSignal, pollMs: number, staleMs: number): Promise<() => Promise<void>> {
  for (;;) {
    signal.throwIfAborted();
    try {
      const release = await lockfile.lock(claudeDir, {
        lockfilePath: join(claudeDir, LOCK_FILE),
        realpath: false,
        stale: staleMs,
        retries: 0,
        // A lock compromised under the install (its directory removed or
        // touched by another, or a refresh that missed its window) must not
        // crash the agent host: the worst case is a second download into its
        // own partial directory, and the rename into place stays atomic.
        onCompromised: (err) => console.warn(`[claude] the engine install lock was compromised (continuing): ${err.message}`),
      });
      return async () => {
        await release().catch((err: unknown) => console.warn(`[claude] releasing the engine install lock failed (ignored): ${String(err)}`));
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ELOCKED") throw err;
    }
    await delay(pollMs, undefined, { signal }).catch(() => signal.throwIfAborted());
  }
}

// Removes other versions' homes unused for PRUNE_AFTER_MS and partial
// directories older than PARTIAL_STALE_MS. Best effort: a home that cannot be
// read or removed stays, and the install goes on.
async function prune(claudeDir: string, keep: string, now: number): Promise<void> {
  for (const name of await readdir(claudeDir)) {
    if (name === keep || name === LOCK_FILE) continue;
    const path = join(claudeDir, name);
    const partial = name.startsWith(PARTIAL_PREFIX);
    const used = partial ? await mtime(path) : ((await mtime(join(path, LAST_USED_FILE))) ?? (await mtime(path)));
    if (used === null || now - used <= (partial ? PARTIAL_STALE_MS : PRUNE_AFTER_MS)) continue;
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function mtime(path: string): Promise<number | null> {
  return stat(path).then(
    (s) => s.mtimeMs,
    () => null,
  );
}

/** One turn waiting on an install: its stop, and where its progress goes. */
export interface InstallWaiter {
  readonly signal: AbortSignal;
  readonly onProgress?: (fraction: number) => void;
  readonly onActivity?: () => void;
}

interface Flight {
  readonly controller: AbortController;
  readonly waiters: Set<InstallWaiter>;
  readonly done: Promise<Installed>;
}

const flights = new Map<string, Flight>();

/**
 * The install for one turn, shared with every other turn of this process
 * waiting on the same home. A turn that stops leaves the install at once with
 * its stop's reason; the install itself stops only when no turn is left
 * waiting on it.
 */
export function installForTurn(options: Omit<InstallOptions, "signal" | "onProgress" | "onActivity">, waiter: InstallWaiter): Promise<Installed> {
  waiter.signal.throwIfAborted();
  const home = engineHomeDir(options.root, options.pin.version);
  const current = flights.get(home);
  // A flight every earlier turn left is stopping: a new turn starts its own,
  // which waits on the lock until the stopping one has cleaned up.
  const joined = current !== undefined && !current.controller.signal.aborted ? current : startFlight(home, options);
  joined.waiters.add(waiter);
  return new Promise<Installed>((resolve, reject) => {
    const leave = (): void => {
      waiter.signal.removeEventListener("abort", onStop);
      joined.waiters.delete(waiter);
    };
    const onStop = (): void => {
      leave();
      if (joined.waiters.size === 0) joined.controller.abort(waiter.signal.reason);
      reject(waiter.signal.reason);
    };
    waiter.signal.addEventListener("abort", onStop, { once: true });
    joined.done.then(
      (installed) => {
        leave();
        resolve(installed);
      },
      (err: unknown) => {
        leave();
        reject(err);
      },
    );
  });
}

function startFlight(home: string, options: Omit<InstallOptions, "signal" | "onProgress" | "onActivity">): Flight {
  const controller = new AbortController();
  const waiters = new Set<InstallWaiter>();
  const done = installClaudeEngine({
    ...options,
    signal: controller.signal,
    onProgress: (fraction) => waiters.forEach((w) => w.onProgress?.(fraction)),
    onActivity: () => waiters.forEach((w) => w.onActivity?.()),
  });
  const flight: Flight = { controller, waiters, done };
  flights.set(home, flight);
  const land = (): void => {
    if (flights.get(home) === flight) flights.delete(home);
  };
  done.then(land, land);
  return flight;
}
