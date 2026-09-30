import { useEffect, useMemo, useRef, useState } from "react";
import { RouterProvider } from "react-router-dom";
import { Stigmer } from "@stigmer/sdk";
import type { DeploymentMode } from "@stigmer/sdk";
import { StigmerProvider, OrgProvider, FetchCacheProvider } from "@stigmer/react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Toaster } from "sonner";
import { router } from "./routes";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginScreen } from "./auth/LoginScreen";
import { IdentityAccountGate } from "./identity/IdentityAccountGate";
import { AppUpdaterProvider } from "./hooks/AppUpdaterContext";
import { EmbeddedRunnerProvider, useRunner } from "./hooks/EmbeddedRunnerContext";
import { useTauriRunnerAdapter } from "./hooks/useTauriRunnerAdapter";
import { useColorModePreference } from "./hooks/useColorModePreference";
import { API_URL, fallbackDeploymentMode } from "./config";

function useServerDeploymentMode(client: Stigmer): DeploymentMode {
  const [mode, setMode] = useState<DeploymentMode>(() => fallbackDeploymentMode(API_URL));

  useEffect(() => {
    let cancelled = false;
    client.platform.getServerInfo().then(
      (info) => { if (!cancelled) setMode(info.deploymentMode); },
      (err) => {
        console.warn(
          "[stigmer] getServerInfo failed, using URL-based fallback:",
          err instanceof Error ? err.message : err,
        );
      },
    );
    return () => { cancelled = true; };
  }, [client]);

  return mode;
}

export function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

function AuthenticatedApp() {
  const { getAccessToken, isAuthenticated, isInitialized } = useAuth();
  const { colorMode } = useColorModePreference();

  const client = useMemo(
    () =>
      new Stigmer({
        baseUrl: API_URL,
        getAccessToken,
        fetch: tauriFetch,
      }),
    [getAccessToken],
  );

  const deploymentMode = useServerDeploymentMode(client);

  return (
    <EmbeddedRunnerProvider>
      <RunnerAdapterBridge
        client={client}
        deploymentMode={deploymentMode}
        colorMode={colorMode}
        isInitialized={isInitialized}
        isAuthenticated={isAuthenticated}
      />
    </EmbeddedRunnerProvider>
  );
}

/**
 * Bridge component that reads the runner adapter from EmbeddedRunnerProvider
 * context and passes it to StigmerProvider. Necessary because the adapter
 * depends on the runner context being available above it.
 */
function RunnerAdapterBridge({
  client,
  deploymentMode,
  colorMode,
  isInitialized,
  isAuthenticated,
}: {
  client: Stigmer;
  deploymentMode: DeploymentMode;
  colorMode: "light" | "dark" | "system";
  isInitialized: boolean;
  isAuthenticated: boolean;
}) {
  const runnerAdapter = useTauriRunnerAdapter();

  return (
    <StigmerProvider
      client={client}
      deploymentMode={deploymentMode}
      executionTarget="local"
      runnerAdapter={runnerAdapter}
      colorMode={colorMode}
      preset="monochrome"
    >
      <AppContent isInitialized={isInitialized} isAuthenticated={isAuthenticated} />
    </StigmerProvider>
  );
}

/**
 * The signed-in app, in the order the web console's `Providers.tsx` keeps:
 *
 * 1. AppUpdaterProvider   — update checks run whatever the gates below show
 * 2. TokenBridge          — keeps the embedded runner's token fresh, gates or not
 * 3. IdentityAccountGate  — the person's account exists (provisioned on a first
 *                           sign-in, with the personal organization on Cloud)
 * 4. FetchCacheProvider   — above OrgProvider so an org switch can clear it
 * 5. OrgProvider          — asks for the person's organizations, which is why
 *                           the identity gate must come first
 * 6. RouterProvider       — the routes, with OrgGate inside the app shell
 */
function AppContent({
  isInitialized,
  isAuthenticated,
}: {
  isInitialized: boolean;
  isAuthenticated: boolean;
}) {
  if (!isInitialized) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <AppUpdaterProvider>
      <TokenBridge />
      <IdentityAccountGate>
        <FetchCacheProvider>
          <OrgProvider>
            <RouterProvider router={router} />
            <Toaster position="bottom-right" richColors />
          </OrgProvider>
        </FetchCacheProvider>
      </IdentityAccountGate>
    </AppUpdaterProvider>
  );
}

/**
 * Watches the Auth0 token and pushes refreshes to the embedded runner.
 * Rendered inside both AuthProvider and EmbeddedRunnerProvider so it
 * can read from useAuth and write via useRunner.
 *
 * This updates the runner's CONTROL-PLANE credential only. The runner's
 * Cursor-proxy credential is a separate, server-minted token the runner owns
 * and refreshes itself (see runner-manager.ts); pushing the Auth0 token here
 * must not — and does not — overwrite it. Keeping the Auth0 token fresh is what
 * lets the runner re-mint its proxy token indefinitely.
 */
function TokenBridge() {
  const { getAccessToken } = useAuth();
  const { updateRunnerToken, isRunning } = useRunner();
  const lastTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isRunning) return;
    const token = getAccessToken();
    if (token !== lastTokenRef.current) {
      lastTokenRef.current = token;
      updateRunnerToken(token).catch(() => {});
    }
  });

  return null;
}
