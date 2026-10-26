/**
 * The Claude harness as a `HarnessAdapter` — the worker- and session-
 * lifetime half of its Agent SDK slice, behind the turn runtime's contract
 * (`harness/types.ts`). One engine turn is `turn.ts`'s `runClaudeTurn`; this
 * module boots and delegates.
 *
 * THIS MODULE'S STATIC GRAPH IS SDK-FREE, ON PURPOSE, as every adapter's is
 * (`harness-adapters.ts`): `@anthropic-ai/claude-agent-sdk` and the turn
 * module are loaded with a dynamic import inside `boot`.
 * `__tests__/adapter-graph-is-sdk-free.test.ts` pins it.
 *
 * WHERE THE ENGINE COMES FROM (`engine-home.ts` has the order and the pin).
 * `boot` finds it once and leaves one of three states:
 *
 *  - ready: the engine loaded, from the runner's own install or an engine
 *    home, and boot logged `[claude] engine ready <version> (<where>)`;
 *  - fetchable: no engine, but the runner carries its pin and was not started
 *    from the runner layer. This is a local runner (the desktop app,
 *    `stigmer up`, the `local-process` driver), and its first Claude turn
 *    installs the engine into its home (`engine-fetch.ts`), showing
 *    "Downloading Claude (one time): N%" in the turn's setup label, then
 *    loads it and runs; every later turn starts at once. A failed download
 *    ends the turn `actionable` with {@link downloadFailedMessage}, and the
 *    next turn tries again;
 *  - absent: neither. The turn fails `actionable` with
 *    {@link NOT_INSTALLED_MESSAGE} before anything runs.
 *
 * A runner started from the runner layer (`layer/start.sh` exports
 * `STIGMER_RUNNER_LAYER=1`, which reaches the agent host under its
 * `STIGMER_` prefix) never fetches: every image built on the layer carries
 * the engine in it, and in a separating runner this host runs as the agent
 * user, which must never install an engine later turns run. The marker is
 * read, not `agentIdentity()`: inside the separated host that is always
 * null (it runs as uid 10001, and the identity is the runner's to know).
 *
 * A worker that failed its boot over one engine would take the others down
 * with it, so nothing here throws out of `boot`.
 *
 * Anthropic's conditions for running the engine in a product bind this
 * slice (`harness/README.md`, "The Claude engine"): the engine's bytes are
 * never changed or re-signed, it runs on the API-key method only
 * (`engine-env.ts`), and no Claude turn runs on a Stigmer-owned key.
 *
 * Nothing is parked per session: each invocation starts the engine's
 * process and ends it, and the session's conversation lives in the session
 * store (`session-store.ts`), so `releaseSession` is a no-op and `shutdown`
 * holds nothing.
 *
 * What this adapter never does: throw out of `runTurn`, branch on why
 * `stopSignal` aborted, write a phase or a terminal copy, bind a state id
 * (the session id derives from the runtime's thread id, `deterministic`), or
 * import `@temporalio/*` (`__tests__/adapter-is-temporal-free.test.ts`).
 */

import { pathToFileURL } from "node:url";

