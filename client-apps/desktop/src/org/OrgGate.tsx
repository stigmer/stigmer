import { useCallback, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useOrgGate } from "@stigmer/react-sdk";
import { OrgGateView } from "@stigmer/react-sdk/console";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { useAuth } from "../auth/AuthProvider";
import { GateHeader, GateMark } from "../shell/GateHeader";

/** Routes that bypass the org gate (user may not have an org yet). */
const ORG_GATE_BYPASS_PREFIXES = ["/invite/"] as const;

/**
 * Blocks the app until the user has at least one organization.
 *
 * Delegates the gate derivation to `useOrgGate()` from the SDK and draws
 * its states with the kit's `OrgGateView`, as the web console's gate does.
 */
export function OrgGate({ children }: { children: ReactNode }) {
  const location = useLocation();

  const isBypassed = ORG_GATE_BYPASS_PREFIXES.some((p) =>
    location.pathname.startsWith(p),
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
      signIn={() => void login().catch(() => {})}
      onCreated={handleCreated}
      mark={<GateMark />}
      corner={<GateHeader />}
    >
      {children}
    </OrgGateView>
  );
}
