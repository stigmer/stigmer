"use client";

import { useEffect, useMemo, useState } from "react";
import type { Stigmer, DeploymentMode } from "@stigmer/sdk";
import { getApiBaseUrl } from "@/config/env";

export type { DeploymentMode };

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
 * Detects the deployment mode by querying the server's
 * `getServerInfo` RPC. Falls back to URL-based hostname guessing
 * when the server does not implement the RPC (older servers).
 */
export function useDeploymentMode(client?: Stigmer): DeploymentMode {
  const [mode, setMode] = useState<DeploymentMode>(fallbackDeploymentMode);

  const stableClient = useMemo(() => client, [client]);

  useEffect(() => {
    if (!stableClient) return;
    let cancelled = false;
    stableClient.platform.getServerInfo().then(
      (info) => { if (!cancelled) setMode(info.deploymentMode); },
      () => { /* keep URL-based fallback for older servers */ },
    );
    return () => { cancelled = true; };
  }, [stableClient]);

  return mode;
}
