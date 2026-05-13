"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { useTheme } from "next-themes";
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "@stigmer/react";
import type { ResolvedColorMode } from "@stigmer/react";
import { useAuth } from "@/auth/use-auth";
import { getApiBaseUrl } from "@/config/env";
import { useDeploymentMode } from "@/domain/_shared/hooks/useDeploymentMode";

/**
 * Bridges the console's auth system to the Stigmer SDK provider.
 *
 * Creates a {@link Stigmer} client configured with the current user's
 * access token and an auth-redirect handler (auto-logout on
 * UNAUTHENTICATED responses). The client instance is memoized on the
 * token-provider callback to avoid unnecessary re-creation.
 *
 * Also derives the deployment mode from the API URL hostname and the
 * color mode from `next-themes`, passing both to the SDK provider.
 *
 * Must be rendered as a child of `AuthGuard` (auth must be resolved first).
 */
export function StigmerTransportBridge({ children }: { children: ReactNode }) {
  const { accessToken, logout } = useAuth();
  const { resolvedTheme } = useTheme();
  const colorMode: ResolvedColorMode =
    resolvedTheme === "dark" ? "dark" : "light";

  const getAccessToken = useCallback(() => accessToken, [accessToken]);
  const onUnauthenticated = useCallback(() => logout(), [logout]);

  const client = useMemo(
    () =>
      new Stigmer({
        baseUrl: getApiBaseUrl(),
        getAccessToken,
        onUnauthenticated,
      }),
    [getAccessToken, onUnauthenticated],
  );

  const deploymentMode = useDeploymentMode(client);

  return (
    <StigmerProvider
      client={client}
      deploymentMode={deploymentMode}
      colorMode={colorMode}
      preset="monochrome"
    >
      {children}
    </StigmerProvider>
  );
}
