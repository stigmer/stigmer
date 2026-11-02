import { useCallback, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { SIGN_IN_CANCELLED, useAuth } from "./AuthProvider";
import { useServer } from "../server/ServerProvider";
import { ChooseServer } from "../server/ChooseServer";
import { QuietAction, ServerScreen } from "../server/ServerScreen";

type ScreenState =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "choosing" }
  | { kind: "error"; message: string };

/**
 * The sign-in screen for a server that signs people in.
 *
 * Minimal, Slack-style design: the mark, the server's name, one action
 * that opens the system browser for the provider the server announced, so
 * passkeys, Touch ID and the person's existing session work. "Use another
 * server" points the app elsewhere.
 */
export function LoginScreen() {
  const { login } = useAuth();
  const { label } = useServer();
  const [state, setState] = useState<ScreenState>({ kind: "idle" });

  const startLogin = useCallback(async () => {
    setState({ kind: "waiting" });
    try {
      await login();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState(message === SIGN_IN_CANCELLED ? { kind: "idle" } : { kind: "error", message });
    }
  }, [login]);

  const cancelLogin = useCallback(() => {
    invoke("auth_cancel").catch(() => {});
    setState({ kind: "idle" });
  }, []);

  const reopenBrowser = useCallback(() => {
    invoke("auth_reopen_browser").catch(() => {});
  }, []);

  if (state.kind === "choosing") {
    return (
      <ServerScreen>
        <h1 className="text-base font-medium text-foreground">Use another server</h1>
        <ChooseServer onCancel={() => setState({ kind: "idle" })} />
      </ServerScreen>
    );
  }

  return (
    <ServerScreen>
      {state.kind === "idle" && (
        <div className="flex w-full flex-col items-center gap-4">
          <button
            type="button"
            onClick={() => void startLogin()}
            className="w-full rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in to {label}
          </button>
          <QuietAction onClick={() => setState({ kind: "choosing" })}>Use another server</QuietAction>
        </div>
      )}

      {state.kind === "waiting" && <WaitingView onReopen={reopenBrowser} onCancel={cancelLogin} />}

      {state.kind === "error" && <ErrorView message={state.message} onRetry={() => setState({ kind: "idle" })} />}
    </ServerScreen>
  );
}

function WaitingView({ onReopen, onCancel }: { onReopen: () => void; onCancel: () => void }) {
  return (
    <div className="flex w-full flex-col items-center gap-5">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Completing sign-in in your browser&hellip;</p>
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

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <p role="alert" className="max-w-xs text-center text-sm text-destructive">
        {message}
      </p>
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
