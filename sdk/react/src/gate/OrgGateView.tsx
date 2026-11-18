"use client";

// What a console shows while it learns which organizations the person is
// in: loading, the reason the list couldn't load, or, when they're in none,
// the form to make their first. `useOrgGate` makes the state; this view
// draws it, so the web console and the desktop app show one screen. The host
// passes the account's corner (who is signed in, and Sign out).

import type { ReactNode } from "react";
import { Building2, Loader2 } from "lucide-react";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { GateCorner, GateFailure } from "./IdentityAccountGateView.js";
import { CreateOrganizationForm } from "../organization/CreateOrganizationForm.js";
import type { OrgGateState } from "../organization/useOrgGate.js";

/** Props for {@link OrgGateView}. */
export interface OrgGateViewProps {
  /** The gate's state, from `useOrgGate`. */
  readonly state: OrgGateState;
  /** Tries again after a failure, from `useOrgGate`. */
  readonly retry: () => void;
  /** Called with the organization the person just made (the host refreshes the list onto it). */
  readonly onCreated: (org: Organization) => void;
  /** The top-right corner while the person is stuck or makes their first organization: who is signed in, and Sign out. */
  readonly corner?: ReactNode;
  /** The app, drawn once an organization is ready or the route bypasses the gate. */
  readonly children?: ReactNode;
}

/**
 * Draws the organization gate's states, and the app once it's ready.
 *
 * @example
 * ```tsx
 * const { state, retry, refresh } = useOrgGate({ isBypassed: false });
 * <OrgGateView state={state} retry={retry} onCreated={(org) => refresh(org.metadata?.id)} corner={<AccountCorner />}>
 *   <App />
 * </OrgGateView>
 * ```
 */
export function OrgGateView({ state, retry, onCreated, corner, children }: OrgGateViewProps) {
  switch (state.status) {
    case "bypassed":
    case "ready":
      return <>{children}</>;
    case "loading":
      return (
        <div className="stg:flex stg:min-h-screen stg:flex-col stg:items-center stg:justify-center stg:gap-3">
          <Loader2 className="stg:size-8 stg:animate-spin stg:text-muted-foreground" />
        </div>
      );
    case "error":
      return <GateFailure corner={corner} headline="Failed to load organizations" message={state.message} retry={retry} />;
    case "no-orgs":
      return (
        <div className="stg:relative stg:flex stg:min-h-screen stg:flex-col stg:items-center stg:justify-center stg:p-8">
          <GateCorner>{corner}</GateCorner>
          <div className="stg:w-full stg:max-w-sm stg:space-y-6">
            <div className="stg:flex stg:flex-col stg:items-center stg:gap-3 stg:text-center">
              <div className="stg:flex stg:size-12 stg:items-center stg:justify-center stg:rounded-full stg:bg-muted">
                <Building2 className="stg:size-6 stg:text-muted-foreground" />
              </div>
              <h1 className="stg:m-0 stg:text-lg stg:font-semibold stg:text-foreground">Welcome to Stigmer</h1>
              <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
                Create an organization to get started. Organizations are the top-level context that owns your
                agents, vaults, and resources. To join an existing one instead, ask one of its admins to invite you.
              </p>
              <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">
                Next, you connect a model provider, such as Anthropic or OpenAI, so your agents can answer.
              </p>
            </div>
            <CreateOrganizationForm onCreated={onCreated} />
          </div>
        </div>
      );
  }
}
