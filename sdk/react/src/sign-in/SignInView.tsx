"use client";

// The console's sign-in screen, one look for the web console and the desktop
// app: the host's mark, where the person signs in, that Stigmer is in Beta,
// one act and the help line.
// The host keeps its sign-in wiring (the web console's issuer redirect, the
// desktop's system browser) and passes the state. A sign-in page on another
// site than the server's is named before the person goes on, and a sign-in
// that couldn't start or didn't finish says so in plain words, with the
// details one click away, never as the library's raw line alone.

import type { ReactNode } from "react";
import { ExternalLink, Lock, RotateCcw } from "lucide-react";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Notice } from "../internal/surface/Notice.js";
import { BETA_LINE, BETA_URL, BETA_WORD } from "../internal/beta.js";
import { ScreenWait, StandaloneScreen } from "../standalone-screen/StandaloneScreen.js";

/** Where a sign-in stands. */
export type SignInState =
  /** Ready: the person can sign in. */
  | { readonly status: "ready" }
  /** Handing off to the issuer's create-account screen (the website's Start free). */
  | { readonly status: "handing-off" }
  /** The sign-in page is open in the person's browser, and the app waits for it. */
  | { readonly status: "waiting" }
  /**
   * The sign-in couldn't start, or didn't finish. `headline` says which
   * ("Stigmer couldn't start the sign-in." when omitted).
   */
  | { readonly status: "failed"; readonly error: Error; readonly headline?: string };

/** The sign-in page's own site, when it is not the server's: named before the person goes on. */
export interface SignInElsewhere {
  /** The server's address, as the person chose it ("stigmer.acme.example"). */
  readonly server: string;
  /** The sign-in page's host ("login.othercorp.example"). */
  readonly provider: string;
}

/** Props for {@link SignInView}. */
export interface SignInViewProps {
  /** Where the sign-in stands. */
  readonly state: SignInState;
  /** What the person signs in to, after "Sign in to" ("Stigmer", or the server's own name). */
  readonly serverName: string;
  /** The line under the title. Defaults to where the sign-in continues. */
  readonly lead?: ReactNode;
  /**
   * Starts the sign-in (and starts it again after a failure). Omit it while
   * the host can't start one yet (it doesn't know where the server sends
   * people): the screen then offers no Sign in.
   */
  readonly onSignIn?: () => void;
  /** Set when the sign-in page is on another site: the screen names it and the button says where it goes. */
  readonly elsewhere?: SignInElsewhere;
  /** Reopens the sign-in page while the app waits for the browser. */
  readonly onReopen?: () => void;
  /** Stops waiting for the browser. */
  readonly onCancel?: () => void;
  /** Points the app at another server (the desktop app), offered as a quiet act. */
  readonly onUseAnotherServer?: () => void;
  /** The host's mark, on top. */
  readonly mark?: ReactNode;
}

const DEFAULT_LEAD = "You'll continue on your sign-in page, then come straight back here.";

/** Where the line's linked word sits ("Stigmer is in |Beta|: things may change…"). */
const BETA_AT = BETA_LINE.indexOf(BETA_WORD);

/**
 * Stigmer is in Beta, said once under the lead where a newcomer first meets
 * the console, its word linking the page that says what Beta means. The
 * line opens that page beside the console, as the help line does.
 */
function BetaLine() {
  return (
    <p className="stg:m-0 stg:text-center stg:text-xs stg:text-muted-foreground">
      {BETA_LINE.slice(0, BETA_AT)}
      <a
        href={BETA_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="stg:rounded-sm stg:text-foreground stg:underline stg:decoration-border stg:underline-offset-4 stg:hover:decoration-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
      >
        {BETA_WORD}
      </a>
      {BETA_LINE.slice(BETA_AT + BETA_WORD.length)}
    </p>
  );
}

/**
 * The sign-in screen: ready, the sign-in page on another site, handing off
 * to create an account, waiting for the browser, and failed. Ready and
 * failed say that Stigmer is in Beta under the lead, linking the page that
 * says what it means.
 *
 * @example
 * ```tsx
 * function SignIn({ start }: { start: () => void }) {
 *   return <SignInView state={{ status: "ready" }} serverName="Stigmer" onSignIn={start} />;
 * }
 * ```
 */
export function SignInView({
  state,
  serverName,
  lead = DEFAULT_LEAD,
  onSignIn,
  elsewhere,
  onReopen,
  onCancel,
  onUseAnotherServer,
  mark,
}: SignInViewProps) {
  const another =
    onUseAnotherServer !== undefined ? (
      <Button variant="ghost" onClick={onUseAnotherServer}>
        Use another server
      </Button>
    ) : null;

  if (state.status === "handing-off") {
    return <StandaloneScreen mark={mark} wait="Taking you to create your account…" />;
  }

  if (state.status === "waiting") {
    return (
      <StandaloneScreen
        mark={mark}
        title="Finish signing in in your browser"
        lead={`Your browser opened ${serverName}'s sign-in page. Come back here when it's done.`}
        acts={
          <>
            {onReopen !== undefined && (
              <Button variant="outline" icon={<ExternalLink className="stg:size-4" />} onClick={onReopen}>
                Reopen the browser
              </Button>
            )}
            {onCancel !== undefined && (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </>
        }
        help
      >
        <ScreenWait />
      </StandaloneScreen>
    );
  }

  const failed = state.status === "failed";
  return (
    <StandaloneScreen
      mark={mark}
      title={`Sign in to ${serverName}`}
      lead={lead}
      acts={
        <>
          {onSignIn === undefined ? null : failed ? (
            <Button icon={<RotateCcw className="stg:size-4" />} onClick={onSignIn}>
              Try again
            </Button>
          ) : (
            <Button onClick={onSignIn}>{elsewhere !== undefined ? `Sign in at ${elsewhere.provider}` : "Sign in"}</Button>
          )}
          {another}
        </>
      }
      help
    >
      <BetaLine />
      {elsewhere !== undefined && !failed && (
        <Notice tone="paused" role="note" icon={<Lock className="stg:size-4" />} headline={`${elsewhere.server} signs people in at ${elsewhere.provider}, on another site.`}>
          <p className="stg:m-0">
            Go on only if you trust {elsewhere.server} with your {elsewhere.provider} account.
          </p>
        </Notice>
      )}
      {failed && (
        <ErrorMessage
          error={state.error}
          title={state.headline ?? "Stigmer couldn't start the sign-in."}
          comfort="Nothing changed in your account."
        />
      )}
    </StandaloneScreen>
  );
}
