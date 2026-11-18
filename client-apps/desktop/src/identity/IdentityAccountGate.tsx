// The desktop's first-sign-in gate: the person's identity account exists
// before the app asks the server for anything that belongs to them. On a
// first sign-in the server does not know the person yet, so the gate
// provisions their account (and, on Stigmer Cloud, their personal
// organization with it), the same step the web console and
// `stigmer auth login` run.

import type { ReactNode } from "react";
import { useIdentityAccountGate } from "@stigmer/react-sdk";
import { IdentityAccountGateView } from "@stigmer/react-sdk/console";
import { useAuth } from "../auth/AuthProvider";
import { GateHeader } from "../shell/GateHeader";

/**
 * Blocks the app until the caller's identity account is resolved, or
 * provisioned on a first sign-in.
 *
 * Delegates the whoAmI / provisionMyAccount state machine to
 * `useIdentityAccountGate()` from the SDK and draws its states with the
 * kit's `IdentityAccountGateView`, as the web console's gate does. With auth
 * disabled (a local server) the hook reports ready at once.
 *
 * It sits above `OrgProvider` in the provider chain, so the personal
 * organization exists before `listMine()` is called.
 */
export function IdentityAccountGate({ children }: { children: ReactNode }) {
  const { isAuthEnabled, user } = useAuth();
  const { state, retry } = useIdentityAccountGate({ isEnabled: isAuthEnabled });

  return (
    <IdentityAccountGateView
      state={state}
      retry={retry}
      displayName={user?.name ?? user?.email}
      corner={<GateHeader />}
    >
      {children}
    </IdentityAccountGateView>
  );
}
