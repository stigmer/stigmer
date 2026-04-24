import { useState } from "react";
import { LogIn, Loader2 } from "lucide-react";
import { useAuth } from "./AuthProvider";

/**
 * Login screen shown when the user is not authenticated (cloud mode).
 *
 * Clicking "Sign in" triggers the PKCE flow — opens the system browser
 * to Auth0, waits for the callback, and exchanges for tokens.
 */
export function LoginScreen() {
  const { login } = useAuth();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    setError(null);
    try {
      await login();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-8 bg-background text-foreground">
      <div className="flex flex-col items-center gap-4">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-primary">
          <span className="text-3xl font-bold text-primary-foreground">S</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Stigmer Desktop
        </h1>
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          Sign in to access your sessions, agents, and settings.
        </p>
      </div>

      <button
        onClick={handleLogin}
        disabled={isLoggingIn}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-60"
      >
        {isLoggingIn ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <LogIn className="size-4" />
        )}
        {isLoggingIn ? "Signing in…" : "Sign in with Auth0"}
      </button>

      {error && (
        <p className="max-w-sm text-center text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
