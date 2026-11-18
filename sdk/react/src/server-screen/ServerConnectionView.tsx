"use client";

// The desktop app's first screen: connecting to the server the person chose,
// and, when that server can't be used, why in one sentence, with another
// server one click away. Nothing answered and something that isn't a Stigmer
// server answered are failures (the kit's failure note, with Try again where
// trying can help); a server that signs people in without a client for the
// app is set-up, not a failure, so it is a plain note with its operator's
// guide. The host keeps its connection and passes the outcome.

import type { ReactNode } from "react";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Notice } from "../internal/surface/Notice.js";
import { StandaloneScreen } from "../standalone-screen/StandaloneScreen.js";

/** Where a connection to a server stands. */
export type ServerConnectionState =
  /** The app is asking the server who it is. */
  | { readonly status: "connecting" }
  /** Nothing answered at the server's address. */
  | { readonly status: "unreachable" }
  /** Something answered, but not as a Stigmer server does. */
  | { readonly status: "not-stigmer" }
  /** The server signs people in but has no sign-in client for this app. */
  | { readonly status: "not-set-up"; readonly serverName: string };

/** Props for {@link ServerConnectionView}. */
export interface ServerConnectionViewProps {
  /** Where the connection stands. */
  readonly state: ServerConnectionState;
  /** The server's address, as the person chose it ("stigmer.acme.example"). */
  readonly host: string;
  /** Tries the same server again. */
  readonly onRetry: () => void;
  /** Lets the person choose another server. */
  readonly onChooseAnother: () => void;
  /** Opens the guide an operator follows to set the app up, for a server that isn't yet. */
  readonly onOpenGuide?: () => void;
  /** The app's name, as the person knows it. */
  readonly appName?: string;
  /** The host's mark, on top. */
  readonly mark?: ReactNode;
}

/**
 * Connecting to a server, and the three ways one can't be used.
 *
 * @example
 * ```tsx
 * function Connecting({ retry, choose }: { retry: () => void; choose: () => void }) {
 *   return <ServerConnectionView state={{ status: "connecting" }} host="stigmer.acme.example" onRetry={retry} onChooseAnother={choose} />;
 * }
 * ```
 */
export function ServerConnectionView({
  state,
  host,
  onRetry,
  onChooseAnother,
  onOpenGuide,
  appName = "Stigmer Desktop",
  mark,
}: ServerConnectionViewProps) {
  if (state.status === "connecting") {
    return <StandaloneScreen mark={mark} wait={`Connecting to ${host}…`} />;
  }
  const another = (
    <Button variant="ghost" onClick={onChooseAnother}>
      Use another server
    </Button>
  );
  if (state.status === "not-set-up") {
    return (
      <StandaloneScreen mark={mark} acts={another} help>
        <Notice
          tone="plain"
          headline={`${state.serverName} isn't set up for ${appName} yet.`}
          link={onOpenGuide !== undefined ? { label: "How an operator sets it up", external: true, onClick: onOpenGuide } : undefined}
        >
          <p className="stg:m-0">
            Its operator hasn&apos;t registered the desktop app as a sign-in client. Ask them to set one up.
          </p>
        </Notice>
      </StandaloneScreen>
    );
  }
  const unreachable = state.status === "unreachable";
  return (
    <StandaloneScreen mark={mark} acts={another}>
      <ErrorMessage
        error={new Error(unreachable ? "nothing answered at that address" : "it answered, but not as a Stigmer server does")}
        title={unreachable ? `${appName} can't reach ${host}.` : `${host} doesn't look like a Stigmer server.`}
        comfort={unreachable ? "Check the address and your network, then try again." : "Check the address, or choose another server."}
        retry={unreachable ? onRetry : undefined}
      />
    </StandaloneScreen>
  );
}
