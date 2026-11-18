"use client";

import { useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { isNotFound, isTransientStreamError } from "@stigmer/client";
import { CompleteConnectLinkInputSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/connect_link_pb";
import { useStigmer } from "@stigmer/react-core";
import { isBrowserDestination } from "../internal/loginPageUrl.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { ScreenColumn } from "../internal/ScreenColumn.js";
import { ScreenWait } from "../standalone-screen/StandaloneScreen.js";
import { toError } from "@stigmer/react-core/internal";
import { DEAD_LINK_LEAD, DEAD_LINK_TITLE, clearPendingConnectLinkToken } from "./useConnectLink.js";


/** Props for {@link ConnectLinkCallback}. */
export interface ConnectLinkCallbackProps {
  /** The secret of the link this tab started, as `pendingConnectLinkToken(state)` answers for the return's state. */
  readonly token: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Finishes a Connect link's sign-in on the console's callback page: hands
 * the login page's code and state (or its error) to the server, and sends
 * the browser on to the URL the server answers, the integrator's return URL
 * with `stigmer_connect=connected` or `stigmer_connect=error`. The link is
 * forgotten once the server has answered for it (the return URL, or any
 * refusal); a failure on the way (the network, an unavailable server) keeps
 * it, so a reload of the page tries again. When the server
 * saved the login but its answer was lost, the reload finds the link spent
 * and says it was already used: the login is saved, and nothing trusted
 * says where to send the customer back.
 *
 * Render it in place of `OAuthCallbackHandler` when the return's `state` is
 * the one this tab's link started with (`pendingConnectLinkToken(state)`
 * answers its secret), inside a `StigmerProvider` with no token: the call is
 * public. A link that no longer works says so; nothing trusted says where to
 * send the person back.
 */
export function ConnectLinkCallback({ token, className }: ConnectLinkCallbackProps) {
  const stigmer = useStigmer();
  const [failure, setFailure] = useState<Error | null>(null);
  // The login is saved, but the app's return address failed the browser check.
  const [unsafeReturn, setUnsafeReturn] = useState(false);
  const didRun = useRef(false);

  useEffect(() => {
    // React may run the effect twice (StrictMode): the link completes once.
    if (!didRun.current) {
      didRun.current = true;
      const params = new URLSearchParams(window.location.search);
      stigmer.vault
        .completeConnectLink(
          create(CompleteConnectLinkInputSchema, {
            token,
            state: params.get("state") ?? "",
            code: params.get("code") ?? "",
            error: params.get("error") ?? "",
          }),
        )
        .then((answer) => {
          clearPendingConnectLinkToken();
          if (isBrowserDestination(answer.returnUrl)) {
            window.location.replace(answer.returnUrl);
          } else {
            setUnsafeReturn(true);
          }
        })
        .catch((err: unknown) => {
          const failed = toError(err);
          // A refusal is the server's last word on this return; only a
          // failure on the way (the network, an unavailable server) is
          // worth the reload that tries again.
          if (!isTransientStreamError(failed)) clearPendingConnectLinkToken();
          setFailure(failed);
        });
    }
  }, [stigmer, token]);

  if (unsafeReturn) {
    return (
      <ScreenColumn
        className={className}
        headingLevel={1}
        title="Your login is saved"
        lead="The app's return address isn't a secure one, so you weren't sent back. Go back to the app yourself."
      />
    );
  }
  if (failure === null) {
    return (
      <ScreenColumn className={className}>
        <ScreenWait>Finishing the connection…</ScreenWait>
      </ScreenColumn>
    );
  }
  if (isNotFound(failure)) {
    return <ScreenColumn className={className} headingLevel={1} title={DEAD_LINK_TITLE} lead={DEAD_LINK_LEAD} />;
  }
  return (
    <ScreenColumn className={className}>
      <ErrorMessage
        error={failure}
        title="The connection didn't finish."
        comfort="Your login wasn't saved. Try again, or start from the app's link."
        retry={isTransientStreamError(failure) ? () => window.location.reload() : undefined}
      />
    </ScreenColumn>
  );
}
