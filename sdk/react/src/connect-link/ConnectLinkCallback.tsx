"use client";

import { useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { getUserMessage, isNotFound } from "@stigmer/sdk";
import { CompleteConnectLinkInputSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/connect_link_pb";
import { useStigmer } from "../hooks.js";
import { isBrowserDestination } from "../internal/loginPageUrl.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { toError } from "../internal/toError.js";
import { DEAD_CONNECT_LINK_MESSAGE, clearPendingConnectLinkToken } from "./useConnectLink.js";

/** What the customer reads when the app's return address fails the browser check. */
const UNSAFE_RETURN_MESSAGE =
  "The sign-in is over, but the app's return address is not an https address, so you were not sent back. Return to the app yourself.";

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
 * forgotten once the server has answered for it (the return URL, or a link
 * it no longer knows); a failure on the way (the network, an unavailable
 * server) keeps it, so a reload of the page tries again.
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
            setFailure(new Error(UNSAFE_RETURN_MESSAGE));
          }
        })
        .catch((err: unknown) => {
          const failed = toError(err);
          if (isNotFound(failed)) clearPendingConnectLinkToken();
          setFailure(failed);
        });
    }
  }, [stigmer, token]);

  return (
    <div className={cn("stg:flex stg:min-h-[200px] stg:items-center stg:justify-center stg:p-8", className)}>
      <div className="stg:max-w-sm stg:text-center">
        {failure === null ? (
          <>
            <SpinnerIcon className="stg:mx-auto stg:size-5 stg:text-muted-foreground" />
            <p className="stg:mt-3 stg:text-sm stg:text-muted-foreground">Finishing the connection...</p>
          </>
        ) : (
          <p role="alert" className="stg:text-sm stg:text-foreground">
            {isNotFound(failure) ? DEAD_CONNECT_LINK_MESSAGE : getUserMessage(failure)}
          </p>
        )}
      </div>
    </div>
  );
}
