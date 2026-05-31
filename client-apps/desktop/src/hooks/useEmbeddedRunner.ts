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
 */

import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { loadTokens } from "../auth/token-store";

interface RunnerConfig {
  nodeBinary: string;
  runnerEntry: string;
  temporalAddress: string;
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

function getRunnerConfig(): RunnerConfig {
  const stigmerEndpoint =
    import.meta.env.VITE_STIGMER_SIDECAR_ENDPOINT
    || localStorage.getItem("stigmer.serverEndpoint")
    || "http://localhost:7234";
  const temporalAddress =
    import.meta.env.VITE_STIGMER_TEMPORAL_ADDRESS
    || localStorage.getItem("stigmer.temporalAddress")
    || "localhost:7233";
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

  return {
    nodeBinary: "node",
    runnerEntry: "resources/runner/dist/main.js",
    temporalAddress,
    stigmerEndpoint,
    temporalNamespace: "default",
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
      const config = getRunnerConfig();
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
