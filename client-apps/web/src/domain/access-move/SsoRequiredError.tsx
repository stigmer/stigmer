"use client";

/**
 * The console's answer to an organization's sign-in requirement
 * (SSO_REQUIRED), where an error boundary would otherwise say "Access
 * denied": the organization's own sentence, a button to sign in through its
 * SSO provider (landing back where the person was), and the way to bring
 * their access with them.
 */
import { SsoRequiredNotice } from "@stigmer/react";
import { startSsoLogin } from "@/auth/oidc/start-sso-login";

export function SsoRequiredError({ error }: { readonly error: unknown }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center px-4">
      <SsoRequiredNotice
        className="w-full max-w-md"
        error={error}
        onSignIn={(provider, org) =>
          void startSsoLogin(
            provider,
            org,
            `${window.location.pathname}${window.location.search}`,
          )
        }
        moveHref={(org) => `/sso/move?org=${encodeURIComponent(org)}`}
      />
    </div>
  );
}
