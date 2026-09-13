"use client";

import { useEffect, useMemo, useState } from "react";
import type { Stigmer, DeploymentMode } from "@stigmer/sdk";
import { getApiBaseUrl } from "@/config/env";

export type { DeploymentMode };

/**
 * The deployment mode as the console knows it right now.
 *
 * `resolved` tells the guess from the answer (20260913.02): until
 * `getServerInfo` has replied, `mode` is a hostname guess — "local" for
 * localhost, "cloud" for any other host, so "cloud" for every self-host.
 * A surface that must not render the wrong shape (the sign-in page, whose
 * SSO prompt depends on the edition's tiers) waits for `resolved`; a
 * surface that only tunes itself (the SDK provider's `deploymentMode`)
 * reads `mode` at once and corrects on the next frame.
 */
export interface ResolvedDeploymentMode {
  readonly mode: DeploymentMode;
  readonly resolved: boolean;
}

function fallbackDeploymentMode(): DeploymentMode {
  try {
    const url = new URL(getApiBaseUrl());
    const host = url.hostname;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
      return "local";
    }
  } catch {
    return "local";
  }
  return "cloud";
}

/**
 * Detects the deployment mode by querying the server's `getServerInfo`
 * RPC. Starts from the URL-based hostname guess and replaces it with the
 * server's answer; when the server cannot answer (an older server without
 * the RPC, or no server at all) the guess becomes the resolved answer —
 * the fallback is the best there is, and a skeleton that never lifts
 * would serve nobody.
 */
export function useDeploymentMode(client?: Stigmer): ResolvedDeploymentMode {
  const [state, setState] = useState<ResolvedDeploymentMode>(() => ({
    mode: fallbackDeploymentMode(),
    resolved: false,
  }));

  const stableClient = useMemo(() => client, [client]);

  useEffect(() => {
    if (!stableClient) return;
    let cancelled = false;
    stableClient.platform.getServerInfo().then(
      (info) => {
        if (!cancelled) setState({ mode: info.deploymentMode, resolved: true });
      },
      () => {
        if (!cancelled)
          setState((prev) => ({ mode: prev.mode, resolved: true }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [stableClient]);

  return state;
}
