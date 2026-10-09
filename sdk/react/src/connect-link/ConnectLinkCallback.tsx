"use client";

import { useEffect, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { cn } from "@stigmer/theme";
import { getUserMessage, isNotFound } from "@stigmer/sdk";
import { CompleteConnectLinkInputSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/connect_link_pb";
import { useStigmer } from "../hooks.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { toError } from "../internal/toError.js";
import { DEAD_CONNECT_LINK_MESSAGE, clearPendingConnectLinkToken } from "./useConnectLink.js";

/** Props for {@link ConnectLinkCallback}. */
export interface ConnectLinkCallbackProps {
  /** The secret of the link this tab started (`pendingConnectLinkToken()`). */
  readonly token: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Finishes a Connect link's sign-in on the console's callback page: hands
 * the login page's code and state (or its error) to the server, forgets the
 * link, and sends the browser on to the URL the server answers, the
 * integrator's return URL with `stigmer_connect=connected` or
 * `stigmer_connect=error`.
 *
 * Render it in place of `OAuthCallbackHandler` when the page has no opener
 * and this tab started a link (`pendingConnectLinkToken()`), inside a
 * `StigmerProvider` with no token: the call is public. A link that no
 * longer works says so; nothing trusted says where to send the person back.
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
          window.location.replace(answer.returnUrl);
        })
        .catch((err: unknown) => {
          clearPendingConnectLinkToken();
          setFailure(toError(err));
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
