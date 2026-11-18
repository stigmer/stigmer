"use client";

// What a console shows while it learns which organizations the person is
// in: loading, the reason the list couldn't load, or, when they're in none,
// the form to make their first, said from their side. `useOrgGate` makes
// the state; this view draws it on the console's standalone frame, so the
// web console and the desktop app show one screen. The host passes its mark
// and the account's corner (who is signed in, and Sign out).

import type { ReactNode } from "react";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { GateFailure } from "./IdentityAccountGateView.js";
import { CreateOrganizationForm } from "../organization/CreateOrganizationForm.js";
import type { OrgGateState } from "../organization/useOrgGate.js";
import { StandaloneScreen } from "../standalone-screen/StandaloneScreen.js";

/** Props for {@link OrgGateView}. */
export interface OrgGateViewProps {
  /** The gate's state, from `useOrgGate`. */
  readonly state: OrgGateState;
  /** Tries again after a failure, from `useOrgGate`. */
  readonly retry: () => void;
  /** Signs the person in again, offered when the failure is that they're signed out. */
  readonly signIn?: () => void;
  /** Called with the organization the person just made (the host refreshes the list onto it). */
  readonly onCreated: (org: Organization) => void;
  /** The host's mark, on top of every screen the gate draws. */
  readonly mark?: ReactNode;
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
 * // `state`, `retry` and `refresh` come from the kit's `useOrgGate`.
 * function OrganizationsGate({ state, retry, refresh, children }: Pick<OrgGateViewProps, "state" | "retry" | "children"> & { refresh: (orgId?: string) => void }) {
 *   return (
 *     <OrgGateView state={state} retry={retry} onCreated={(org) => refresh(org.metadata?.id)}>
 *       {children}
 *     </OrgGateView>
 *   );
 * }
 * ```
 */
export function OrgGateView({ state, retry, signIn, onCreated, mark, corner, children }: OrgGateViewProps) {
  switch (state.status) {
    case "bypassed":
    case "ready":
      return <>{children}</>;
    case "loading":
      return <StandaloneScreen mark={mark} corner={corner} wait="Loading your organizations…" />;
    case "error":
      return (
        <GateFailure
          mark={mark}
          corner={corner}
          error={state.error}
          headline="Stigmer couldn't load your organizations."
          retry={retry}
          signIn={signIn}
        />
      );
    case "no-orgs":
      return (
        <StandaloneScreen
          mark={mark}
          corner={corner}
          title="You're not in an organization yet"
          lead="Make one to start, or ask an admin of an existing one to invite you."
          help
        >
          <CreateOrganizationForm onCreated={onCreated} />
        </StandaloneScreen>
      );
  }
}
