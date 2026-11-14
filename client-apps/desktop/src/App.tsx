import { useEffect, useMemo, useRef } from "react";
import { RouterProvider } from "react-router-dom";
import { Stigmer } from "@stigmer/client";
import type { DeploymentMode } from "@stigmer/client";
import { StigmerProvider, OrgProvider, FetchCacheProvider } from "@stigmer/react-sdk";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Toaster } from "sonner";
import { router, startOnAnotherServer } from "./routes";
import { loadMermaid } from "./load-mermaid";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginScreen } from "./auth/LoginScreen";
import { IdentityAccountGate } from "./identity/IdentityAccountGate";
import { AppUpdaterProvider } from "./hooks/AppUpdaterContext";
import { EmbeddedRunnerProvider, useRunner } from "./hooks/EmbeddedRunnerContext";
import { useTauriRunnerAdapter } from "./hooks/useTauriRunnerAdapter";
import { useColorModePreference } from "./hooks/useColorModePreference";
import { ServerProvider, useServer } from "./server/ServerProvider";
import { ChooseServerScreen, ConnectScreen } from "./server/ConnectScreen";

/**
 * The app: the server the person chose (server/ServerProvider.tsx), what it
 * said when the app connected, and then the app itself. The server's answer
 * picks everything after it, never its address: a server that trusts every
 * request opens the app; one that signs people in shows the sign-in screen
 * for the provider it announced; anything else shows why it cannot be used
 * (server/ConnectScreen.tsx).
 */
export function App() {
  return (
    <ServerProvider onServerChanged={startOnAnotherServer}>
      <ServerGate />
    </ServerProvider>
  );
}

function ServerGate() {
  const { origin, connection, isChoosing } = useServer();
  if (connection.phase !== "connected" || connection.outcome.kind === "not-set-up") {
    return <ConnectScreen />;
  }
  const app = <AuthenticatedApp server={origin} deploymentMode={connection.deploymentMode} />;
  return (
    <>
      {connection.outcome.kind === "open" ? (
        <AuthProvider mode="open">{app}</AuthProvider>
      ) : (
        <AuthProvider mode="sign-in" server={origin} nativeSignIn={connection.outcome.nativeSignIn}>
          {app}
        </AuthProvider>
      )}
      {/* Over the app, not in its place: Back leaves the app (and the
          conversations its runner holds) as it was. */}
      {isChoosing && (
        <div role="dialog" aria-modal="true" aria-label="Use another server" className="fixed inset-0 z-50">
          <ChooseServerScreen />
        </div>
      )}
    </>
  );
}

function AuthenticatedApp({ server, deploymentMode }: { server: string; deploymentMode: DeploymentMode }) {
  const { getAccessToken, isAuthenticated, isInitialized } = useAuth();
  const { colorMode } = useColorModePreference();

  const client = useMemo(
    () =>
      new Stigmer({
        baseUrl: server,
        getAccessToken,
        fetch: tauriFetch,
      }),
    [server, getAccessToken],
  );

  return (
    <EmbeddedRunnerProvider server={server} getAccessToken={getAccessToken}>
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
      loadMermaid={loadMermaid}
      // The app's failure notes end with the server's help link.
      showHelpLink
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
 *                           sign-in, with its first organization on Cloud)
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
 * Watches the access token and pushes refreshes to the embedded runner.
 * Rendered inside both AuthProvider and EmbeddedRunnerProvider so it
 * can read from useAuth and write via useRunner.
 *
 * This updates the runner's CONTROL-PLANE credential only. The runner's
 * LLM proxy credential is a separate, server-minted token the runner owns
 * and refreshes itself (see runner-manager.ts); pushing the access token here
 * must not — and does not — overwrite it. Keeping the access token fresh is what
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
