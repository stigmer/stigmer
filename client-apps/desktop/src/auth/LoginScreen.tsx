import { useCallback, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@stigmer/react-sdk";
import { SIGN_IN_CANCELLED, useAuth } from "./AuthProvider";
import { useServer } from "../server/ServerProvider";
import { hostOf } from "../server/connect";
import { QuietAction, ServerScreen } from "../server/ServerScreen";

type ScreenState = { kind: "idle" } | { kind: "waiting" } | { kind: "error"; message: string };

/**
 * The sign-in screen for a server that signs people in.
 *
 * Minimal, Slack-style design: the mark, the server's name, one action
 * that opens the system browser for the provider the server announced, so
 * passkeys, Touch ID and the person's existing session work. "Use another
 * server" points the app elsewhere.
 *
 * A provider on another site than the server's is named before the browser
 * opens, with the server's address (never the name the server gave itself):
 * a server a person was talked into choosing could announce a company's
 * real provider to collect tokens the company's server accepts.
 */
export function LoginScreen() {
  const { login, provider } = useAuth();
  const { label, origin, setChoosing } = useServer();
  const [state, setState] = useState<ScreenState>({ kind: "idle" });
  const elsewhere = provider !== null && !provider.sameSite;

  const startLogin = useCallback(async () => {
    setState({ kind: "waiting" });
    try {
      await login({ providerConfirmed: elsewhere });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState(message === SIGN_IN_CANCELLED ? { kind: "idle" } : { kind: "error", message });
    }
  }, [login, elsewhere]);

  const cancelLogin = useCallback(() => {
    invoke("auth_cancel").catch(() => {});
    setState({ kind: "idle" });
  }, []);

  const reopenBrowser = useCallback(() => {
    invoke("auth_reopen_browser").catch(() => {});
  }, []);

  return (
    <ServerScreen>
      {state.kind === "idle" && (
        <div className="flex w-full flex-col items-center gap-4">
          {provider !== null && elsewhere && (
            <div className="flex max-w-xs flex-col gap-1 text-center text-sm">
              <p className="text-foreground">
                {hostOf(origin)} signs people in at {provider.host}, on another site.
              </p>
              <p className="text-muted-foreground">
                Go on only if you trust {hostOf(origin)} with your {provider.host} account.
              </p>
            </div>
          )}
          {provider !== null && (
            <button
              type="button"
              onClick={() => void startLogin()}
              className="w-full rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {elsewhere ? `Sign in at ${provider.host}` : `Sign in to ${label}`}
            </button>
          )}
          <QuietAction onClick={() => setChoosing(true)}>Use another server</QuietAction>
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
      <Button icon={<RefreshCw className="size-4" />} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
