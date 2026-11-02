/**
 * The server the app talks to, and what it said when the app connected.
 *
 * The Rust host owns the choice (src-tauri/src/server.rs): it validates an
 * address, remembers it, and lets the webview reach exactly that origin.
 * This provider asks it which server is chosen (the build's
 * `VITE_STIGMER_API_URL` when the person chose none), connects with
 * `getServerInfo`, and keeps the outcome (connect.ts) for the screens and
 * the sign-in below it. Choosing another server connects again.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Stigmer, type DeploymentMode } from "@stigmer/client";
import { buildDefaultServer } from "../config";
import {
  connectFailureOf,
  connectOutcome,
  hostOf,
  serverLabel,
  type ConnectFailure,
  type ConnectOutcome,
} from "./connect";

/** Where connecting stands. */
export type ServerConnection =
  | { readonly phase: "connecting" }
  | {
      readonly phase: "connected";
      readonly outcome: ConnectOutcome;
      readonly deploymentMode: DeploymentMode;
    }
  | { readonly phase: "failed"; readonly failure: ConnectFailure; readonly detail: string }
  /** The build's own address is not usable; only another server helps. */
  | { readonly phase: "unusable"; readonly detail: string };

export interface ServerState {
  /** The chosen server's origin, "" until the host has answered. */
  readonly origin: string;
  /** How the screens name it: "Stigmer Cloud", or its host. */
  readonly label: string;
  readonly connection: ServerConnection;
  /** Connects to the same server again. */
  readonly retry: () => void;
  /**
   * Makes `url` the server: the host validates and remembers it, then the
   * app connects. Resolves `null`, or the reason the address cannot be used.
   */
  readonly choose: (url: string) => Promise<string | null>;
  /** Whether the person is choosing another server ("Use another server", "Change server"). */
  readonly isChoosing: boolean;
  /** Shows the server form in place of the app; `false` goes back. */
  readonly setChoosing: (choosing: boolean) => void;
}

const ServerContext = createContext<ServerState | null>(null);

export function useServer(): ServerState {
  const state = useContext(ServerContext);
  if (!state) throw new Error("useServer must be used within ServerProvider");
  return state;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ServerProvider({ children }: { children: ReactNode }) {
  const [origin, setOrigin] = useState("");
  const [connection, setConnection] = useState<ServerConnection>({ phase: "connecting" });
  const [label, setLabel] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [isChoosing, setChoosing] = useState(false);

  // Which server: the person's choice, else the build's default.
  useEffect(() => {
    let cancelled = false;
    invoke<string>("current_server", { buildDefault: buildDefaultServer() }).then(
      (chosen) => {
        if (!cancelled) setOrigin(chosen);
      },
      (error: unknown) => {
        if (!cancelled) setConnection({ phase: "unusable", detail: messageOf(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // What it says: getServerInfo, before anyone signs in.
  useEffect(() => {
    if (origin === "") return;
    let cancelled = false;
    setConnection({ phase: "connecting" });
    setLabel(hostOf(origin));
    const client = new Stigmer({ baseUrl: origin, fetch: tauriFetch });
    client.platform.getServerInfo().then(
      (info) => {
        if (cancelled) return;
        setLabel(serverLabel(info, origin));
        setConnection({
          phase: "connected",
          outcome: connectOutcome(info),
          deploymentMode: info.deploymentMode,
        });
      },
      (error: unknown) => {
        if (cancelled) return;
        setConnection({ phase: "failed", failure: connectFailureOf(error), detail: messageOf(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [origin, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const choose = useCallback(async (url: string): Promise<string | null> => {
    try {
      const chosen = await invoke<string>("choose_server", { url });
      setOrigin(chosen);
      setAttempt((n) => n + 1);
      setChoosing(false);
      return null;
    } catch (error) {
      return messageOf(error);
    }
  }, []);

  const state = useMemo(
    () => ({ origin, label, connection, retry, choose, isChoosing, setChoosing }),
    [origin, label, connection, retry, choose, isChoosing],
  );
  return <ServerContext.Provider value={state}>{children}</ServerContext.Provider>;
}
