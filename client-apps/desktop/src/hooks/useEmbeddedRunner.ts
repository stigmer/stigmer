/**
 * Hook to manage the embedded runner process lifecycle.
 *
 * Uses lazy startup: the runner is started on the first
 * addSession call, not at mount time.
 * Provides methods to add/remove per-session Workers and
 * push token updates to the running runner process, and keeps the
 * runner's state for the sidebar (runner-state.ts): a runner that was up
 * and is gone reads as stopped, and starting it again gives it back every
 * conversation the window holds.
 *
 * The runner always operates in proxy mode: LLM calls route through
 * the Stigmer server's proxy (which injects platform API keys
 * server-side). The proxy is the server the app talks to, gated on the
 * person's token — no async server-info call needed.
 *
 * The Temporal address is NOT configured here. The embedded runner
 * self-discovers it from the control plane during boot using the auth token
 * (token-only embedding), so the desktop only needs to point at the Stigmer
 * backend. Set VITE_STIGMER_TEMPORAL_ADDRESS to pin it for local development.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { runnerStateOf, type RunnerState } from "./runner-state";
import { buildDefaultServer } from "../config";

export interface RunnerConfig {
  nodeBinary: string;
  runnerEntry: string;
  /** Optional: omitted by default so the runner self-discovers it via the token. */
  temporalAddress?: string;
  stigmerEndpoint: string;
  temporalNamespace?: string;
  stigmerToken?: string;
  workspaceRootDir?: string;
  proxyEndpoint?: string;
  /** Extra environment for the runner; the app passes the person's PATH. */
  extraEnv?: Record<string, string>;
}

interface RunnerStatus {
  running: boolean;
  activeSessions: string[];
  /** OS pid of the runner (null when not running); exposed by the host for diagnostics. */
  pid?: number | null;
}

