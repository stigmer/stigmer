/**
 * Context provider for the embedded runner.
 *
 * Mounts at the app level to start the runner on first authenticated render.
 * Components throughout the tree can call addSession/removeSession via the
 * context without re-triggering the runner start.
 *
 * The runner talks to the server the app talks to, with the person's
 * token. Another server mounts another provider, so the runner started for
 * the old one is stopped when this one unmounts: it must never keep serving
 * conversations against a server the person left.
 */

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useEmbeddedRunner, type UseEmbeddedRunnerResult } from "./useEmbeddedRunner";

type EmbeddedRunnerContext = UseEmbeddedRunnerResult;

const RunnerContext = createContext<EmbeddedRunnerContext | null>(null);

/** How often to poll the runner's live state to keep background-run indicators fresh. */
const STATUS_POLL_INTERVAL_MS = 5_000;

export interface EmbeddedRunnerProviderProps {
  /** The server the app talks to. */
  server: string;
  /** The person's current access token. */
  getAccessToken: () => string | null;
  children: ReactNode;
}

export function EmbeddedRunnerProvider({
  server,
  getAccessToken,
  children,
}: EmbeddedRunnerProviderProps) {
  const runner = useEmbeddedRunner({ server, getAccessToken });

  // Leaving this server stops its runner.
  useEffect(
    () => () => {
      void invoke("kill_runner").catch(() => {});
    },
    // Stryker disable next-line ArrayDeclaration: the server never changes while the provider is mounted, so any dependency list keeps this alike
    [server],
  );
  const { isRunning, refreshStatus } = runner;

  // While the runner is up, periodically reconcile activeSessions with its
  // truth. This is what lets the sidebar's "running in background" dot appear
  // for a session whose worker is kept alive by an in-flight run and
  // disappear once that run drains, and how a runner that stopped by itself
  // is noticed: the read that finds it gone turns the sidebar's row to
  // "Agents stopped", with Restart. Idle when the runner isn't running.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => {
      void refreshStatus();
    }, STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isRunning, refreshStatus]);

  return (
    <RunnerContext.Provider value={runner}>{children}</RunnerContext.Provider>
  );
}

export function useRunner(): EmbeddedRunnerContext {
  const ctx = useContext(RunnerContext);
  if (!ctx) {
    throw new Error("useRunner must be used within EmbeddedRunnerProvider");
  }
  return ctx;
}
