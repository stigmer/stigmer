// The run zone's answer when reading a run failed for a reason other than
// its absence (the network, the server): the failure says why and offers a
// retry, so a transient error never reads as a missing run. Same shape as
// the app's error page.
"use client";

import Link from "next/link";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { getUserMessage } from "@stigmer/sdk";
import { Button } from "@/domain/_shared/ui/button";

export function RunLoadFailed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="bg-destructive-subtle mx-auto flex size-12 items-center justify-center rounded-full">
          <AlertTriangle className="text-destructive size-6" />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Failed to load run</h1>
          <p className="text-muted-foreground text-sm">{getUserMessage(error)}</p>
        </div>

        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" onClick={onRetry}>
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
