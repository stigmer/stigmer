"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw, ShieldX } from "lucide-react";
import {
  classifyError,
  getUserMessage,
  type ErrorCategory,
} from "@stigmer/client";
import { Button, LinkButton } from "@stigmer/react-sdk";
import { renderJourneyLink } from "@/domain/journey/journey-links";

interface SettingsErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const CATEGORY_TITLES: Partial<Record<ErrorCategory, string>> = {
  auth: "Authentication required",
  permission: "Access denied",
  "not-found": "Section not found",
  server: "Server error",
  unavailable: "Service unavailable",
};

/**
 * Settings-scoped error boundary.
 *
 * Renders **inside** the settings layout, preserving the ManagementSidebar
 * and "Settings" page header. This prevents deep-linked users from losing
 * navigation context when a section component throws.
 */
export default function SettingsError({ error, reset }: SettingsErrorProps) {
  const category = classifyError(error);
  const message = getUserMessage(error);
  const title = CATEGORY_TITLES[category] ?? "Something went wrong";
  const Icon =
    category === "auth" || category === "permission" ? ShieldX : AlertTriangle;

  useEffect(() => {
    console.error("[SettingsErrorBoundary]", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="bg-destructive-subtle mx-auto flex size-12 items-center justify-center rounded-full">
          <Icon className="text-destructive size-6" />
        </div>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">{message}</p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={reset} icon={<RotateCcw className="size-3.5" />}>
            Try again
          </Button>
          <LinkButton href="/settings/members" variant="ghost" renderLink={renderJourneyLink}>
            Go to Members
          </LinkButton>
        </div>

        {error.digest && (
          <p className="text-muted-foreground-subtle font-mono text-xs">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
