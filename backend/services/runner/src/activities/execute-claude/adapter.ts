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
 * A runner without the engine still boots. The engine is not distributed
 * with any published runner yet (`scripts/bundle-slim.mjs` stages none of
 * it), and a worker that failed its boot over one engine would take the
 * others down with it. So `boot` records whether the engine loaded, and a
 * Claude turn on a runner without it fails `actionable` with
 * {@link NOT_INSTALLED_MESSAGE}, before anything runs.
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

import type { Config } from "../../config.js";
import type { HarnessAdapter, TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { CLAUDE_CAPABILITIES } from "./claude-capabilities.js";
import type { ClaudeAdapterConfig, ClaudeSdk } from "./turn.js";

/** What a Claude turn on a runner without the engine is refused with. */
export const NOT_INSTALLED_MESSAGE = "Claude is not installed on this runner, so this turn cannot run on Claude. Run it on another engine.";

/** The config slice this adapter reads per turn, taken at `boot`; a whole `Config` satisfies it. */
export function resolveClaudeConfig(config: Config): ClaudeAdapterConfig {
  return {
    checkpointerType: config.checkpointerType,
    checkpointerProxyEndpoint: config.checkpointerProxyEndpoint,
    stigmerTokenRef: config.stigmerTokenRef,
    proxyEndpoint: config.proxyEndpoint,
    shellTimeoutMaxSeconds: config.shellTimeoutMaxSeconds,
    mode: config.mode,
  };
}

/** What `boot` leaves behind: the engine and its turn, or the reason the engine is absent. */
type BootedClaudeHarness =
  | { readonly kind: "ready"; readonly config: ClaudeAdapterConfig; readonly sdk: ClaudeSdk; readonly runClaudeTurn: typeof import("./turn.js").runClaudeTurn }
  | { readonly kind: "absent"; readonly reason: string };

export function createClaudeAdapter(): HarnessAdapter {
  let booted: BootedClaudeHarness | undefined;

  return {
    name: "claude",
    capabilities: CLAUDE_CAPABILITIES,

    async boot(bootConfig: Config): Promise<void> {
      let sdk: ClaudeSdk;
      try {
        sdk = await import("@anthropic-ai/claude-agent-sdk");
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[claude] the Claude engine is not installed on this runner; Claude turns will be refused: ${reason}`);
        booted = { kind: "absent", reason };
        return;
      }
      const { runClaudeTurn } = await import("./turn.js");
      booted = { kind: "ready", config: resolveClaudeConfig(bootConfig), sdk, runClaudeTurn };
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
      return booted.runClaudeTurn(input, sink, booted.config, booted.sdk);
    },
  };
}
