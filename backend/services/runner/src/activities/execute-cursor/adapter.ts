/**
 * The Cursor harness as a `HarnessAdapter` — the worker- and session-lifetime
 * half of its SDK slice, behind the turn runtime's contract
 * (`harness/types.ts`). One engine turn is `turn.ts`'s `runCursorTurn`; this
 * module boots, releases, and delegates.
 *
 * What this adapter owns: the proxy interceptors and the parked-agent cache
 * (worker lifetime), the parked agent per session (session lifetime), and one
 * engine turn (`runTurn`, through `turn.ts`). Everything else about a turn is
 * the runtime's (`harness/run-turn.ts`).
 *
 * THIS MODULE'S STATIC GRAPH IS SDK-FREE, ON PURPOSE. The composition roots
 * import it (through `src/harness-adapters.ts`) BEFORE they boot it, and
 * `boot` is where the fetch and HTTP/2 interceptors are installed. The HTTP/2
 * one patches `node:http2`, whose ESM facade is snapshotted the first time
 * `@connectrpc/connect-node` is imported — and `@cursor/sdk` imports
 * connect-node. So the SDK-touching half of this harness (`turn.ts` and,
 * through it, `turn-setup.ts` and its siblings) is loaded with a dynamic
 * import INSIDE `boot`, after the installs and after
 * `assertHttp2ConnectPatched` has proven the facade sees the patch. This is
 * the contract's own rule ("vendor SDKs are imported lazily inside" boot,
 * `types.ts`), and the runner's dynamic-import-for-order convention
 * (`bootstrap.ts`). `src/__tests__/harness-boot-order.test.ts` boots a fresh
 * process through this path and fails if the graph regresses; the modules
 * this file imports statically must each stay connect-free.
 *
 * The interceptors read the proxy credential from `Config.proxyTokenRef` per
 * request; which credential that is (the static root's control-plane token,
 * the manager's minted runner token) is the root's decision, not this
 * module's (Q-S2-7).
 *
 * What this adapter never does: throw out of `runTurn` (an SDK failure is
 * `failed` with the classifier's sentence; an unexpected exception is
 * `failed` on the `internal` surface; a `CancelledFailure` never exists
 * here), branch on why `stopSignal` aborted, write a phase or a terminal
 * copy, or import `@temporalio/*` (`__tests__/adapter-is-temporal-free.test.ts`
 * pins it, which is what lets the contract kit run this adapter outside any
 * activity context).
 *
 * The file-review boundary (`turn-boundary.ts`) runs whole inside `turn.ts`
 * for S2 (Q-S2-1): five of its six steps read the denial ledger, this
 * harness's deny-and-retry primitive. S3 lifts the capture into the runtime
 * with both harnesses' captures in view; `types.ts`'s "the file-review
 * boundary is the runtime's" becomes true then.
 *
 * Extracted from `index.ts` `createCursorActivities` at S2 M3b; split from
 * the turn body at S2 M5. The seventeen hermetic goldens under
 * `__tests__/hermetic/` pin the result byte for byte.
 */

import type { Config } from "../../config.js";
import type { HarnessAdapter, TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { markBoot } from "../../shared/cold-start-timing.js";
import { closeAllCachedAgents, evictSessionAgent } from "./agent-session-cache.js";
import { CURSOR_CAPABILITIES } from "./cursor-capabilities.js";
import { installFetchInterceptor } from "./fetch-interceptor.js";
import { assertHttp2ConnectPatched, installHttp2Interceptor } from "./http2-interceptor.js";
import type { CursorAdapterConfig } from "./turn-setup.js";

/** The config slice this adapter reads per turn, taken at `boot`; a whole `Config` satisfies it. */
export function resolveCursorConfig(config: Config): CursorAdapterConfig {
  return {
    proxyEndpoint: config.proxyEndpoint,
    cursorApiKey: config.cursorApiKey,
    stigmerToken: config.stigmerToken,
    stigmerTokenRef: config.stigmerTokenRef,
    workspaceRootDir: config.workspaceRootDir,
    cloudModeEnabled: config.cloudModeEnabled,
    agentResolveTimeoutMs: config.agentResolveTimeoutMs,
  };
}

/** What `boot` leaves behind for the turns: the config slice and the engine turn, loaded after the interceptors. */
interface BootedCursorHarness {
  readonly config: CursorAdapterConfig;
  readonly runCursorTurn: typeof import("./turn.js").runCursorTurn;
}

export function createCursorAdapter(): HarnessAdapter {
  let booted: BootedCursorHarness | undefined;

  return {
    name: "cursor",
    capabilities: CURSOR_CAPABILITIES,

    /**
     * Install the proxy transport, prove the HTTP/2 patch reached the facade,
     * then load the SDK slice — in that order, for the reason in the header.
     * Runs before bootstrap resolution, so `bootConfig` carries no Temporal
     * coordinates yet; every field the slice reads is known at that point.
     * Idempotent: a re-boot rebinds the interceptors and re-reads the slice.
     */
    async boot(bootConfig: Config): Promise<void> {
      if (bootConfig.proxyEndpoint && !bootConfig.proxyTokenRef) {
        throw new Error(
          "cursor adapter: a proxy endpoint needs Config.proxyTokenRef (the composition root binds its proxy credential there; see config.ts)",
        );
      }
      // The Cursor SDK's REST client resolves `fetch` at call time and its
      // Connect transport opens native HTTP/2 sessions; the two interceptors
      // route the first through the proxy and stamp the second with the proxy
      // credential and the execution id. Both are no-ops without a proxy.
      installFetchInterceptor({
        proxyEndpoint: bootConfig.proxyEndpoint ?? undefined,
        proxyTokenRef: bootConfig.proxyTokenRef,
      });
      installHttp2Interceptor({
        proxyEndpoint: bootConfig.proxyEndpoint ?? undefined,
        proxyTokenRef: bootConfig.proxyTokenRef,
      });
      markBoot("interceptors_installed");
      // Fail loudly at boot if a load-order regression left the node:http2 ESM
      // facade unpatched (otherwise BiDi streams would silently 401). No-op
      // when the interceptor is unconfigured (no proxy).
      await assertHttp2ConnectPatched();

      const { runCursorTurn } = await import("./turn.js");
      booted = { config: resolveCursorConfig(bootConfig), runCursorTurn };
    },

    /** Close every parked agent (their executor leases and MCP subprocesses). */
    async shutdown(): Promise<void> {
      closeAllCachedAgents();
    },

    /** The session is done on this host: close the agent parked for it, if any (#215). */
    async releaseSession(sessionId: string): Promise<void> {
      evictSessionAgent(sessionId);
    },

    async runTurn(input: TurnInput, sink: TurnSink): Promise<TurnOutcome> {
      if (booted === undefined) {
        throw new Error("cursor adapter: runTurn before boot (the registry boots every adapter before the worker polls)");
      }
      return booted.runCursorTurn(input, sink, booted.config);
    },
  };
}
