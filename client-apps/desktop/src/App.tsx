import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";
import { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "@stigmer/react";
import { Toaster } from "sonner";
import { router } from "./routes";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { OrgProvider } from "./org/OrgProvider";
import { LoginScreen } from "./auth/LoginScreen";
import { useAppUpdater } from "./hooks/useAppUpdater";
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
  const { getAccessToken, isAuthenticated, isLoading } = useAuth();
  useAppUpdater();
  useRunnerNotifications();

  const client = useMemo(
    () =>
      new Stigmer({
        baseUrl: BASE_URL,
        getAccessToken,
      }),
    [getAccessToken],
  );

  useDeepLinkHandler(client, BASE_URL, isAuthenticated);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  const deploymentMode = isLocalMode() ? "local" : "cloud";

  return (
    <StigmerProvider
      client={client}
      deploymentMode={deploymentMode}
      colorMode="system"
    >
      <OrgProvider>
        <RouterProvider router={router} />
        <Toaster position="bottom-right" richColors />
      </OrgProvider>
    </StigmerProvider>
  );
}
