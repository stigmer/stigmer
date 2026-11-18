"use client";

import { useEffect } from "react";
import { PageFailure } from "@stigmer/react-sdk/console";
import { renderJourneyLink } from "@/domain/journey/journey-links";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** The root error boundary: the kit's page for a page that broke, with the way home. */
export default function RootError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[RootErrorBoundary]", error);
  }, [error]);

  return (
    <PageFailure
      error={error}
      onRetry={reset}
      link={{ label: "Go to Dashboard", href: "/" }}
      renderLink={renderJourneyLink}
    />
  );
}
