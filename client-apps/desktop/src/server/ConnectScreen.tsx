// The desktop app's server screens, on the kit's views: connecting to the
// server the person chose, why it can't be used, and choosing another
// (`ServerConnectionView`, `ServerChooserForm`). This file keeps the wiring
// only: the connection's state from `ServerProvider`, Tauri's browser for
// the operator's guide, and the app's mark.

import { invoke } from "@tauri-apps/api/core";
import { ServerChooserForm, ServerConnectionView, type ServerConnectionState } from "@stigmer/react-sdk/console";
import { useServer } from "./ServerProvider";
import { hostOf } from "./connect";
import { GateMark } from "../shell/GateMark";
import { ServerScreen } from "./ServerScreen";

/** Where a self-hosted server's operator learns to let the desktop app sign in. */
export const DESKTOP_SIGN_IN_GUIDE =
  "https://stigmer.ai/docs/guides/self-hosting/authentication#let-the-desktop-app-sign-in";

/**
 * "Use another server" in place of the app: from the sign-in screen, from a
 * server that cannot be used, and from "Change server" in the user menu.
 * Back returns to where the person was; a build whose own address is not
 * usable offers no way back.
 */
export function ChooseServerScreen() {
  const { origin, connection, choose, setChoosing } = useServer();
  const unusable = connection.phase === "unusable";
  return (
    <ServerScreen>
      <ServerChooserForm
        onChoose={choose}
        onBack={unusable ? undefined : () => setChoosing(false)}
        unusable={unusable ? { host: hostOf(origin), detail: connection.detail } : undefined}
        mark={<GateMark />}
      />
    </ServerScreen>
  );
}

/**
 * The chooser over the running app (from "Change server"): a dialog that
 * holds the keyboard's focus, so Back leaves the app (and the conversations
 * its agents hold) as it was.
 */
export function ChooseServerDialog() {
  const { choose, isChoosing, setChoosing } = useServer();
  return (
    <ServerScreen>
      <ServerChooserForm presentation="dialog" open={isChoosing} onChoose={choose} onBack={() => setChoosing(false)} />
    </ServerScreen>
  );
}

/**
 * The screen while the app connects, and when the server it points at
 * cannot be used: nothing answered, something that is not a Stigmer server
 * answered, or the server signs people in but was not set up for the
 * desktop app.
 */
export function ConnectScreen() {
  const { origin, label, connection, retry, isChoosing, setChoosing } = useServer();
  if (isChoosing || connection.phase === "unusable") {
    return <ChooseServerScreen />;
  }
  const state: ServerConnectionState =
    connection.phase === "connecting"
      ? { status: "connecting" }
      : connection.phase === "failed"
        ? { status: connection.failure === "unreachable" ? "unreachable" : "not-stigmer" }
        : { status: "not-set-up", serverName: label };
  return (
    <ServerScreen>
      <ServerConnectionView
        state={state}
        host={hostOf(origin)}
        onRetry={retry}
        onChooseAnother={() => setChoosing(true)}
        onOpenGuide={() => void invoke("open_auth_in_browser", { authUrl: DESKTOP_SIGN_IN_GUIDE })}
        mark={<GateMark />}
      />
    </ServerScreen>
  );
}
