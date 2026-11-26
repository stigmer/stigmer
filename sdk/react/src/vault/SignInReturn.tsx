"use client";

/**
 * The page a login page sends a person back to after a sign-in at an
 * address: hands the answer to Stigmer ({@link useSignInReturn}) and says
 * only what it knows. It never says "Connected": the sign-in finishes in
 * the app or terminal that started it, which says "Signed in".
 */
import { useEffect } from "react";
import { isTransientStreamError } from "@stigmer/client";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { ScreenColumn } from "../internal/ScreenColumn.js";
import { ScreenWait } from "../standalone-screen/StandaloneScreen.js";
import { useSignInReturn } from "./useSignInReturn.js";

/** Props for {@link SignInReturn}. */
export interface SignInReturnProps {
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The page at `STIGMER_OAUTH_REDIRECT_URI` for a sign-in at an address
 * (an MCP server's "Sign in", "Connect GitHub", `stigmer connect plugin`).
 * Render it inside a `StigmerProvider` with no token: the call is public.
 * A Connect link's return renders `ConnectLinkCallback` instead, and the
 * Slack install's page `OAuthCallbackHandler`.
 *
 * Once Stigmer has the answer the page says where the person signed in and
 * to go back where they started, then closes itself, which a browser allows
 * for a window a script opened and ignores for a tab, so the sentence stays
 * wherever the window does.
 *
 * @example
 * ```tsx
 * // app/auth/oauth/callback/page.tsx (Next.js)
 * import { Stigmer } from "@stigmer/client";
 * import { SignInReturn, StigmerProvider } from "@stigmer/react-sdk";
 *
 * // No token: the hand-back is public.
 * const client = new Stigmer({ baseUrl: "https://api.example.com", getAccessToken: () => null });
 *
 * export default function OAuthCallbackPage() {
 *   return (
 *     <StigmerProvider client={client}>
 *       <SignInReturn />
 *     </StigmerProvider>
 *   );
 * }
 * ```
 */
export function SignInReturn({ className }: SignInReturnProps) {
  const back = useSignInReturn();

  useEffect(() => {
    if (back.kind === "handed-back") window.close();
  }, [back.kind]);

  switch (back.kind) {
    case "handing-back":
      return (
        <ScreenColumn className={className}>
          <ScreenWait>Handing the sign-in back…</ScreenWait>
        </ScreenColumn>
      );
    case "handed-back":
      return (
        <ScreenColumn
          className={className}
          headingLevel={1}
          title={`You're signed in at ${back.providerName}`}
          lead="Go back to where you started; it finishes there."
        />
      );
    case "refused":
      return (
        <ScreenColumn className={className}>
          <ErrorMessage
            error={new Error(`The login page did not sign you in: ${back.reason}`)}
            title="The sign-in didn't finish."
            comfort="Nothing was saved. Go back to where you started and try again."
          />
        </ScreenColumn>
      );
    case "failed":
      return (
        <ScreenColumn className={className}>
          <ErrorMessage
            error={back.error}
            title="The sign-in didn't finish."
            comfort="Nothing was saved. Go back to where you started and sign in again."
            retry={isTransientStreamError(back.error) ? () => window.location.reload() : undefined}
          />
        </ScreenColumn>
      );
    case "no-answer":
      return (
        <ScreenColumn className={className}>
          <ErrorMessage
            error={new Error("this page was opened without a sign-in's answer; it only finishes a sign-in that sent you here")}
            title="The sign-in didn't finish."
            comfort="Nothing was saved. Go back to where you started and sign in again."
          />
        </ScreenColumn>
      );
    default: {
      const unknown: never = back;
      throw new Error(`unknown sign-in return: ${JSON.stringify(unknown)}`);
    }
  }
}
