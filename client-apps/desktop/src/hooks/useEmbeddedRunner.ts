/**
 * Hook to manage the embedded runner process lifecycle.
 *
 * Uses lazy startup: the runner is started on the first
 * addSession/addWorkflowExecution call, not at mount time.
 * Provides methods to add/remove per-session Workers and
 * push token updates to the running runner process.
 *
 * The runner always operates in proxy mode: LLM calls route through
 * the Stigmer server's proxy (which injects platform API keys
 * server-side). The proxy endpoint is derived from VITE_STIGMER_API_URL
 * and gated on auth token presence — no async server-info call needed.
 *
 * The Temporal address is NOT configured here. The embedded runner
 * self-discovers it from the control plane during boot using the auth token
 * (token-only embedding), so the desktop only needs to point at the Stigmer
 * backend. Set VITE_STIGMER_TEMPORAL_ADDRESS to pin it for local development.
 */

import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { resolveResource } from "@tauri-apps/api/path";
import { loadTokens } from "../auth/token-store";

interface RunnerConfig {
  nodeBinary: string;
  runnerEntry: string;
  /** Optional: omitted by default so the runner self-discovers it via the token. */
  temporalAddress?: string;
  stigmerEndpoint: string;
  temporalNamespace?: string;
  stigmerToken?: string;
  cursorApiKey?: string;
  workspaceRootDir?: string;
  proxyEndpoint?: string;
}

interface RunnerStatus {
  running: boolean;
  activeSessions: string[];
  activeWorkflowExecutions: string[];
  /** OS pid of the runner (null when not running); exposed by the host for diagnostics. */
  pid?: number | null;
}

export interface UseEmbeddedRunnerResult {
  isRunning: boolean;
  activeSessions: string[];
  activeWorkflowExecutions: string[];
  addSession: (sessionId: string) => Promise<string>;
  removeSession: (sessionId: string) => Promise<void>;
  addWorkflowExecution: (executionId: string) => Promise<string>;
  removeWorkflowExecution: (executionId: string) => Promise<void>;
  updateRunnerToken: (token: string | null) => Promise<void>;
  error: string | null;
}

function normalizeToUrl(endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  return endpoint.endsWith(":443") ? `https://${endpoint}` : `http://${endpoint}`;
}

async function getRunnerConfig(): Promise<RunnerConfig> {
  // The runner's control-plane endpoint. In local dev this is the grpcwebproxy
  // sidecar; in production it is the Stigmer Cloud API. Falling back to
  // VITE_STIGMER_API_URL (not localhost) is what lets the production desktop —
  // which sets no sidecar — point the runner at the cloud control plane, which
  // is also the server the runner queries to self-discover Temporal.
  const stigmerEndpoint =
    import.meta.env.VITE_STIGMER_SIDECAR_ENDPOINT
    || import.meta.env.VITE_STIGMER_API_URL
    || localStorage.getItem("stigmer.serverEndpoint")
    || "http://localhost:7234";
  // Optional override only. Left undefined by default so the runner discovers
  // the Temporal address from the control plane using the auth token.
  const temporalAddress =
    import.meta.env.VITE_STIGMER_TEMPORAL_ADDRESS
    || localStorage.getItem("stigmer.temporalAddress")
    || undefined;
  // This is the runner's CONTROL-PLANE credential: the Auth0 access token the
  // runner presents to the Stigmer server for bootstrap + activity gRPC. It is
  // NOT what authenticates the runner's Cursor-proxy traffic — on cloud the
  // server mints a dedicated iss=stigmer token during bootstrap and the runner
  // owns/refreshes that proxy credential itself (see runner-manager.ts). The
  // desktop only needs to keep this Auth0 token fresh (TokenBridge in App.tsx),
  // which in turn lets the runner re-mint its proxy token indefinitely.
  const stigmerToken = loadTokens()?.accessToken || undefined;

  // Proxy endpoint for the runner's Cursor SDK traffic. Must include a URL
  // scheme and must be HTTPS so the SDK negotiates HTTP/2 via ALPN — required
  // for the HTTP/2 interceptor that injects x-stigmer-auth headers.
  //
  // Precedence: dedicated runner proxy URL (TLS) > general API URL > fallback.
  // Token presence gates proxy mode: authenticated against a cloud-edition
  // server implies the proxy is available.
  const proxyEndpoint = stigmerToken
    ? (import.meta.env.VITE_STIGMER_RUNNER_PROXY_URL
       || import.meta.env.VITE_STIGMER_API_URL
       || localStorage.getItem("stigmer.apiUrl")
       || normalizeToUrl(stigmerEndpoint))
    : undefined;

  // Resolve the staged runner to an ABSOLUTE path. `node` resolves a relative
  // script argument against the process working directory, which for a packaged
  // app launched from Finder/dock is `/`, not the bundle's resource directory.
  // `resolveResource` resolves against the resource dir in both dev and packaged
  // builds (the dev tree symlinks resources/runner to the in-repo runner).
  const runnerEntry = await resolveResource("resources/runner/dist/main.js");

  return {
    nodeBinary: "node",
    runnerEntry,
    // Omitted unless explicitly overridden — the runner self-discovers it.
    ...(temporalAddress ? { temporalAddress } : {}),
    stigmerEndpoint,
    stigmerToken,
    proxyEndpoint,
  };
}

