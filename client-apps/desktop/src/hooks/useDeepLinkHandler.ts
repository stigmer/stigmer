import { useEffect, useRef, useCallback } from "react";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { create } from "@bufbuild/protobuf";
import { ExchangeLaunchTokenRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/io_pb";
import { toast } from "sonner";
import type { Stigmer } from "@stigmer/sdk";
import { invokeStartRunner } from "./tauri";
import { toGrpcTarget } from "../lib/grpc-target";
import { router } from "../routes";

const TOAST_ID = "deep-link-launch";

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

interface LaunchRunnerParams {
  token: string;
}

function isAuthCallback(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "stigmer:" && url.hostname === "auth";
  } catch {
    return false;
  }
}

function parseLaunchRunnerUrl(raw: string): LaunchRunnerParams | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "stigmer:") return null;

  // stigmer://launch-runner?token=...
  // URL constructor parses the host as "launch-runner"
  if (url.hostname !== "launch-runner" && url.pathname !== "//launch-runner") {
    return null;
  }

  const token = url.searchParams.get("token");
  if (!token) return null;

  return { token };
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function describeExchangeError(err: unknown): string {
  const msg = String(err).toLowerCase();

  if (msg.includes("not_found") || msg.includes("not found")) {
    return "The launch token has expired or was already used. Please try again from the browser.";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("connect")) {
    return "Could not reach the Stigmer server. Check your network connection and try again.";
  }
  if (msg.includes("unauthenticated") || msg.includes("unauthorized")) {
    return "Authentication error during token exchange. Please log in again.";
  }
  return "Failed to exchange the launch token. Please try again from the browser.";
}

function describeSidecarError(err: unknown): string {
  const msg = String(err).toLowerCase();

  if (msg.includes("already managed")) {
    return "A runner with that name is already running on this machine.";
  }
  if (msg.includes("sidecar") || msg.includes("spawn")) {
    return "Failed to start the runner process. The CLI sidecar may be missing — try reinstalling the desktop app.";
  }
  return `Failed to start the runner: ${String(err)}`;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Listens for `stigmer://` deep links and orchestrates the launch-token
 * exchange + runner start flow.
 *
 * Handles both warm dispatch (app already running, URL forwarded via
 * single-instance plugin) and cold start (app launched by the OS with
 * the URL as a CLI argument).
 *
 * When the app is not yet authenticated, incoming URLs are queued and
 * processed once authentication completes.
 *
 * Mount once in `AuthenticatedApp`, alongside `useAppUpdater` and
 * `useRunnerNotifications`.
 */
export function useDeepLinkHandler(
  client: Stigmer,
  baseUrl: string,
  isAuthenticated: boolean,
): void {
  const busyRef = useRef(false);
  const pendingUrlRef = useRef<string | null>(null);
  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;

  const clientRef = useRef(client);
  clientRef.current = client;

  const baseUrlRef = useRef(baseUrl);
  baseUrlRef.current = baseUrl;

  const handleUrl = useCallback(async (raw: string) => {
    if (isAuthCallback(raw)) return;

    const params = parseLaunchRunnerUrl(raw);
    if (!params) return;

    if (!isAuthenticatedRef.current) {
      pendingUrlRef.current = raw;
      return;
    }

    if (busyRef.current) return;
    busyRef.current = true;

    toast.loading("Launching runner from browser...", { id: TOAST_ID });

    try {
      const response = await clientRef.current.runner.exchangeLaunchToken(
        create(ExchangeLaunchTokenRequestSchema, { token: params.token }),
      );

      await invokeStartRunner({
        token: response.accessToken,
        endpoint: toGrpcTarget(baseUrlRef.current),
        org: response.org || undefined,
      });

      toast.success("Runner launched successfully", {
        id: TOAST_ID,
        action: {
          label: "View Runners",
          onClick: () => router.navigate("/runners"),
        },
      });
    } catch (err) {
      const isExchangeError =
        String(err).includes("exchangeLaunchToken") ||
        String(err).includes("NOT_FOUND") ||
        String(err).includes("not found");

      const message = isExchangeError
        ? describeExchangeError(err)
        : describeSidecarError(err);

      toast.error(message, { id: TOAST_ID });
    } finally {
      busyRef.current = false;
    }
  }, []);

  // Cold start: check if the app was launched via a deep link.
  useEffect(() => {
    getCurrent()
      .then((urls) => {
        if (urls && urls.length > 0) {
          handleUrl(urls[0]);
        }
      })
      .catch(() => {
        // getCurrent can fail on platforms that don't support it — safe to ignore.
      });
  }, [handleUrl]);

  // Warm dispatch: listen for URLs arriving while the app is running.
  useEffect(() => {
    const unlistenPromise = onOpenUrl((urls) => {
      if (urls.length > 0) {
        handleUrl(urls[0]);
      }
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [handleUrl]);

  // Process any queued URL once authentication completes.
  useEffect(() => {
    if (isAuthenticated && pendingUrlRef.current) {
      const url = pendingUrlRef.current;
      pendingUrlRef.current = null;
      handleUrl(url);
    }
  }, [isAuthenticated, handleUrl]);
}
