import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SignInView, type SignInState } from "@stigmer/react-sdk/console";
import { SIGN_IN_CANCELLED, useAuth } from "./AuthProvider";
import { useServer } from "../server/ServerProvider";
import { hostOf } from "../server/connect";
import { GateMark } from "../shell/GateHeader";

/**
 * The sign-in screen for a server that signs people in.
 *
 * The kit's `SignInView`, the web console's sign-in screen too: the mark,
 * the server's name, one action that opens the system browser for the
 * provider the server announced, so passkeys, Touch ID and the person's
 * existing session work. "Use another server" points the app elsewhere.
 *
 * A provider on another site than the server's is named before the browser
 * opens, with the server's address (never the name the server gave itself):
 * a server a person was talked into choosing could announce a company's
 * real provider to collect tokens the company's server accepts.
 */
export function LoginScreen() {
  const { login, provider } = useAuth();
  const { label, origin, setChoosing } = useServer();
  const [state, setState] = useState<SignInState>({ status: "ready" });
  const elsewhere = provider !== null && !provider.sameSite;

  const startLogin = useCallback(async () => {
    setState({ status: "waiting" });
    try {
      await login({ providerConfirmed: elsewhere });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setState(
        error.message === SIGN_IN_CANCELLED
          ? { status: "ready" }
          : { status: "failed", error, headline: "The sign-in didn't finish." },
      );
    }
  }, [login, elsewhere]);

  const cancelLogin = useCallback(() => {
    invoke("auth_cancel").catch(() => {});
    setState({ status: "ready" });
  }, []);

  const reopenBrowser = useCallback(() => {
    invoke("auth_reopen_browser").catch(() => {});
  }, []);

  return (
    <SignInView
      state={state}
      serverName={label}
      lead={hostOf(origin)}
      onSignIn={provider !== null ? () => void startLogin() : undefined}
      elsewhere={elsewhere && provider !== null ? { server: hostOf(origin), provider: provider.host } : undefined}
      onReopen={reopenBrowser}
      onCancel={cancelLogin}
      onUseAnotherServer={() => setChoosing(true)}
      mark={<GateMark />}
    />
  );
}
