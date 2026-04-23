"use client";

import { useMemo } from "react";
import { getApiBaseUrl } from "@/config/env";

export type DeploymentMode = "local" | "cloud";

/**
 * Detects whether the web console is running against a local Go CLI backend
 * or a remote Java cloud backend based on the API base URL.
 *
 * Local mode: the API URL points to localhost (default: http://localhost:7234).
 * Cloud mode: any non-localhost URL.
 */
export function useDeploymentMode(): DeploymentMode {
  return useMemo(() => {
    try {
      const url = new URL(getApiBaseUrl());
      const host = url.hostname;
      if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
        return "local";
      }
    } catch {
      // Invalid URL — assume local for safety
      return "local";
    }
    return "cloud";
  }, []);
}