export interface UseEmbeddedRunnerResult {
  isRunning: boolean;
  activeSessions: string[];
  addSession: (sessionId: string) => Promise<string>;
  removeSession: (sessionId: string) => Promise<void>;
  updateRunnerToken: (token: string | null) => Promise<void>;
  /**
   * Re-read the runner's live session state. Used to reflect the
   * runner's truth after a remove (which may defer teardown while a run
   * runs in the background) and by periodic polling so background-run
   * indicators clear once a run drains.
   */
  refreshStatus: () => Promise<void>;
  /**
   * Starts the runner again after it stopped or failed to start, and gives
   * it back every conversation the window holds, the same call a
   * conversation makes when it opens.
   */
  restart: () => Promise<void>;
  /** What the runner is doing, as the sidebar shows it. */
  state: RunnerState;
  error: string | null;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

/** What the runner is started against: the chosen server and the person's token. */
export interface RunnerTarget {
  /** The server the app talks to, an origin with its scheme (server/ServerProvider.tsx). */
  readonly server: string;
  /** The person's access token, or none on a server that trusts every request. */
  readonly accessToken: string | null;
}

/**
 * The configuration the embedded runner starts with. Exported for its tests;
 * the hook below is its only caller.
 */
export async function getRunnerConfig(target: RunnerTarget): Promise<RunnerConfig> {
  // The runner's control-plane endpoint: the server the app talks to, which
  // is also the server the runner asks for its Temporal address. A
  // development build may route it through the local grpcwebproxy sidecar,
  // which fronts the build's own server and no other.
  const sidecar = import.meta.env.VITE_STIGMER_SIDECAR_ENDPOINT;
  const stigmerEndpoint = sidecar && target.server === originOf(buildDefaultServer()) ? sidecar : target.server;
  // Optional override only. Left undefined by default so the runner discovers
  // the Temporal address from the control plane using the token.
  const temporalAddress = import.meta.env.VITE_STIGMER_TEMPORAL_ADDRESS || undefined;
  // This is the runner's CONTROL-PLANE credential: the person's access token,
  // which the runner presents to the Stigmer server for bootstrap + activity
  // gRPC. It is NOT what authenticates the runner's LLM proxy traffic — on
  // cloud the server mints a dedicated iss=stigmer token during bootstrap and
  // the runner owns/refreshes that proxy credential itself (see
  // runner-manager.ts). The desktop only keeps this token fresh (TokenBridge
  // in App.tsx), which lets the runner re-mint its proxy token indefinitely.
  // It comes from the sign-in's memory, never from web storage.
  const stigmerToken = target.accessToken || undefined;

  // The proxy for the runner's LLM traffic: the server itself. A token gates
  // proxy mode: a signed-in person on a server that signs people in implies
  // the proxy is there.
  const proxyEndpoint = stigmerToken ? target.server : undefined;

  // Resolve the staged runner to an ABSOLUTE path. `node` resolves a relative
  // script argument against the process working directory, which for a packaged
  // app launched from Finder/dock is `/`, not the bundle's resource directory.
  //
  // In dev we deliberately bypass `resolveResource`. Tauri stages declared
  // resources by COPYING them into `target/<profile>/resources/` — for the
  // runner that is a full ~485MB tree (incl. node_modules). That snapshot drifts:
  // tauri-build refreshes changed files but never prunes deleted ones, so after a
  // refactor the copy ends up with a fresh `dist/` fingerprint on top of stale
  // `src/`, which trips the runner's build-freshness guard and refuses to start
  // (stigmer/stigmer#181). `setup-runner-dev.sh` writes the in-repo runner's
  // absolute entry into `.env.development.local`; reading the live tree directly
  // keeps `src/`+`dist/` always consistent and picks up `make build-runner`
  // without restaging. Packaged builds never see this var (it lives in a
  // dev-only `.local` file) and the `import.meta.env.DEV` guard is belt-and-suspenders.
  const devRunnerEntry = import.meta.env.DEV
    ? import.meta.env.VITE_STIGMER_RUNNER_ENTRY
    : undefined;
  const runnerEntry =
    devRunnerEntry || (await resolveResource("resources/runner/dist/main.js"));

  // The runner's engine is the Node runtime this build carries (staged by
  // scripts/stage-node-runtime.sh, pinned in node-runtime.json), in dev and
  // packaged alike. Never a bare `node`: an app launched from Finder, the Dock
  // or the Start menu does not see the shell's PATH, so a name would resolve to
  // whatever the session offers, usually nothing (stigmer/stigmer#1068). Rust
  // resolves it because Rust knows the platform's executable suffix.
  const nodeBinary = await invoke<string>("bundled_node_path");

  // The PATH the person's terminal sees, read once from their login shell by
  // the Rust host (src-tauri/src/user_path.rs). The runner's own engine is the
  // bundled Node above; this PATH is for the tools its agents start, an `npx`
  // MCP server or a shell step calling `brew`, which an app opened from Finder
  // would otherwise not find (stigmer/stigmer#1347). Only PATH crosses: no
  // other variable from the shell reaches the runner.
  const userPath = await invoke<string>("user_tool_path");

  return {
    nodeBinary,
    runnerEntry,
    // Omitted unless explicitly overridden — the runner self-discovers it.
    ...(temporalAddress ? { temporalAddress } : {}),
    stigmerEndpoint,
    stigmerToken,
    proxyEndpoint,
    ...(userPath ? { extraEnv: { PATH: userPath } } : {}),
  };
}

export function useEmbeddedRunner({
  server,
  getAccessToken,
}: {
  /** The server the app talks to; the runner's control plane and proxy. */
  readonly server: string;
  /** The person's current access token, read at start. */
  readonly getAccessToken: () => string | null;
}): UseEmbeddedRunnerResult {
  const [isRunning, setIsRunning] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [activeSessions, setActiveSessions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const startingRef = useRef<Promise<void> | null>(null);
  // The conversations the window holds: added when one opens, dropped when
  // it closes. Restart gives each back to a new runner.
  const heldSessionsRef = useRef(new Set<string>());

  // The app never stops the runner while the window lives, so one that has
  // been up and is not up now stopped by itself (runner-state.ts).
  const markRunning = useCallback(
    (running: boolean) => {
      if (running) setHasRun(true);
      setIsRunning(running);
    },
    // Stryker disable next-line ArrayDeclaration: the callback reads nothing from the render, so any dependency list keeps it alike
    [],
  );

  const ensureRunning = useCallback(
    async (): Promise<void> => {
      // One check-and-start at a time. The guard covers the status read as well
      // as the start: set after the read, two callers arriving together would
      // both see "not running" and both start, and the host refuses the second
      // (stigmer/stigmer#1505). It clears once the attempt settles, so a later
      // call reads the host again and restarts a runner that has since exited.
      if (!startingRef.current) {
        const attempt = (async () => {
          const status = await invoke<RunnerStatus>("runner_status");
          if (status.running) {
            markRunning(true);
            setActiveSessions(status.activeSessions);
            return;
          }
          setIsStarting(true);
          const config = await getRunnerConfig({ server, accessToken: getAccessToken() });
          await invoke("start_runner", { config });
          // A new runner holds no conversation. Give it every one the window
          // holds, so a runner that stopped by itself and starts again (from
          // Restart, or because another conversation opened) serves them all.
          // The host's add is idempotent, so the caller's own add that follows
          // is an acknowledgement.
          for (const sessionId of heldSessionsRef.current) {
            await invoke<string>("add_session", { sessionId });
          }
          markRunning(true);
          setError(null);
        })();
        startingRef.current = attempt;
        attempt
          .finally(() => {
            // Stryker disable next-line ConditionalExpression: no other attempt can begin while this one holds the guard, so the check holds; it keeps a later change from clearing an attempt that is not this one
            if (startingRef.current === attempt) startingRef.current = null;
            setIsStarting(false);
          })
          .catch(() => {});
      }

      try {
        await startingRef.current;
      } catch (err) {
        setError(String(err));
        setIsRunning(false);
        throw err;
      }
    },
    // Stryker disable next-line ArrayDeclaration: none of these changes while the provider is mounted (another server mounts another provider), so any dependency list keeps this alike
    [markRunning, server, getAccessToken],
  );

  const addSession = useCallback(
    async (sessionId: string): Promise<string> => {
      heldSessionsRef.current.add(sessionId);
      await ensureRunning();
      const taskQueue = await invoke<string>("add_session", { sessionId });
      setActiveSessions((prev) =>
        prev.includes(sessionId) ? prev : [...prev, sessionId],
      );
      return taskQueue;
    },
    // Stryker disable next-line ArrayDeclaration: ensureRunning never changes, so any dependency list keeps this alike
    [ensureRunning],
  );

  const refreshStatus = useCallback(
    async (): Promise<void> => {
      try {
        const status = await invoke<RunnerStatus>("runner_status");
        markRunning(status.running);
        setActiveSessions(status.activeSessions);
      } catch {
        // Status polling is best-effort; a transient IPC failure must not surface.
      }
    },
    // Stryker disable next-line ArrayDeclaration: markRunning never changes, so any dependency list keeps this alike
    [markRunning],
  );

  const removeSession = useCallback(
    async (sessionId: string): Promise<void> => {
      heldSessionsRef.current.delete(sessionId);
      await invoke("remove_session", { sessionId });
      // The runner keeps the worker alive in the background when a run is
      // still in flight (deferred teardown), so reconcile from the runner's truth
      // rather than optimistically dropping the session — a backgrounded run must
      // stay visible (and drives the "running in background" indicator).
      await refreshStatus();
    },
    // Stryker disable next-line ArrayDeclaration: refreshStatus never changes, so any dependency list keeps this alike
    [refreshStatus],
  );

  const restart = useCallback(
    async (): Promise<void> => {
      try {
        await ensureRunning();
      } catch {
        // ensureRunning recorded the failure; the row shows it with Try again.
        return;
      }
      await refreshStatus();
    },
    // Stryker disable next-line ArrayDeclaration: neither callback ever changes, so any dependency list keeps this alike
    [ensureRunning, refreshStatus],
  );

  const updateRunnerToken = useCallback(
    async (token: string | null): Promise<void> => {
      const status = await invoke<RunnerStatus>("runner_status");
      if (!status.running) return;
      await invoke("update_runner_token", { token });
    },
    // Stryker disable next-line ArrayDeclaration: the callback reads nothing from the render, so any dependency list keeps it alike
    [],
  );

  const state = useMemo(
    () => runnerStateOf({ isRunning, isStarting, hasRun, error, activeSessions }),
    [isRunning, isStarting, hasRun, error, activeSessions],
  );

  return {
    isRunning,
    activeSessions,
    addSession,
    removeSession,
    updateRunnerToken,
    refreshStatus,
    restart,
    state,
    error,
  };
}
