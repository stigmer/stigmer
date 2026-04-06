"use client";

import { useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { InvitationRedemption } from "@stigmer/react";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { useAuth } from "@/auth";

/**
 * Public invite redemption page.
 *
 * Renders the SDK's {@link InvitationRedemption} component with Console
 * auth wiring. After accepting, redirects to the joined organization.
 *
 * The page is rendered without the app shell sidebar (handled by
 * `AppShell`'s public-zone detection) and bypasses the org gate
 * (handled by `OrgGate`'s bypass list) so that first-time users
 * arriving via an invite link can accept without having an existing org.
 */
export default function InvitePageClient() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { isAuthenticated, login } = useAuth();

  const handleAccepted = useCallback(
    (invitation: Invitation) => {
      const orgSlug = invitation.metadata?.org;
      router.push(orgSlug ? `/${orgSlug}` : "/");
    },
    [router],
  );

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <InvitationRedemption
        token={params.token}
        isAuthenticated={isAuthenticated}
        onAccepted={handleAccepted}
        onAuthRequired={login}
      />
    </div>
  );
}
