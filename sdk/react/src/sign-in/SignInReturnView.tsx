"use client";

// The moment a person comes back from the sign-in page: the wait while the
// console finishes the sign-in, or, when it couldn't, the failure note with
// Sign in again. Without it, a sign-in that failed on the way back showed the
// library's raw line ("No matching state found in storage") under a red
// "Login Failed".

import type { ReactNode } from "react";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { StandaloneScreen } from "../standalone-screen/StandaloneScreen.js";

/** Props for {@link SignInReturnView}. */
export interface SignInReturnViewProps {
  /** Why the sign-in didn't finish, or `null` while it is finishing. */
  readonly error: Error | null;
  /** Starts the sign-in again. */
  readonly onSignInAgain: () => void;
  /** The host's mark, on top. */
  readonly mark?: ReactNode;
}

/**
 * The return from the sign-in page: "Finishing the sign-in…", or why it didn't finish.
 *
 * @example
 * ```tsx
 * function Return({ error, again }: { error: Error | null; again: () => void }) {
 *   return <SignInReturnView error={error} onSignInAgain={again} />;
 * }
 * ```
 */
export function SignInReturnView({ error, onSignInAgain, mark }: SignInReturnViewProps) {
  if (error === null) return <StandaloneScreen mark={mark} wait="Finishing the sign-in…" />;
  return (
    <StandaloneScreen mark={mark} acts={<Button onClick={onSignInAgain}>Sign in again</Button>}>
      <ErrorMessage error={error} title="The sign-in didn't finish." comfort="Nothing changed in your account." />
    </StandaloneScreen>
  );
}
