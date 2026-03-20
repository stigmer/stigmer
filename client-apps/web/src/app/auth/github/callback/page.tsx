"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGitHubConnection } from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";

/**
 * OAuth callback page for GitHub.
 *
 * GitHub redirects here after the user authorizes. The page reads the
 * `code` and `state` query params, exchanges the code for a token via
 * the Stigmer backend, persists it in the personal environment, and
 * redirects to the home page on success.
 *
 * The effect waits for both org context and the personal environment
 * to be ready before calling `handleCallback`, which writes the token
 * directly to the server-side personal environment.
 */
export default function GitHubCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const org = useActiveOrgSlug();
  const { handleCallback, isLoading } = useGitHubConnection(org || null);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const missingParams = !code || !state;

  const [error, setError] = useState<string | null>(
    missingParams ? "Missing authorization code or state parameter" : null,
  );
  const [exchanged, setExchanged] = useState(false);

  useEffect(() => {
    if (missingParams || exchanged || !org || isLoading) return;
    setExchanged(true);

    const redirectUri = `${window.location.origin}/auth/github/callback`;

    handleCallback(code, state, redirectUri)
      .then(() => {
        router.replace("/");
      })
      .catch((err) => {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to connect GitHub account",
        );
      });
  }, [code, state, missingParams, exchanged, org, isLoading, handleCallback, router]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="max-w-md space-y-4 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => router.replace("/")}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center space-y-2">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          Connecting your GitHub account...
        </p>
      </div>
    </div>
  );
}
