"use client";

import { useEffect } from "react";
import { PageFailure } from "@stigmer/react-sdk/console";
import { renderJourneyLink } from "@/domain/journey/journey-links";

interface SettingsErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Settings-scoped error boundary.
 *
 * Renders **inside** the settings layout, preserving the ManagementSidebar
 * and "Settings" page header. This prevents deep-linked users from losing
 * navigation context when a section component throws.
 */
export default function SettingsError({ error, reset }: SettingsErrorProps) {
  useEffect(() => {
    console.error("[SettingsErrorBoundary]", error);
  }, [error]);

  return (
    <PageFailure
      error={error}
      onRetry={reset}
      placement="section"
      comfort="Your settings are as you left them; only this page didn't load."
      link={{ label: "Back to Settings", href: "/settings" }}
      renderLink={renderJourneyLink}
    />
  );
}