export function useEmbeddedRunner(): UseEmbeddedRunnerResult {
  const [isRunning, setIsRunning] = useState(false);
  const [activeSessions, setActiveSessions] = useState<string[]>([]);
  const [activeWorkflowExecutions, setActiveWorkflowExecutions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const startingRef = useRef<Promise<void> | null>(null);

  const ensureRunning = useCallback(async (): Promise<void> => {
    if (startingRef.current) {
      await startingRef.current;
      return;
    }

    const status = await invoke<RunnerStatus>("runner_status");
    if (status.running) {
      setIsRunning(true);
      setActiveSessions(status.activeSessions);
      setActiveWorkflowExecutions(status.activeWorkflowExecutions ?? []);
      return;
    }

    const startPromise = (async () => {
      const config = await getRunnerConfig();
      await invoke("start_runner", { config });
      setIsRunning(true);
      setError(null);
    })();

    startingRef.current = startPromise;

    try {
      await startPromise;
    } catch (err) {
      startingRef.current = null;
      setError(String(err));
      setIsRunning(false);
      throw err;
    }
  }, []);

  const addSession = useCallback(async (sessionId: string): Promise<string> => {
    await ensureRunning();
    const taskQueue = await invoke<string>("add_session", { sessionId });
    setActiveSessions((prev) =>
      prev.includes(sessionId) ? prev : [...prev, sessionId],
    );
    return taskQueue;
  }, [ensureRunning]);

  const removeSession = useCallback(async (sessionId: string): Promise<void> => {
    await invoke("remove_session", { sessionId });
    setActiveSessions((prev) => prev.filter((id) => id !== sessionId));
  }, []);

  const addWorkflowExecution = useCallback(async (executionId: string): Promise<string> => {
    await ensureRunning();
    const taskQueue = await invoke<string>("add_workflow_execution", { executionId });
    setActiveWorkflowExecutions((prev) =>
      prev.includes(executionId) ? prev : [...prev, executionId],
    );
    return taskQueue;
  }, [ensureRunning]);

  const removeWorkflowExecution = useCallback(async (executionId: string): Promise<void> => {
    await invoke("remove_workflow_execution", { executionId });
    setActiveWorkflowExecutions((prev) => prev.filter((id) => id !== executionId));
  }, []);

  const updateRunnerToken = useCallback(async (token: string | null): Promise<void> => {
    const status = await invoke<RunnerStatus>("runner_status");
    if (!status.running) return;
    await invoke("update_runner_token", { token });
  }, []);

  return {
    isRunning,
    activeSessions,
    activeWorkflowExecutions,
    addSession,
    removeSession,
    addWorkflowExecution,
    removeWorkflowExecution,
    updateRunnerToken,
    error,
  };
}
