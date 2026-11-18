"use client";

// What a console shows between signing in and the app: the person's
// identity account being checked, set up on a first sign-in, or the reason
// it couldn't be. `useIdentityAccountGate` makes the state; this view draws
// it on the console's standalone frame, so the web console and the desktop
// app show one screen. A failure is the kit's failure note, said from the
// error's kind (signed out, the server didn't answer), never its raw line
// alone. The host keeps its sign-in wiring and passes its mark and the
// account's corner (who is signed in, and Sign out), so a person stuck here
// can always leave.

import type { ReactNode } from "react";
import { classifyError } from "@stigmer/client";
import { ErrorMessage } from "../error/ErrorMessage.js";
import type { IdentityAccountGateState } from "../identity-account/useIdentityAccountGate.js";
import { ScreenWait, StandaloneScreen } from "../standalone-screen/StandaloneScreen.js";

/** Props for {@link IdentityAccountGateView}. */
export interface IdentityAccountGateViewProps {
  /** The gate's state, from `useIdentityAccountGate`. */
  readonly state: IdentityAccountGateState;
  /** Tries again after a failure, from `useIdentityAccountGate`. */
  readonly retry: () => void;
  /** Signs the person in again, offered when the failure is that they're signed out. */
  readonly signIn?: () => void;
  /** The signed-in person's name (or email), for the welcome while their account is set up. */
  readonly displayName?: string;
  /** The host's mark, on top of every screen the gate draws. */
  readonly mark?: ReactNode;
  /** The top-right corner while the person waits or is stuck: who is signed in, and Sign out (the console's `UserMenu`). */
  readonly corner?: ReactNode;
  /** The app, drawn once the account is ready. */
  readonly children?: ReactNode;
}

/**
 * Draws the identity account gate's states, and the app once it's ready.
 *
 * @example
 * ```tsx
 * // `state` and `retry` come from the kit's `useIdentityAccountGate`; the host passes the signed-in name.
 * function AccountGate({ state, retry, children }: Pick<IdentityAccountGateViewProps, "state" | "retry" | "children">) {
 *   return (
 *     <IdentityAccountGateView state={state} retry={retry} displayName="Ada Lovelace">
 *       {children}
 *     </IdentityAccountGateView>
 *   );
 * }
 * ```
 */
export function IdentityAccountGateView({ state, retry, signIn, displayName, mark, corner, children }: IdentityAccountGateViewProps) {
  switch (state.status) {
    case "ready":
      return <>{children}</>;
    case "checking":
      return <StandaloneScreen mark={mark} corner={corner} wait="Checking your account…" />;
    case "provisioning":
      return (
        <StandaloneScreen
          mark={mark}
          corner={corner}
          title={displayName ? `Welcome, ${displayName}` : "Welcome"}
          lead="Setting up your account…"
        >
          <ScreenWait />
        </StandaloneScreen>
      );
    case "error":
      return (
        <GateFailure
          mark={mark}
          corner={corner}
          error={state.error}
          headline="Stigmer couldn't set up your account."
          retry={retry}
          signIn={signIn}
        />
      );
  }
}

/**
 * A gate's failure: the failure note alone under the mark. A signed-out
 * failure keeps the kit's own headline and offers Sign in again; any other
 * says what the gate couldn't do and that nothing was lost.
 *
 * @internal Not part of the public API.
 */
export function GateFailure({
  mark,
  corner,
  error,
  headline,
  retry,
  signIn,
}: {
  readonly mark?: ReactNode;
  readonly corner?: ReactNode;
  readonly error: Error;
  readonly headline: string;
  readonly retry: () => void;
  readonly signIn?: () => void;
}) {
  const signedOut = classifyError(error) === "auth";
  return (
    <StandaloneScreen mark={mark} corner={corner}>
      <ErrorMessage
        error={error}
        title={signedOut ? undefined : headline}
        comfort={signedOut ? "Sign in again to carry on where you were." : "You're signed in, and nothing was lost."}
        retry={retry}
        signIn={signIn}
      />
    </StandaloneScreen>
  );
}
