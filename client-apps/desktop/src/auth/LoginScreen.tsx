import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useAuth } from "./AuthProvider";

/**
 * Shown when the user is not authenticated (cloud mode).
 *
 * Automatically triggers Auth0 login on mount, which displays
 * Auth0's Universal Login as a full-window overlay webview. The
 * React content behind the overlay is a simple loading spinner.
 *
 * If login fails, the overlay is removed and this component shows
 * the error with a retry button.
 */
export function LoginScreen() {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const autoLoginRef = useRef(false);

  const tryLogin = useCallback(async () => {
    setError(null);
    try {
      await login();
    } catch (err) {
      if (err instanceof Error && err.name === "LoginCancelledError") return;
      setError(err instanceof Error ? err.message : "Login failed");
    }
  }, [login]);

  useEffect(() => {
    if (autoLoginRef.current) return;
    autoLoginRef.current = true;
    tryLogin();
  }, [tryLogin]);

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary">
            <span className="text-3xl font-bold text-primary-foreground">
              S
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Stigmer Desktop
          </h1>
        </div>
        <p className="max-w-sm text-center text-sm text-destructive">
          {error}
        </p>
        <button
          onClick={tryLogin}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          <RefreshCw className="size-4" />
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="size-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  );
}
