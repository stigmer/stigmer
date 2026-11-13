"use client";

import { cn } from "@stigmer/design-tokens";
import { getUserMessage } from "@stigmer/client";
import { DEAD_CONNECT_LINK_MESSAGE, useConnectLink } from "./useConnectLink.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Button } from "../button/Button.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

/** Props for {@link ConnectLinkView}. */
export interface ConnectLinkViewProps {
  /** The link's secret from its URL. */
  readonly token: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The page a Connect link opens: "Connect PROVIDER for ORGANIZATION" and
 * one Continue button, which sends the browser to the login page. The
 * person needs no Stigmer account; after the login page they land back on
 * the app that sent the link (the console's callback page finishes the
 * sign-in, {@link ConnectLinkCallback}).
 *
 * A link that no longer works says so, and what to do. Render it inside a
 * `StigmerProvider` with no token: every call it makes is public.
 */
export function ConnectLinkView({ token, className }: ConnectLinkViewProps) {
  const link = useConnectLink(token);

  return (
    <div className={cn("stg:mx-auto stg:max-w-sm stg:space-y-4 stg:p-8 stg:text-center", className)}>
      {link.isLoading ? (
        <LoadingRegion label="Loading">
          <SpinnerIcon className="stg:mx-auto stg:size-5 stg:text-muted-foreground" />
        </LoadingRegion>
      ) : link.isDead || link.info === null ? (
        <p role="alert" className="stg:text-sm stg:text-foreground">
          {link.error !== null ? getUserMessage(link.error) : DEAD_CONNECT_LINK_MESSAGE}
        </p>
      ) : (
        <>
          <div className="stg:space-y-1">
            <h1 className="stg:text-base stg:font-semibold stg:text-foreground">
              Connect {link.info.providerName}
              {link.info.organizationName !== "" && <> for {link.info.organizationName}</>}
            </h1>
            <p className="stg:text-xs stg:text-muted-foreground">
              You will sign in on {link.info.providerName}&apos;s own page. Your login is saved for{" "}
              {link.info.organizationName !== "" ? link.info.organizationName : "the app that sent this link"}, and you
              will be sent back to it.
            </p>
          </div>
          <Button
            onClick={() => void link.start()}
            disabled={link.isStarting}
            icon={link.isStarting ? <SpinnerIcon className="stg:size-3.5" /> : undefined}
            className="stg:w-full"
          >
            Continue
          </Button>
          {link.error !== null && (
            <p role="alert" className="stg:text-xs stg:text-destructive">
              {getUserMessage(link.error)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
