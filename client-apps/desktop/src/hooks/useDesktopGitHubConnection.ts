import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  useGitHubConnection,
  useDeploymentMode,
  type UseGitHubConnectionReturn,
  type UseGitHubConnectionConfig,
  type SignInReturnTo,
} from "@stigmer/react";

/**
 * Payload of the `sign-in-callback` Tauri event.
 *
 * Emitted by two sources depending on deployment mode:
 * - **Cloud:** The `stigmer://oauth/callback` deep link handler in
 *   `lib.rs` (code + state relayed by the web console's callback page).
 * - **Local:** The `start_sign_in_callback_server` Rust command (code +
 *   state captured by the loopback HTTP server).
 */
interface SignInCallbackPayload {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

/**
 * Desktop-aware wrapper around {@link useGitHubConnection}.
 *
 * Tauri's Wry webview blocks `window.open()`, so the SDK's popup sign-in
 * does not work in the desktop app. GitHub is connected by the vault's
 * sign-in at `github.com` like any other address; this hook only chooses
 * where the login page returns, by deployment mode:
 *
 * ### Cloud mode
 *
 * Opens the system browser with the login page, returning to the Stigmer
 * web console's callback page with the desktop bridge (`returnTo:
 * desktop`; the server builds the address). The page redirects to
 * `stigmer://oauth/callback?code=...&state=...`, the Tauri deep link
 * handler emits a `sign-in-callback` event, and this hook completes the
 * sign-in through `handleCallback()`.
 *
 * ### Local mode
 *
 * Starts a one-shot loopback HTTP server via the Rust
 * `start_sign_in_callback_server` command and returns there (`returnTo:
 * loopback` with its port, RFC 8252 section 7.3: GitHub accepts a loopback
 * redirect on any port). The server captures the code and state and emits
 * the same `sign-in-callback` event.
 *
 * The returned object has the same shape as `useGitHubConnection`,
 * so it can be passed directly to `SessionComposer` /
 * `WorkspaceEditor`.
 */
export function useDesktopGitHubConnection(
  org: string | null,
): UseGitHubConnectionReturn {
  const deploymentMode = useDeploymentMode();
  // The hosted callback page (and its stigmer:// deep link) is a cloud-only
  // facility; every other edition completes the flow through the loopback
  // callback server.
  const isCloud = deploymentMode === "cloud";

  // In dev mode the production .app bundle owns the stigmer:// protocol,
  // so deep links never reach the dev instance. Use the loopback
  // callback server instead, matching the Auth0 flow in AuthProvider.
  const useLocalServer = !isCloud || import.meta.env.DEV;

  // ── Loopback callback server ──────────────────────────────────────
  const [localPort, setLocalPort] = useState<number | null>(null);

  const startLocalServer = useCallback(async (): Promise<number> => {
    const p = await invoke<number>("start_sign_in_callback_server");
    setLocalPort(p);
    return p;
  }, []);

  useEffect(() => {
    if (!useLocalServer) return;
    startLocalServer().catch((err) => {
      console.error("Failed to start the sign-in callback server:", err);
    });
  }, [useLocalServer, startLocalServer]);

  // ── Resolve where the login page returns ──────────────────────────
  const openUrl = useCallback(async (url: string) => {
    await invoke("open_auth_in_browser", { authUrl: url });
  }, []);

  const config: UseGitHubConnectionConfig | undefined = useMemo(() => {
    const returnTo: SignInReturnTo | undefined = useLocalServer
      ? localPort
        ? { kind: "loopback", port: localPort }
        : undefined
      : { kind: "desktop" };
    return returnTo ? { openUrl, returnTo } : undefined;
  }, [openUrl, useLocalServer, localPort]);

  const connection = useGitHubConnection(org, config);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;

  // ── Listen for the sign-in-callback event ─────────────────────────
  // Both cloud (deep link) and local (loopback server) flows emit the
  // same `sign-in-callback` Tauri event with code + state.
  useEffect(() => {
    let cancelled = false;

    const unlistenPromise = listen<SignInCallbackPayload>(
      "sign-in-callback",
      (event) => {
        if (cancelled) return;

        const { code, state, error, error_description } = event.payload;

        if (error || !code || !state) {
          console.error(
            "GitHub sign-in callback failed:",
            error_description ?? error ?? "missing code or state",
          );
          if (useLocalServer) startLocalServer().catch(() => {});
          return;
        }

        connectionRef.current.handleCallback(code, state).catch((err) => {
          console.error("GitHub sign-in failed:", err);
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
