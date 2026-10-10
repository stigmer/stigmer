"use client";

/**
 * Settings section for an organization's service accounts: the accounts its
 * automation (a CI job, a script, an integration) acts as through API keys,
 * so the automation keeps working when the person who set it up leaves.
 *
 * Shown in full to a caller who holds `can_create_identity_account` on the
 * organization, which the model gives its admins: they list, create, open and
 * delete service accounts. Anyone else is told the admins manage them, and
 * the list, which the server would refuse them, is never asked for. The
 * settings navigation offers the page to the same callers
 * (`useSettingsNavGroups`).
 *
 * A server that trusts every request runs no API-key check, so a service
 * account could never act there: the section says so and offers no create,
 * and the server refuses a create the same way. A server too old to say
 * either way is offered the button and answers for itself; until the server
 * has answered, no button is offered.
 */
import { useCallback, useId, useRef, useState } from "react";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";
import { CloudFeatureNotice } from "../internal/CloudFeatureNotice.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { useServerInfo } from "../server-info.js";
import { SERVICE_ACCOUNTS_MANAGED_BY_ADMINS } from "../service-account/copy.js";
import { CreateServiceAccountForm } from "../service-account/CreateServiceAccountForm.js";
import { ServiceAccountDetailPanel } from "../service-account/ServiceAccountDetailPanel.js";
import { ServiceAccountListPanel } from "../service-account/ServiceAccountListPanel.js";

type FlowState =
  | { readonly phase: "idle" }
  | { readonly phase: "creating" }
  | { readonly phase: "viewing"; readonly serviceAccount: IdentityAccount };

/** Settings section for creating and managing service accounts. */
export function ServiceAccountsSection() {
  const headingId = useId();
  const org = useActiveOrgId();
  const { serverInfo } = useServerInfo();
  const trustsEveryRequest = serverInfo?.authenticationRequired === false;
  // A key needs a server that checks keys; until the server answers, no
  // create is offered, so no button flashes and disappears.
  const keysAuthenticate = serverInfo !== null && !trustsEveryRequest;
  const manageCheck = useCheckPermission(
    org ? { kind: "organization", id: org } : null,
    "can_create_identity_account",
  );
  const canManage = !manageCheck.isLoading && manageCheck.allowed;
  const deniedManage = !manageCheck.isLoading && !manageCheck.allowed;

  const [flow, setFlow] = useState<FlowState>({ phase: "idle" });
  const listRefetchRef = useRef<(() => void) | null>(null);

  const handleRefetchRef = useCallback((refetch: () => void) => {
    listRefetchRef.current = refetch;
  }, []);

  const refetchList = useCallback(() => {
    listRefetchRef.current?.();
  }, []);

  const backToList = useCallback(() => {
    listRefetchRef.current?.();
    setFlow({ phase: "idle" });
  }, []);

  return (
    <section aria-labelledby={headingId}>
      <div className="stg:mb-3 stg:flex stg:items-center stg:justify-between">
        <h2
          id={headingId}
          className="stg:text-foreground stg:text-sm stg:font-semibold"
        >
          Service accounts
        </h2>

        {org && canManage && keysAuthenticate && flow.phase === "idle" && (
          <button
            type="button"
            onClick={() => setFlow({ phase: "creating" })}
            className="stg:text-primary stg:hover:text-foreground stg:text-xs stg:font-medium stg:transition-colors"
          >
            + New service account
          </button>
        )}
      </div>
      <p className="stg:text-muted-foreground stg:mb-4 stg:text-xs">
        A service account is your organization&apos;s own account for
        automation. A CI job or a script acts as it through its API keys, so it
        keeps working when the person who set it up leaves, and what it creates
        says the service account created it. It holds one organization role and
        is never an owner.
      </p>

      {trustsEveryRequest && (
        <CloudFeatureNotice className="stg:mb-4">
          This server trusts every request, so it checks no API keys and a
          service account could never act. Configure an identity provider
          (<code>STIGMER_OIDC_ISSUER</code>) to use service accounts.
        </CloudFeatureNotice>
      )}

      {!org ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to manage service accounts.
        </p>
      ) : deniedManage ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          {SERVICE_ACCOUNTS_MANAGED_BY_ADMINS}
        </p>
      ) : !canManage ? null : flow.phase === "creating" ? (
        <div className="stg:space-y-4">
          <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
            <CreateServiceAccountForm
              org={org}
              onCreated={refetchList}
              onDone={backToList}
              onCancel={() => setFlow({ phase: "idle" })}
            />
          </div>
          <ServiceAccountListPanel org={org} onRefetchRef={handleRefetchRef} />
        </div>
      ) : flow.phase === "viewing" ? (
        <div className="stg:border-border stg:bg-card stg:rounded-lg stg:border stg:p-4">
          <ServiceAccountDetailPanel
            key={flow.serviceAccount.metadata?.id ?? ""}
            serviceAccount={flow.serviceAccount}
            org={org}
            onUpdated={(serviceAccount) => setFlow({ phase: "viewing", serviceAccount })}
            onDeleted={backToList}
            onBack={backToList}
          />
        </div>
      ) : (
        <ServiceAccountListPanel
          org={org}
          onOpen={(serviceAccount) => setFlow({ phase: "viewing", serviceAccount })}
          onRefetchRef={handleRefetchRef}
        />
      )}
    </section>
  );
}
