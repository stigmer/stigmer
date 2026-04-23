"use client";

import { Suspense } from "react";
import { GitHubCallbackPageView } from "@/auth/github/GitHubCallbackPageView";

export default function GitHubCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center">
          <div className="text-center space-y-2">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">Loading...</p>
          </div>
        </div>
      }
    >
      <GitHubCallbackPageView />
    </Suspense>
  );
}
