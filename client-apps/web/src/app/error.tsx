"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RootError({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[RootErrorBoundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="bg-destructive/10 mx-auto flex size-12 items-center justify-center rounded-full">
          <AlertTriangle className="text-destructive size-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground text-sm">
            An unexpected error occurred. You can try again or return to the
            dashboard.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="mr-1.5 size-3.5" />
            Try again
          </Button>
          <Link
            href="/"
            className="hover:bg-muted hover:text-foreground inline-flex h-8 items-center justify-center rounded-lg px-2.5 text-sm font-medium transition-colors"
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
