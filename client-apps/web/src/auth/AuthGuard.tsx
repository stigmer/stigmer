"use client";

import { useEffect } from "react";
import { StandaloneScreen } from "@stigmer/react-sdk/console";
import { StigmerLogo } from "./StigmerLogo";
import { useAuth } from "./use-auth";

/**
 * Blocks rendering until auth state is resolved.
 *
 * - While `isLoading`, says it is opening Stigmer, on the kit's standalone frame.
 * - When `!isAuthenticated`, triggers `login()` and says it is taking the
 *   person to sign in (the OIDC provider will redirect to the identity provider).
 * - When authenticated, renders children.
 *
 * In disabled mode this is effectively a passthrough: `isLoading` is
 * always `false` and `isAuthenticated` is always `true`, so children
 * render immediately with zero overhead.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, login } = useAuth();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      login();
    }
  }, [isLoading, isAuthenticated, login]);

  if (isLoading || !isAuthenticated) {
    // Two waits look alike but are not: resolving the stored session, and
    // the hand-off to the identity provider. Naming the second keeps the
    // person oriented while the browser leaves (visibility of status).
    const redirecting = !isLoading && !isAuthenticated;
    return (
      <StandaloneScreen
        mark={<StigmerLogo size={40} />}
        wait={redirecting ? "Taking you to sign in\u2026" : "Opening Stigmer\u2026"}
      />
    );
  }

  return <>{children}</>;
}
