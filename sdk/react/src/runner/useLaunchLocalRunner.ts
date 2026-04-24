"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { CreateLaunchTokenRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

const LAUNCH_RUNNER_SCHEME = "stigmer://launch-runner";

function defaultOpenUrl(url: string): void {
  window.location.href = url;
}

/** Options for {@link useLaunchLocalRunner}. */
export interface UseLaunchLocalRunnerOptions {
  /**
   * Custom handler for opening the `stigmer://` URL.
   *
   * Defaults to `window.location.href` assignment, which is the standard
   * browser pattern for dispatching custom URL schemes to the OS. The
   * browser does not navigate away — it hands the scheme to the OS and
   * the page stays on screen.
   *
   * Override this when embedding in non-standard environments (Electron,
   * iframe, React Native WebView) where the default browser mechanism
   * does not apply.
   */
  readonly openUrl?: (url: string) => void;
}

/** Result returned by a successful {@link UseLaunchLocalRunnerReturn.launch} call. */
export interface LaunchLocalRunnerResult {
  /** The `stigmer://launch-runner?token=...` URL that was opened. */
  readonly url: string;
  /**
   * Absolute expiry time of the launch token. The desktop app must
   * exchange the token before this time (typically 60 seconds).
   */
  readonly expiresAt: Date | undefined;
}

/** Return value of {@link useLaunchLocalRunner}. */
export interface UseLaunchLocalRunnerReturn {
  /**
   * Create a one-time launch token and open the `stigmer://` URL to
   * trigger the desktop app (or CLI fallback) to start a local runner.
   *
   * Resolves with the constructed URL and token expiry on success.
   * The caller cannot detect whether the desktop app received the URL —
   * use {@link useRunnerList} with `refetch()` to poll for the runner
   * appearing in the list.
   */
  readonly launch: (input: { org: string }) => Promise<LaunchLocalRunnerResult>;
  /** `true` while the token creation and URL dispatch are in flight. */
  readonly isLaunching: boolean;
  /** Error from the last failed launch attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that initiates a browser-to-desktop runner launch.
 *
 * Orchestrates two steps:
 * 1. Calls `stigmer.runner.createLaunchToken({ org })` to mint a
 *    one-time, 60-second token backed by the caller's credentials.
 * 2. Opens `stigmer://launch-runner?token={token}` so the OS dispatches
 *    to the Stigmer Desktop app (which exchanges the token for a JWT
 *    and starts a local runner via its CLI sidecar).
 *
 * The hook reports success when the URL is opened. It does **not**
 * detect whether the desktop app is installed or whether the runner
 * actually started — those are observable via `useRunnerList`.
 *
 * @example
 * ```tsx
 * function LaunchButton({ org }: { org: string }) {
 *   const { launch, isLaunching, error } = useLaunchLocalRunner();
 *
 *   return (
 *     <button onClick={() => launch({ org })} disabled={isLaunching}>
 *       {isLaunching ? "Launching…" : "Launch Local Runner"}
 *     </button>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Custom URL handler for non-browser environments
 * const { launch } = useLaunchLocalRunner({
 *   openUrl: (url) => nativeBridge.openExternal(url),
 * });
 * ```
 */
export function useLaunchLocalRunner(
  options?: UseLaunchLocalRunnerOptions,
): UseLaunchLocalRunnerReturn {
  const stigmer = useStigmer();
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const openUrl = options?.openUrl ?? defaultOpenUrl;

  const clearError = useCallback(() => setError(null), []);

  const launch = useCallback(
    async (input: { org: string }): Promise<LaunchLocalRunnerResult> => {
      setIsLaunching(true);
      setError(null);

      try {
        const response = await stigmer.runner.createLaunchToken(
          create(CreateLaunchTokenRequestSchema, { org: input.org }),
        );

        const url = `${LAUNCH_RUNNER_SCHEME}?token=${encodeURIComponent(response.token)}`;
        const expiresAt = response.expiresAt
          ? timestampDate(response.expiresAt)
          : undefined;

        openUrl(url);

        return { url, expiresAt };
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsLaunching(false);
      }
    },
    [stigmer, openUrl],
  );

  return { launch, isLaunching, error, clearError };
}
