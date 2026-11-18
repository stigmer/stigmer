"use client";

import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { useOrgGate } from "@stigmer/react-sdk";
import { OrgGateView } from "@stigmer/react-sdk/console";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { useAuth } from "@/auth";
import { StigmerLogo } from "@/auth/StigmerLogo";
import { GateAccount } from "../identity/GateAccount";

/** Routes that bypass the org gate (user may not have an org yet). */
const ORG_GATE_BYPASS_PREFIXES = ["/invite/"] as const;

/**
 * Blocks the application shell until the user has at least one organization.
 *
 * Delegates the gate derivation to `useOrgGate()` from the SDK and draws
 * its states with the kit's `OrgGateView`, passing the signed-in corner.
 * The list the gate reads is final by the time it renders (the identity gate ahead of
 * it has already provisioned whatever the server provisions), so an empty
 * list goes straight to onboarding — on Stigmer Cloud and on a self-hosted
 * server alike.
 *
 * Certain routes (e.g. `/invite/[token]`) bypass the gate because the
 * user may not have an org yet — they are joining one via an invitation.
 *
 * This is a Console-only concern — platform builders handle org provisioning
 * in their own onboarding flows.
 */
export function OrgGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isBypassed = ORG_GATE_BYPASS_PREFIXES.some((p) =>
    pathname.startsWith(p),
  );
  const { login } = useAuth();
  const { state, retry, refresh } = useOrgGate({ isBypassed });
  const handleCreated = useCallback(
    (org: Organization) => {
      refresh(org.metadata?.id);
    },
    [refresh],
  );

  return (
    <OrgGateView
      state={state}
      retry={retry}
      signIn={login}
      onCreated={handleCreated}
      mark={<StigmerLogo size={40} />}
      corner={<GateAccount />}
    >
      {children}
    </OrgGateView>
  );
}
