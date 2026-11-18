"use client";

import { useContext, useEffect } from "react";
import { PageFailure } from "@stigmer/react-sdk/console";
import { AuthContext } from "@/auth/context";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** The root error boundary: the kit's page for a page that broke, inside the console's frame. */
export default function RootError({ error, reset }: ErrorPageProps) {
  // Public routes (sign-in, an invitation) render without AuthProvider, so
  // Sign in again is offered only where there is a sign-in to start.
  const auth = useContext(AuthContext);
  useEffect(() => {
    console.error("[RootErrorBoundary]", error);
  }, [error]);

  return (
    <PageFailure error={error} onRetry={reset} signIn={auth?.login} />
  );
}
