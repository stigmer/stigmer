/**
 * The native deep-agent harness as a `HarnessAdapter` — the worker- and
 * session-lifetime half of its LangGraph slice, behind the turn runtime's
 * contract (`harness/types.ts`). One engine turn is `turn.ts`'s
 * `runDeepAgentTurn`; this module boots and delegates.
 *
 * What this adapter owns: the deepagents harness profiles (worker lifetime,
 * registered once before the first `createDeepAgent`), and one engine turn
 * (`runTurn`, through `turn.ts`). Everything else about a turn is the
 * runtime's (`harness/run-turn.ts`).
 *
 * THIS MODULE'S STATIC GRAPH IS SDK-FREE, ON PURPOSE. The composition roots
 * import the harness table (`src/harness-adapters.ts`) BEFORE they boot it,
 * and that table's static graph must stay SDK-free (the runner's own process
 * loads no engine). So `deepagents` and `@langchain/*` — this harness's whole engine —
 * are loaded with a dynamic import INSIDE `boot`, after the profiles are
 * registered; a worker that does not serve this harness never pays for
 * LangChain. `__tests__/adapter-graph-is-sdk-free.test.ts` pins it.
 *
 * Nothing is parked per session, and the header says so where the contract
 * asks: the sqlite saver is opened and closed per turn and the MCP
 * subprocesses are connected and closed per turn (`turn.ts`), so
 * `releaseSession` resolves as a no-op. The one thing `shutdown` reaches is
 * the background commands of the turns still running
 * (`shared/shell/background-commands.ts`): each `runTurn` creates its
 * invocation's registry, which reports each command to the turn's
 * transcript (`background-facts.ts`), and the adapter keeps the live ones
 * only so that a host stopping under a running turn stops their commands
 * too.
 *
 * What this adapter never does: throw out of `runTurn` (an engine failure is
 * `failed` on the `internal` surface; the recursion limit is
 * `tool_call_limit`; a `CancelledFailure` never exists here), branch on why
 * `stopSignal` aborted, write a phase or a terminal copy, bind a state id
 * (the thread id is the runtime's), or import
 * `@temporalio/*` (`__tests__/adapter-is-temporal-free.test.ts`).
 *
 * Extracted from `index.ts` `createDeepAgentActivities` in #1096.
 */

import type { Config } from "../../config.js";
import type { HarnessAdapter, TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { BackgroundCommands } from "../../shared/shell/background-commands.js";
import { loadStreamingConfig } from "../../shared/streaming-scheduler.js";
import { backgroundFacts } from "./background-facts.js";
import { DEEP_AGENT_CAPABILITIES } from "./deep-agent-capabilities.js";
import type { DeepAgentAdapterConfig } from "./turn-setup.js";

/** The config slice this adapter reads per turn, taken at `boot`; a whole `Config` satisfies it. */
export function resolveDeepAgentConfig(config: Config): DeepAgentAdapterConfig {
  return {
    checkpointerType: config.checkpointerType,
    checkpointerProxyEndpoint: config.checkpointerProxyEndpoint,
    stigmerTokenRef: config.stigmerTokenRef,
    proxyEndpoint: config.proxyEndpoint,
    mode: config.mode,
    cursorStreamStallTimeoutMs: config.cursorStreamStallTimeoutMs,
    shellTimeoutMaxSeconds: config.shellTimeoutMaxSeconds,
    shellBackgroundEnabled: config.shellBackgroundEnabled,
  };
}

/** What `boot` leaves behind for the turns: the config slice and the engine turn, loaded after the profiles. */
interface BootedDeepAgentHarness {
  readonly config: DeepAgentAdapterConfig;
  readonly runDeepAgentTurn: typeof import("./turn.js").runDeepAgentTurn;
}

export function createDeepAgentAdapter(): HarnessAdapter {
  let booted: BootedDeepAgentHarness | undefined;
  /** The background commands of each turn running now (the header). */
  const live = new Set<BackgroundCommands>();

  return {
    name: "stigmer",
    capabilities: DEEP_AGENT_CAPABILITIES,

    /**
     * Register the harness profiles (deepagents would otherwise auto-inject
     * an ungated `general-purpose` sub-agent into every graph), then load
     * the engine slice. Idempotent: a re-boot re-reads the slice; the
     * registration is once-guarded.
     */
    async boot(bootConfig: Config): Promise<void> {
      // `deepagents-profiles.ts` imports the SDK to register against it, so
      // it too is loaded here and not at the top of this module.
      const { registerStigmerDeepagentsProfiles } = await import("./deepagents-profiles.js");
      registerStigmerDeepagentsProfiles();
      const { runDeepAgentTurn } = await import("./turn.js");
      booted = { config: resolveDeepAgentConfig(bootConfig), runDeepAgentTurn };
    },

    /** Nothing is held across turns; the running turns' background commands are stopped (see the header). */
    async shutdown(): Promise<void> {
      await Promise.all([...live].map((commands) => commands.stopAll()));
    },

    /** Nothing is parked per session (see the header); an unknown id is a no-op by construction. */
    async releaseSession(_sessionId: string): Promise<void> {},

    async runTurn(input: TurnInput, sink: TurnSink): Promise<TurnOutcome> {
      if (booted === undefined) {
        throw new Error("deep-agent adapter: runTurn before boot (the registry boots every adapter before the worker polls)");
      }
      const commands = new BackgroundCommands(backgroundFacts(sink, loadStreamingConfig().minIntervalMs));
      live.add(commands);
      try {
        return await booted.runDeepAgentTurn(input, sink, booted.config, commands);
      } finally {
        live.delete(commands);
      }
    },
  };
}
