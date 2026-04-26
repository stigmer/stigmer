import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider, OrgProvider } from "@stigmer/react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { Toaster } from "sonner";
import { router } from "./routes";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { LoginScreen } from "./auth/LoginScreen";
import { AppUpdaterProvider } from "./hooks/AppUpdaterContext";
import { useDeepLinkHandler } from "./hooks/useDeepLinkHandler";
import { useRunnerNotifications } from "./hooks/useRunnerNotifications";

const BASE_URL = import.meta.env.VITE_STIGMER_API_URL ?? "http://localhost:7234";

function isLocalMode(): boolean {
  try {
    const url = new URL(BASE_URL);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return true;
  }
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
  useRunnerNotifications();

  const deploymentMode = isLocalMode() ? "local" : "cloud";

  const client = useMemo(
    () =>
      new Stigmer({
        baseUrl: BASE_URL,
        getAccessToken,
        fetch: tauriFetch,
      }),
    [getAccessToken],
  );

  useDeepLinkHandler(client, BASE_URL, isAuthenticated);

  return (
    <StigmerProvider
      client={client}
      deploymentMode={deploymentMode}
      colorMode="system"
      preset="monochrome"
    >
      <AppContent isInitialized={isInitialized} isAuthenticated={isAuthenticated} />
    </StigmerProvider>
  );
}

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
      <OrgProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" richColors />
      </OrgProvider>
    </AppUpdaterProvider>
  );
}
