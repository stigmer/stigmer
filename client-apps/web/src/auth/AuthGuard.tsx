"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "./use-auth";

/**
 * Blocks rendering until auth state is resolved.
 *
 * - While `isLoading`, shows a centered spinner.
 * - When `!isAuthenticated`, triggers `login()` and shows a spinner
 *   (the OIDC provider will redirect to the identity provider).
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
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return <>{children}</>;
}
