import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ChooseServer } from "./ChooseServer";
import { QuietAction, ServerScreen } from "./ServerScreen";
import { hostOf } from "./connect";
import { useServer } from "./ServerProvider";

/** Where a self-hosted server's operator learns to let the desktop app sign in. */
export const DESKTOP_SIGN_IN_GUIDE =
  "https://stigmer.ai/docs/guides/self-hosting/authentication#let-the-desktop-app-sign-in";

/**
 * The screen while the app connects, and when the server it points at
 * cannot be used: nothing answered, something that is not a Stigmer server
 * answered, or the server signs people in but was not set up for the
 * desktop app. Each says what happened and offers another server; the
 * first two offer to try again.
 */
export function ConnectScreen() {
  const { origin, label, connection, retry } = useServer();
  const [choosing, setChoosing] = useState(false);
  const host = hostOf(origin);

  if (choosing || connection.phase === "unusable") {
    return (
      <ServerScreen>
        <div className="flex w-full flex-col gap-2 text-center">
          <h1 className="text-base font-medium text-foreground">Use another server</h1>
          {connection.phase === "unusable" && (
            <p role="alert" className="text-sm text-destructive">
              {connection.detail}
            </p>
          )}
        </div>
        <ChooseServer onCancel={connection.phase === "unusable" ? undefined : () => setChoosing(false)} />
      </ServerScreen>
    );
  }

  if (connection.phase === "connecting") {
    return (
      <ServerScreen>
        <div role="status" className="flex flex-col items-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Connecting to {host}&hellip;</p>
        </div>
      </ServerScreen>
    );
  }

  const useAnother = <QuietAction onClick={() => setChoosing(true)}>Use another server</QuietAction>;

  if (connection.phase === "failed") {
    const title =
      connection.failure === "unreachable" ? `Can't reach ${host}` : `${host} doesn't look like a Stigmer server`;
    const advice =
      connection.failure === "unreachable"
        ? "Check the address and your network, then try again."
        : "It answered, but not as a Stigmer server does. Check the address.";
    return (
      <ServerScreen>
        <div role="alert" className="flex w-full flex-col gap-2 text-center">
          <h1 className="text-base font-medium text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{advice}</p>
        </div>
        <div className="flex w-full flex-col items-center gap-4">
          <button
            type="button"
            onClick={retry}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RefreshCw className="size-4" />
            Try again
          </button>
          {useAnother}
        </div>
      </ServerScreen>
    );
  }

  // Connected, and the server signs people in without a client for the app.
  return (
    <ServerScreen>
      <div role="alert" className="flex w-full flex-col gap-2 text-center">
        <h1 className="text-base font-medium text-foreground">{label} isn&rsquo;t set up for the desktop app</h1>
        <p className="text-sm text-muted-foreground">
          This server signs people in, but its operator has not registered a client for the desktop app. Ask them
          to set one up.
        </p>
      </div>
      <div className="flex w-full flex-col items-center gap-4">
        <QuietAction onClick={() => void invoke("open_auth_in_browser", { authUrl: DESKTOP_SIGN_IN_GUIDE })}>
          How an operator sets it up
        </QuietAction>
        {useAnother}
      </div>
    </ServerScreen>
  );
}
