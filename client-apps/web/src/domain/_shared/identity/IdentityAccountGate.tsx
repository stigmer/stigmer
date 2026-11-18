"use client";

import { useIdentityAccountGate } from "@stigmer/react-sdk";
import { IdentityAccountGateView } from "@stigmer/react-sdk/console";
import { useAuth } from "@/auth";
import { getRuntimeConfig } from "@/config/runtime-config";
import { StigmerLogo } from "@/auth/StigmerLogo";
import { GateAccount } from "./GateAccount";

/**
 * Blocks the application shell until the caller's identity account is
 * resolved (or provisioned for first-time signups).
 *
 * Delegates the whoAmI / provisionMyAccount state machine to
 * `useIdentityAccountGate()` from the SDK and draws its states with the
 * kit's `IdentityAccountGateView`, passing the signed-in corner.
 *
 * Disabled-auth deployments bypass the gate entirely — the hook receives
 * `isEnabled: false` and immediately reports ready.
 *
 * This gate sits between StigmerTransportBridge and OrgProvider in the
 * provider chain so that the identity account (and, on Cloud, the
 * organization created at sign-up) exist
 * before `listMine()` is called.
 */
export function IdentityAccountGate({ children }: { children: React.ReactNode }) {
  const { user, login } = useAuth();
  const { state, retry } = useIdentityAccountGate({
    isEnabled: getRuntimeConfig().authMode === "oidc",
  });

  return (
    <IdentityAccountGateView
      state={state}
      retry={retry}
      signIn={login}
      displayName={user ? (user.name ?? user.email) : undefined}
      mark={<StigmerLogo size={40} />}
      corner={<GateAccount />}
    >
      {children}
    </IdentityAccountGateView>
  );
}
