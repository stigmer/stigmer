"use client";

import { useCallback } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { useStigmer } from "../hooks";

/**
 * Resolved credential bundle for starting a runner sidecar process.
 *
 * Contains everything a CLI sidecar needs to authenticate with the
 * Stigmer backend — the Bearer token (Auth0 JWT, PlatformClient JWT,
 * or API key), the API endpoint, and the organization scope.
 */
export interface RunnerCredential {
  /** Bearer token or API key. `null` when no credential is available. */
  readonly token: string | null;
  /** Base URL of the Stigmer API server (e.g., "https://api.stigmer.ai"). */
  readonly endpoint: string;
  /** Organization slug, if provided. */
  readonly org?: string;
}

/** Return value of {@link useRunnerCredential}. */
export interface UseRunnerCredentialReturn {
  /**
   * Resolve the current authentication credential for a runner sidecar.
   *
   * Reads the credential from the {@link Stigmer} client configured in
   * the nearest `StigmerProvider`. Works with any auth mode: static API
   * key, dynamic token provider (Auth0, PlatformClient), or custom
   * transport.
   *
   * @param org - Optional organization slug to include in the result.
   * @returns The credential bundle for the sidecar process.
   */
  readonly getCredential: (org?: string) => Promise<RunnerCredential>;
}

/**
 * Behavior hook that resolves the current auth credential for passing
 * to a runner sidecar process.
 *
 * This is the SDK-level abstraction for starting runners from within
 * a desktop or native application — where the app already holds the
 * credential and needs to hand it to a CLI child process. It avoids
 * the `createLaunchToken` / `exchangeLaunchToken` round-trip, which
 * is only needed for cross-process browser-to-desktop handshakes
 * (see {@link useLaunchLocalRunner} for that scenario).
 *
 * The hook reads from `useStigmer()` and calls
 * `client.getAuthCredential()`, so it works identically regardless
 * of auth mode (Auth0 JWT, PlatformClient JWT, API key).
 *
 * @example
 * ```tsx
 * function StartRunnerButton({ org }: { org: string }) {
 *   const { getCredential } = useRunnerCredential();
 *
 *   const handleStart = async () => {
 *     const cred = await getCredential(org);
 *     // Pass cred.token, cred.endpoint, cred.org to your sidecar
 *     await nativeBridge.startRunner({
 *       token: cred.token,
 *       endpoint: cred.endpoint,
 *       org: cred.org,
 *     });
 *   };
 *
 *   return <button onClick={handleStart}>Start Runner</button>;
 * }
 * ```
 */
export function useRunnerCredential(): UseRunnerCredentialReturn {
  const stigmer = useStigmer();

  const getCredential = useCallback(
    async (org?: string): Promise<RunnerCredential> => {
      const token = await stigmer.getAuthCredential();
      return {
        token,
        endpoint: stigmer.baseUrl,
        org,
      };
    },
    [stigmer],
  );

  return { getCredential };
}
