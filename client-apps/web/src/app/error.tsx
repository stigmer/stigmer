"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw, ShieldX } from "lucide-react";
import {
  classifyError,
  getUserMessage,
  type ErrorCategory,
} from "@stigmer/client";
import { Button, LinkButton } from "@stigmer/react-sdk";
import { HelpLink } from "@stigmer/react-sdk/console";
import { renderJourneyLink } from "@/domain/journey/journey-links";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const CATEGORY_TITLES: Partial<Record<ErrorCategory, string>> = {
  auth: "Authentication required",
  permission: "Access denied",
  "not-found": "Page not found",
  server: "Server error",
  unavailable: "Service unavailable",
};

export default function RootError({ error, reset }: ErrorPageProps) {
  const category = classifyError(error);
  const message = getUserMessage(error);
  const title = CATEGORY_TITLES[category] ?? "Something went wrong";
  const Icon =
    category === "auth" || category === "permission" ? ShieldX : AlertTriangle;

  useEffect(() => {
    console.error("[RootErrorBoundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="bg-destructive-subtle mx-auto flex size-12 items-center justify-center rounded-full">
          <Icon className="text-destructive size-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-muted-foreground text-sm">{message}</p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={reset} icon={<RotateCcw className="size-3.5" />}>
            Try again
          </Button>
          <LinkButton href="/" variant="ghost" renderLink={renderJourneyLink}>
            Go to Dashboard
          </LinkButton>
        </div>

        {/* Where to ask: the server's help link, or nothing (and nothing before the client exists). */}
        <HelpLink />

        {error.digest && (
          <p className="text-muted-foreground-subtle font-mono text-xs">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
