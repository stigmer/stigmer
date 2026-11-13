"use client";

// Who has reached an organization from a builder's own app, which of its
// backends can sign them in, and who of the team is here: one read of the
// organization's access list (the one the members page reads), shared by the
// agent page's "In your app" tab, the journey's steps 5 and 6, and the page
// that brings others in.
//
//   - App users: people a backend signed in through a minted user token
//     (`isAppUserAccount`). A mint writes the person's grant only when the
//     organization's sign-in role is set, so an app user signed in under no
//     role is not on the list; the tab offers that role for this reason.
//   - Admin service accounts: the accounts a backend's key can mint with
//     (minting is an admin's), by their direct organization role.
//   - People: everyone who signed in to Stigmer itself (`isPersonAccount`:
//     a direct or federated account), with their direct organization role.
//     The positive rule, so an entry the server could not resolve, or a
//     team, never reads as a teammate. An access entry carries no time, so
//     the list says who is here, never when they came.
//
// The list has no page (stigmer#3072), so it is read whole, as the members
// page reads it;
// a surface waiting for the first app user polls it (`refetchInterval`) and
// stops once one arrives. Asked only with `can_view_access` (fail closed),
// which every member of an organization holds: a host whose model differs
// gets nothing rather than an error.

import { useMemo } from "react";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { isAppUserAccount, isPersonAccount, isServiceAccount } from "@stigmer/client";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { useResourceAccess } from "../grant/useResourceAccess.js";
import { orgRoleOf } from "../service-account/org-role.js";

/** A person who reached the organization from its builder's app. */
export interface AppUser {
  readonly id: string;
  /** Their name, else their email, else their id. */
  readonly name: string;
}

/** A person of the team: someone who signed in to Stigmer itself and holds a place on the organization. */
export interface AccessPerson {
  readonly id: string;
  /** Their name, else their email, else their id. */
  readonly name: string;
  /** Their direct organization role, or `null` when they hold only an inherited one. */
  readonly role: IamRole | null;
}

/** Return value of {@link useAppAccess}. */
export interface UseAppAccessReturn {
  /** The app users, newest last as the list orders them; undefined until known. */
  readonly appUsers: readonly AppUser[] | undefined;
  /** The names of the service accounts that are admins of the organization; undefined until known. */
  readonly adminServiceAccounts: readonly string[] | undefined;
  /** The people of the team, in the list's order; undefined until known. */
  readonly people: readonly AccessPerson[] | undefined;
  /** Whether the viewer may read the list; undefined while asking. */
  readonly allowed: boolean | undefined;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/** Options for {@link useAppAccess}. */
export interface UseAppAccessOptions {
  /** Skip every read. */
  readonly enabled?: boolean;
  /** Re-read on this interval, in milliseconds, while waiting for someone to arrive. */
  readonly refetchInterval?: number | false;
}

/** The roles a service account can mint user tokens with. */
const MINTING_ROLES: ReadonlySet<IamRole> = new Set([IamRole.owner, IamRole.admin]);

/**
 * The organization's app users and the service accounts that can sign them
 * in, from its access list. Pass `null` to skip.
 */
export function useAppAccess(org: string | null, options: UseAppAccessOptions = {}): UseAppAccessReturn {
  const asking = (options.enabled ?? true) && org !== null && org !== "" ? org : null;
  const permission = useCheckPermission(asking ? { kind: "organization", id: asking } : null, "can_view_access", { fail: "closed" });
  const reading = asking !== null && permission.allowed ? asking : null;
  const access = useResourceAccess(reading ? { kind: "organization", id: reading } : null, { refetchInterval: options.refetchInterval });
  const known = reading !== null && !access.isLoading && access.error === null;

  return useMemo<UseAppAccessReturn>(() => {
    const allowed = asking === null || permission.isLoading ? undefined : permission.allowed;
    if (!known) {
      return { appUsers: undefined, adminServiceAccounts: undefined, people: undefined, allowed, error: reading ? access.error : null, refetch: access.refetch };
    }
    const appUsers: AppUser[] = [];
    const adminServiceAccounts: string[] = [];
    const people: AccessPerson[] = [];
    for (const entry of access.members) {
      const view = entry.principal;
      if (!view?.id) continue;
      if (isAppUserAccount(view)) {
        appUsers.push({ id: view.id, name: view.name || view.email || view.id });
      } else if (isServiceAccount(view)) {
        const role = orgRoleOf(access.members, view.id)?.role;
        if (role !== undefined && MINTING_ROLES.has(role)) adminServiceAccounts.push(view.name || view.id);
      } else if (isPersonAccount(view)) {
        people.push({ id: view.id, name: view.name || view.email || view.id, role: orgRoleOf(access.members, view.id)?.role ?? null });
      }
    }
    return { appUsers, adminServiceAccounts, people, allowed, error: null, refetch: access.refetch };
  }, [asking, permission.isLoading, permission.allowed, known, reading, access.error, access.refetch, access.members]);
}
