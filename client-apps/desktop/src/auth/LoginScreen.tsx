import { useCallback, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useAuth } from "./AuthProvider";

type ScreenState =
  | { kind: "idle" }
  | { kind: "waiting"; connection?: string }
  | { kind: "error"; message: string };

/**
 * Branded login screen shown when the user is not authenticated.
 *
 * Minimal, Slack-style design: logo mark + single CTA that opens the
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
      <div className="flex w-full max-w-xs flex-col items-center gap-8">
        <img
          src="/stigmer_light.svg"
          alt="Stigmer"
          className="size-14 rounded-2xl"
        />

        {state.kind === "idle" && (
          <button
            type="button"
            onClick={() => startLogin()}
            className="w-full rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in
          </button>
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