import type { Config } from "../../config.js";
import type { HarnessAdapter, TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { RUNNER_LAYER_ENV } from "../../shared/agent-identity.js";
import { CLAUDE_CAPABILITIES } from "./claude-capabilities.js";
import {
  CLAUDE_SDK,
  currentPlatform,
  enginesRoot,
  findClaudeEngine,
  platformPackages,
  readEnginePin,
  touchLastUsed,
  type ClaudeEnginePin,
  type FoundEngine,
} from "./engine-home.js";
import type { ClaudeAdapterConfig, ClaudeSdk } from "./turn.js";

/** What a Claude turn on a runner without the engine is refused with. */
export const NOT_INSTALLED_MESSAGE = "Claude is not installed on this runner, so this turn cannot run on Claude. Run it on another engine.";

/** What a Claude turn whose engine could not be downloaded ends with; the next turn tries again. */
export function downloadFailedMessage(reason: string): string {
  return `Claude could not be downloaded to this computer (${reason}). Check the connection and try again, or run this turn on another engine.`;
}

/** The setup label while the engine downloads. */
export function downloadLabel(percent: number): string {
  return `Downloading Claude (one time): ${percent}%`;
}

/** The least time between two download labels, so a fast download does not write a status per chunk. */
export const DOWNLOAD_LABEL_INTERVAL_MS = 1_000;

/** The config slice this adapter reads per turn, taken at `boot`; a whole `Config` satisfies it. */
export function resolveClaudeConfig(config: Config): ClaudeAdapterConfig {
  return {
    checkpointerType: config.checkpointerType,
    checkpointerProxyEndpoint: config.checkpointerProxyEndpoint,
    stigmerTokenRef: config.stigmerTokenRef,
    proxyEndpoint: config.proxyEndpoint,
    shellTimeoutMaxSeconds: config.shellTimeoutMaxSeconds,
    mode: config.mode,
    cursorStreamStallTimeoutMs: config.cursorStreamStallTimeoutMs,
  };
}

type Ready = { readonly kind: "ready"; readonly config: ClaudeAdapterConfig; readonly sdk: ClaudeSdk; readonly runClaudeTurn: typeof import("./turn.js").runClaudeTurn };

/** What `boot` leaves behind (the header's three states). */
type BootedClaudeHarness =
  | Ready
  | { readonly kind: "fetchable"; readonly config: ClaudeAdapterConfig; readonly pin: ClaudeEnginePin; readonly root: string }
  | { readonly kind: "absent"; readonly reason: string };

/** What `boot` reads from where it runs; a test replaces any of it. */
export interface ClaudeBootDeps {
  readonly env: NodeJS.ProcessEnv;
  readonly readPin: () => ClaudeEnginePin | null;
  readonly find: typeof findClaudeEngine;
  /** Imports a found engine's SDK: the runner's own by its bare name, a home's by file URL. */
  readonly load: (engine: FoundEngine) => Promise<ClaudeSdk>;
  /** Installs the engine for one turn (`engine-fetch.ts` `installForTurn`, loaded on first use). */
  readonly install: (
    options: { readonly root: string; readonly pin: ClaudeEnginePin; readonly platformPackage: string },
    waiter: { readonly signal: AbortSignal; readonly onProgress: (fraction: number) => void; readonly onActivity: () => void },
  ) => Promise<{ readonly home: string; readonly downloaded: boolean }>;
  readonly now: () => number;
}

const defaultBootDeps: ClaudeBootDeps = {
  env: process.env,
  readPin: () => readEnginePin(),
  find: findClaudeEngine,
  load: async (engine) => (engine.home === null ? import("@anthropic-ai/claude-agent-sdk") : (import(pathToFileURL(engine.entry).href) as Promise<ClaudeSdk>)),
  install: async (options, waiter) => (await import("./engine-fetch.js")).installForTurn(options, waiter),
  now: Date.now,
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createClaudeAdapter(overrides: Partial<ClaudeBootDeps> = {}): HarnessAdapter {
  const deps: ClaudeBootDeps = { ...defaultBootDeps, ...overrides };
  let booted: BootedClaudeHarness | undefined;

  // Loads a found engine and the turn module; logs the ready line.
  async function loadEngine(engine: FoundEngine, config: ClaudeAdapterConfig): Promise<Ready> {
    const sdk = await deps.load(engine);
    const { runClaudeTurn } = await import("./turn.js");
    if (engine.home !== null) touchLastUsed(engine.home);
    console.log(`[claude] engine ready ${engine.version} (${engine.home ?? "the runner's own install"})`);
    return { kind: "ready", config, sdk, runClaudeTurn };
  }

  // The fetchable state's turn: install (shared with any other turn waiting),
  // load, and from then on the adapter is ready.
  async function fetchThenRun(state: Extract<BootedClaudeHarness, { kind: "fetchable" }>, input: TurnInput, sink: TurnSink): Promise<TurnOutcome> {
    if (sink.stopSignal.aborted) return { kind: "interrupted" };
    const platform = currentPlatform();
    const platformPackage = platformPackages(platform)[0];
    if (platformPackage === undefined || state.pin.packages[platformPackage] === undefined) {
      return { kind: "failed", surface: "actionable", message: NOT_INSTALLED_MESSAGE };
    }
    let lastPercent = -1;
    let lastLabelAt = 0;
    const label = (percent: number): void => {
      const at = deps.now();
      if (percent <= lastPercent || (lastPercent >= 0 && percent < 100 && at - lastLabelAt < DOWNLOAD_LABEL_INTERVAL_MS)) return;
      lastPercent = percent;
      lastLabelAt = at;
      void sink.reportProgress(downloadLabel(percent));
    };
    label(0);
    let ready: Ready;
    try {
      const installed = await deps.install(
        { root: state.root, pin: state.pin, platformPackage },
        { signal: sink.stopSignal, onProgress: (fraction) => label(Math.floor(fraction * 100)), onActivity: () => sink.recordActivity("downloading Claude") },
      );
      const search = deps.find({ pin: state.pin, root: state.root, resolveFromRunner: () => null, platform });
      if (search.kind !== "found") throw new Error(`the downloaded engine at ${installed.home} did not load: ${search.skipped.join("; ") || "it is incomplete"}`);
      ready = await loadEngine(search.engine, state.config);
    } catch (err) {
      if (sink.stopSignal.aborted) return { kind: "interrupted" };
      console.warn(`[claude] the Claude engine could not be downloaded: ${messageOf(err)}`);
      return { kind: "failed", surface: "actionable", message: downloadFailedMessage(messageOf(err)), cause: err };
    }
    booted = ready;
    return ready.runClaudeTurn(input, sink, ready.config, ready.sdk);
  }

  return {
    name: "claude",
    capabilities: CLAUDE_CAPABILITIES,

    async boot(bootConfig: Config): Promise<void> {
      const config = resolveClaudeConfig(bootConfig);
      let pin: ClaudeEnginePin | null;
      try {
        pin = deps.readPin();
      } catch (err) {
        const reason = messageOf(err);
        console.warn(`[claude] the Claude engine is not installed on this runner; Claude turns will be refused: ${reason}`);
        booted = { kind: "absent", reason };
        return;
      }
      const root = enginesRoot(deps.env);
      const search = deps.find({ pin, root });
      for (const skipped of search.skipped) console.warn(`[claude] skipped an engine: ${skipped}`);
      if (search.kind === "found") {
        try {
          booted = await loadEngine(search.engine, config);
          return;
        } catch (err) {
          const reason = messageOf(err);
          console.warn(`[claude] the Claude engine is not installed on this runner; Claude turns will be refused: ${reason}`);
          booted = { kind: "absent", reason };
          return;
        }
      }
      if (pin !== null && deps.env[RUNNER_LAYER_ENV] !== "1") {
        console.log(`[claude] the Claude engine is not on this runner; the first Claude turn downloads ${pin.version} into ${root}`);
        booted = { kind: "fetchable", config, pin, root };
        return;
      }
      const reason = pin === null ? `${CLAUDE_SDK} is not installed beside the runner` : `no engine ${pin.version} under ${root}`;
      console.warn(`[claude] the Claude engine is not installed on this runner; Claude turns will be refused: ${reason}`);
      booted = { kind: "absent", reason };
    },

    /** Nothing is held across turns (the header). */
    async shutdown(): Promise<void> {},

    /** Nothing is parked per session (the header); an unknown id is a no-op by construction. */
    async releaseSession(_sessionId: string): Promise<void> {},

    async runTurn(input: TurnInput, sink: TurnSink): Promise<TurnOutcome> {
      if (booted === undefined) {
        throw new Error("claude adapter: runTurn before boot (the registry boots every adapter before the worker polls)");
      }
      if (booted.kind === "absent") return { kind: "failed", surface: "actionable", message: NOT_INSTALLED_MESSAGE };
      if (booted.kind === "fetchable") return fetchThenRun(booted, input, sink);
      return booted.runClaudeTurn(input, sink, booted.config, booted.sdk);
    },
  };
}
