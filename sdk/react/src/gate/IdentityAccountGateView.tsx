"use client";

// What a console shows between signing in and the app: the person's
// identity account being checked, set up on a first sign-in, or the reason
// it couldn't be. `useIdentityAccountGate` makes the state; this view draws
// it, so the web console and the desktop app show one screen. The host keeps
// its sign-in wiring and passes the account's corner (who is signed in, and
// Sign out), so a person stuck here can always leave.

import type { ReactNode } from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../button/Button.js";
import { HelpLink } from "../help/HelpLink.js";
import type { IdentityAccountGateState } from "../identity-account/useIdentityAccountGate.js";

/** Props for {@link IdentityAccountGateView}. */
export interface IdentityAccountGateViewProps {
  /** The gate's state, from `useIdentityAccountGate`. */
  readonly state: IdentityAccountGateState;
  /** Tries again after a failure, from `useIdentityAccountGate`. */
  readonly retry: () => void;
  /** The signed-in person's name (or email), for the welcome while their account is set up. */
  readonly displayName?: string;
  /** The top-right corner while the person waits or is stuck: who is signed in, and Sign out. */
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
export function IdentityAccountGateView({ state, retry, displayName, corner, children }: IdentityAccountGateViewProps) {
  switch (state.status) {
    case "ready":
      return <>{children}</>;
    case "checking":
      return (
        <div className="stg:flex stg:min-h-screen stg:flex-col stg:items-center stg:justify-center stg:gap-3">
          <Loader2 className="stg:size-8 stg:animate-spin stg:text-muted-foreground" />
        </div>
      );
    case "provisioning":
      return (
        <div className="stg:relative stg:flex stg:min-h-screen stg:flex-col stg:items-center stg:justify-center stg:p-8">
          <GateCorner>{corner}</GateCorner>
          <div className="stg:flex stg:flex-col stg:items-center stg:gap-4 stg:text-center">
            {displayName !== undefined && (
              <div className="stg:flex stg:size-12 stg:items-center stg:justify-center stg:rounded-full stg:bg-muted">
                <span className="stg:text-lg stg:font-medium stg:text-muted-foreground">
                  {displayName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div className="stg:space-y-1.5">
              <h1 className="stg:m-0 stg:text-lg stg:font-semibold stg:text-foreground">
                {displayName ? `Welcome, ${displayName}!` : "Welcome!"}
              </h1>
              <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">Setting up your account&hellip;</p>
            </div>
            <Loader2 className="stg:size-5 stg:animate-spin stg:text-muted-foreground" />
          </div>
        </div>
      );
    case "error":
      return (
        <GateFailure corner={corner} headline="Failed to set up your account" message={state.message} retry={retry} />
      );
  }
}

/**
 * The gate's top-right corner, holding what the host passes.
 *
 * @internal Not part of the public API.
 */
export function GateCorner({ children }: { readonly children?: ReactNode }) {
  return <div className="stg:absolute stg:top-0 stg:right-0 stg:p-4">{children}</div>;
}

/**
 * A gate's failure: the red line, the server's message, Try again and the help line.
 *
 * @internal Not part of the public API.
 */
export function GateFailure({
  corner,
  headline,
  message,
  retry,
}: {
  readonly corner?: ReactNode;
  readonly headline: string;
  readonly message: string;
  readonly retry: () => void;
}) {
  return (
    <div className="stg:relative stg:flex stg:min-h-screen stg:flex-col stg:items-center stg:justify-center stg:gap-4 stg:p-8">
      <GateCorner>{corner}</GateCorner>
      <AlertCircle className="stg:size-8 stg:text-destructive" />
      <p className="stg:m-0 stg:text-sm stg:font-medium stg:text-destructive">{headline}</p>
      <p className="stg:m-0 stg:max-w-md stg:text-center stg:text-sm stg:text-muted-foreground">{message}</p>
      <Button icon={<RefreshCw className="stg:size-3.5" />} onClick={retry}>
        Try again
      </Button>
      <HelpLink />
    </div>
  );
}
