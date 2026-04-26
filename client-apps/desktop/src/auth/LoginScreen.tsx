import { useCallback, useState } from "react";
import { ExternalLink, Loader2, Mail, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "./AuthProvider";

type ScreenState =
  | { kind: "idle" }
  | { kind: "waiting"; connection?: string }
  | { kind: "error"; message: string };

/**
 * Branded login screen shown when the user is not authenticated.
 *
 * Presents sign-in options inside the app. Clicking any option opens the
 * system browser for the OIDC flow — passkeys, Touch ID, and fingerprint
 * work because the auth happens in a real browser, not a webview.
 */
export function LoginScreen() {
  const { login } = useAuth();
  const [state, setState] = useState<ScreenState>({ kind: "idle" });

  const startLogin = useCallback(
    async (connection?: string) => {
      setState({ kind: "waiting", connection });
      try {
        await login(connection);
      } catch (err) {
        if (err instanceof Error && err.name === "LoginCancelledError") {
          setState({ kind: "idle" });
          return;
        }
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Login failed",
        });
      }
    },
    [login],
  );

  const cancelLogin = useCallback(() => {
    invoke("cancel_auth").catch(() => {});
    setState({ kind: "idle" });
  }, []);

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background p-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary">
            <span className="text-2xl font-bold text-primary-foreground">S</span>
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              Sign in to Stigmer
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose how you'd like to sign in
            </p>
          </div>
        </div>

        {state.kind === "idle" && (
          <IdleView onGoogle={() => startLogin("google-oauth2")} onEmail={() => startLogin()} />
        )}

        {state.kind === "waiting" && (
          <WaitingView onReopen={() => startLogin(state.connection)} onCancel={cancelLogin} />
        )}

        {state.kind === "error" && (
          <ErrorView message={state.message} onRetry={() => setState({ kind: "idle" })} />
        )}
      </div>
    </div>
  );
}

function IdleView({
  onGoogle,
  onEmail,
}: {
  onGoogle: () => void;
  onEmail: () => void;
}) {
  return (
    <div className="flex w-full flex-col gap-3">
      <button
        type="button"
        onClick={onGoogle}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <GoogleIcon />
        Sign in with Google
      </button>

      <div className="relative my-1">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onEmail}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Mail className="size-4" />
        Sign in with Email
      </button>
    </div>
  );
}

function WaitingView({
  onReopen,
  onCancel,
}: {
  onReopen: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Completing sign-in in your browser&hellip;
        </p>
      </div>

      <div className="flex items-center gap-4 text-xs">
        <button
          type="button"
          onClick={onReopen}
          className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ExternalLink className="size-3" />
          Reopen browser
        </button>
        <span className="text-border">|</span>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ErrorView({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <p className="max-w-xs text-center text-sm text-destructive">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        <RefreshCw className="size-4" />
        Try again
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  );
}
