import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  useGitHubConnection,
  useDeploymentMode,
  type UseGitHubConnectionReturn,
  type UseGitHubConnectionConfig,
} from "@stigmer/react";

const CONSOLE_URL =
  import.meta.env.VITE_STIGMER_CONSOLE_URL ?? "https://app.stigmer.ai";

/**
 * Payload emitted by the `github-callback` Tauri event.
 *
 * Emitted by two sources depending on deployment mode:
 * - **Cloud:** The `stigmer://github/callback` deep link handler in
 *   `lib.rs` (code + state delivered via the web callback page).
 * - **Local:** The `start_github_callback_server` Rust command (code +
 *   state captured by the localhost HTTP server).
 */
interface GitHubCallbackPayload {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

/**
 * Desktop-aware wrapper around {@link useGitHubConnection}.
 *
 * Tauri's Wry webview blocks `window.open()`, so the standard
 * popup-based GitHub OAuth flow does not work in the desktop app.
 * This hook provides two strategies based on deployment mode:
 *
 * ### Cloud mode
 *
 * Opens the system browser with the authorization URL. The redirect
 * URI points to the Stigmer web console's callback page with
 * `?source=desktop`. The callback page detects this marker and
 * redirects to `stigmer://github/callback?code=...&state=...`. The
 * Tauri deep link handler emits a `github-callback` event, and this
 * hook completes the token exchange via `handleCallback()`.
 *
 * ### Local mode
 *
 * Starts a one-shot localhost HTTP server via the Rust
 * `start_github_callback_server` command. GitHub's lenient localhost
 * matching accepts any port when the OAuth App's callback URL is on
 * localhost. The server captures the code and state and emits the
 * same `github-callback` event.
 *
 * The returned object has the same shape as `useGitHubConnection`,
 * so it can be passed directly to `SessionComposer` /
 * `WorkspaceEditor`.
 */
export function useDesktopGitHubConnection(
  org: string | null,
): UseGitHubConnectionReturn {
  const deploymentMode = useDeploymentMode();
  const isCloud = deploymentMode === "cloud";

  // In dev mode the production .app bundle owns the stigmer:// protocol,
  // so deep links never reach the dev instance. Use the localhost
  // callback server instead, matching the Auth0 flow in AuthProvider.
  const useLocalServer = !isCloud || import.meta.env.DEV;

  // ── Localhost callback server ─────────────────────────────────────
  const [localPort, setLocalPort] = useState<number | null>(null);
  const localPortRef = useRef<number | null>(null);

  const startLocalServer = useCallback(async (): Promise<number> => {
    const p = await invoke<number>("start_github_callback_server");
    localPortRef.current = p;
    setLocalPort(p);
    return p;
  }, []);

  useEffect(() => {
    if (!useLocalServer) return;
    startLocalServer().catch((err) => {
      console.error("Failed to start GitHub callback server:", err);
    });
  }, [useLocalServer, startLocalServer]);

  // ── Resolve callback URL and hook config ──────────────────────────
  const openUrl = useCallback(async (url: string) => {
    await invoke("open_auth_in_browser", { authUrl: url });
  }, []);

  const callbackUrl = useLocalServer
    ? localPort
      ? `http://127.0.0.1:${localPort}/auth/github/callback`
      : undefined
    : `${CONSOLE_URL}/auth/github/callback?source=desktop`;

  const config: UseGitHubConnectionConfig | undefined = callbackUrl
    ? { openUrl, callbackUrl }
    : undefined;

  const connection = useGitHubConnection(org, config);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  // ── Listen for github-callback event ──────────────────────────────
  // Both cloud (deep link) and local (localhost server) flows emit
  // the same `github-callback` Tauri event with code + state.
  useEffect(() => {
    let cancelled = false;

    const unlistenPromise = listen<GitHubCallbackPayload>(
      "github-callback",
      (event) => {
        if (cancelled) return;

        const { code, state, error, error_description } = event.payload;

        if (error || !code || !state) {
          console.error(
            "GitHub OAuth callback failed:",
            error_description ?? error ?? "missing code or state",
          );
          if (useLocalServer) startLocalServer().catch(() => {});
          return;
        }

        const effectiveCallbackUrl = useLocalServer
          ? localPortRef.current
            ? `http://127.0.0.1:${localPortRef.current}/auth/github/callback`
            : null
          : `${CONSOLE_URL}/auth/github/callback?source=desktop`;

        if (!effectiveCallbackUrl) {
          console.error("GitHub OAuth: no callback URL available for exchange");
          return;
        }

        connectionRef.current
          .handleCallback(code, state, effectiveCallbackUrl)
          .catch((err) => {
            console.error("GitHub OAuth token exchange failed:", err);
          });

        if (useLocalServer) startLocalServer().catch(() => {});
      },
    );

    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  }, [useLocalServer, startLocalServer]);

  return connection;
}
