"use client";

import { DEAD_LINK_LEAD, DEAD_LINK_TITLE, useConnectLink } from "./useConnectLink.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { ScreenColumn } from "../internal/ScreenColumn.js";
import { ScreenWait } from "../standalone-screen/StandaloneScreen.js";

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

  if (link.isLoading) {
    return (
      <ScreenColumn className={className}>
        <ScreenWait>Opening the link…</ScreenWait>
      </ScreenColumn>
    );
  }
  if (link.isDead || link.info === null) {
    if (link.error !== null && !link.isDead) {
      return (
        <ScreenColumn className={className}>
          <ErrorMessage error={link.error} title="Stigmer couldn't open the link." comfort="The link itself is unaffected." />
        </ScreenColumn>
      );
    }
    return <ScreenColumn className={className} headingLevel={1} title={DEAD_LINK_TITLE} lead={DEAD_LINK_LEAD} />;
  }
  const { providerName, organizationName } = link.info;
  const forWhom = organizationName !== "" ? organizationName : "the app that sent this link";
  return (
    <ScreenColumn
      className={className}
      headingLevel={1}
      title={organizationName !== "" ? `Connect ${providerName} for ${organizationName}` : `Connect ${providerName}`}
      lead={`You'll sign in on ${providerName}'s own page. Your login is saved for ${forWhom}, and you come back here.`}
      acts={
        <Button
          onClick={() => void link.start()}
          disabled={link.isStarting}
          aria-busy={link.isStarting}
          icon={link.isStarting ? <SpinnerIcon className="stg:size-3.5" /> : undefined}
        >
          Continue to {providerName}
        </Button>
      }
    >
      {link.error !== null && (
        <ErrorMessage
          error={link.error}
          title={`Stigmer couldn't open ${providerName}'s sign-in.`}
          comfort="Nothing was saved yet."
        />
      )}
    </ScreenColumn>
  );
}
