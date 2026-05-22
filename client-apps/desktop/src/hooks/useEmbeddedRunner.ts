/**
 * Hook to manage the embedded runner process lifecycle.
 *
 * Starts the runner on mount via Tauri IPC and provides methods to
 * add/remove per-session Workers. The runner is automatically stopped
 * when the component unmounts or the app closes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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
  error: string | null;
}

function getRunnerConfig(): RunnerConfig {
  const stigmerEndpoint =
    localStorage.getItem("stigmer.serverEndpoint") || "http://localhost:7234";
  const temporalAddress =
    localStorage.getItem("stigmer.temporalAddress") || "localhost:7233";
  const stigmerToken = localStorage.getItem("stigmer.token") || undefined;

  return {
    nodeBinary: "node",
    runnerEntry: "resources/runner/dist/main.js",
    temporalAddress,
    stigmerEndpoint,
    temporalNamespace: "default",
    stigmerToken,
  };
}

export function useEmbeddedRunner(): UseEmbeddedRunnerResult {
  const [isRunning, setIsRunning] = useState(false);
  const [activeSessions, setActiveSessions] = useState<string[]>([]);
  const [activeWorkflowExecutions, setActiveWorkflowExecutions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let mounted = true;

    async function startRunner() {
      try {
        // Check if already running (app restart / HMR)
        const status = await invoke<RunnerStatus>("runner_status");
        if (status.running) {
          if (mounted) {
            setIsRunning(true);
            setActiveSessions(status.activeSessions);
            setActiveWorkflowExecutions(status.activeWorkflowExecutions ?? []);
          }
          return;
        }

        const config = getRunnerConfig();
        await invoke("start_runner", { config });
        if (mounted) {
          setIsRunning(true);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(String(err));
          setIsRunning(false);
        }
      }
    }

    startRunner();

    return () => {
      mounted = false;
    };
  }, []);

  const addSession = useCallback(async (sessionId: string): Promise<string> => {
    const taskQueue = await invoke<string>("add_session", { sessionId });
    setActiveSessions((prev) =>
      prev.includes(sessionId) ? prev : [...prev, sessionId],
    );
    return taskQueue;
  }, []);

  const removeSession = useCallback(async (sessionId: string): Promise<void> => {
    await invoke("remove_session", { sessionId });
    setActiveSessions((prev) => prev.filter((id) => id !== sessionId));
  }, []);

  const addWorkflowExecution = useCallback(async (executionId: string): Promise<string> => {
    const taskQueue = await invoke<string>("add_workflow_execution", { executionId });
    setActiveWorkflowExecutions((prev) =>
      prev.includes(executionId) ? prev : [...prev, executionId],
    );
    return taskQueue;
  }, []);

  const removeWorkflowExecution = useCallback(async (executionId: string): Promise<void> => {
    await invoke("remove_workflow_execution", { executionId });
    setActiveWorkflowExecutions((prev) => prev.filter((id) => id !== executionId));
  }, []);

  return {
    isRunning,
    activeSessions,
    activeWorkflowExecutions,
    addSession,
    removeSession,
    addWorkflowExecution,
    removeWorkflowExecution,
    error,
  };
}
