"use client";

/**
 * Which keys a run of an agent reads from the person's My vault: the one reading the console's key line and the update
 * notice share, so neither names a key the server never fills.
 *
 * The server's rule (the run's value plan, `domain/vault/resolve.ts` in
 * the server): each declarer's keys are matched on their own, from the
 * running person's My vault when the conversation includes it and every
 * agent of the run (the agent and each subagent it lists) belongs to the
 * run's own organization: a run carrying an agent another organization
 * published reads none, for any of its keys. Each agent's `spec.env` lists
 * its own keys (a subagent's at the version the agent pins); every server
 * the run dials (the agents' own and their plugins', `runServers.ts`) and
 * every plugin's hooks read keys of their own; each is read for the
 * declarer that needs it, and a key the runner always fills is read from
 * no vault. The login key of a server that signs in is filled by a login
 * at the server's address first, so the person signs in for it rather
 * than saving a key. So the keys named here are the run's
 * (`runDeclarations`) minus every such login key, and none at all for a
 * run carrying another organization's agent, or for an app user (an
 * account a host's product signed in, `isAppUser`), whose runs read only
 * the logins in their My vault, never a key by name. The reading is the
 * composer's own (`useAgentSetup`), so the two never disagree.
 *
 * A run's organization may be named by its slug, as an embedded chat names
 * it (`<AgentChat agent="acme/variance-reporter">`), while an agent names
 * its organization by id. The slug is turned into the id through the
 * console's organization list when one is mounted, and otherwise through
 * the caller's own organizations, read once ({@link organizationIdOf});
 * until that answer lands the keys are not ready, so an agent of the run's
 * own organization is never taken for another's.
 *
 * The subagents and plugins are read by reference; while they load the
 * answer is not ready, so a caller never names a key a moment later
 * withdrawn. A subagent or plugin that cannot be read names only the
 * other keys: its own are not known, and the run says what it lacks.
 *
 * Pinned by `__tests__/usePersonalKeys.test.tsx`.
 */

import { useMemo } from "react";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { Stigmer } from "@stigmer/client";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";
import { readAgentServers, runDeclarations, signInKeys, subagentOrgs } from "./runServers.js";
import { isAppUser } from "./appUser.js";
import { findOrgByRef, useKnownOrgs } from "../organization/OrgProvider.js";

/**
 * The organization `ref` names (an id or a slug), looked up among the
 * caller's own: from `known`, the organizations a mounted provider holds
 * (the caller's own and the one they have open); with no provider
 * (`undefined`), from the caller's own organizations, read until one
 * matches. `id` is the match's id, or `ref` itself when none matches (an id
 * names itself, and a reference to an organization the caller is not in is
 * judged as named). `mine` tells the two apart, and both from a list that
 * could not be read (`null`): a chat that cannot start says "none of your
 * organizations is named that" only when the list said so. A provider
 * whose list is still loading or failed to load passes `known` as `null`:
 * its empty list says nothing, so the answer is `mine: null`.
 */
export async function lookUpOrganization(
  stigmer: Pick<Stigmer, "organization">,
  ref: string,
  known: readonly Organization[] | null | undefined,
): Promise<{ readonly id: string; readonly mine: boolean | null }> {
  if (ref === "") return { id: "", mine: null };
  if (known === null) return { id: ref, mine: null };
  if (known !== undefined) {
    const match = findOrgByRef(known, ref);
    return { id: match?.metadata?.id || ref, mine: match !== undefined };
  }
  try {
    for await (const org of stigmer.organization.listMineAll({})) {
      if (org.metadata?.id === ref || org.metadata?.slug === ref) return { id: org.metadata.id || ref, mine: true };
    }
  } catch {
    // Unreadable: judged as named, as before the lookup existed.
    return { id: ref, mine: null };
  }
  return { id: ref, mine: false };
}

/**
 * The id of the organization `ref` names (an id or a slug), by
 * {@link lookUpOrganization}: `ref` itself when none of the caller's
 * organizations matches, or when they cannot be read.
 */
export async function organizationIdOf(
  stigmer: Pick<Stigmer, "organization">,
  ref: string,
  known: readonly Organization[] | undefined,
): Promise<string> {
  return (await lookUpOrganization(stigmer, ref, known)).id;
}

/**
 * The id of the organization `ref` names (an id or a slug), by
 * {@link organizationIdOf}: at once when a provider is mounted, and `null`
 * while the caller's own organizations are read when none is.
 */
export function useOrganizationId(ref: string): string | null {
  const stigmer = useStigmer();
  const orgs = useKnownOrgs();
  const known = useMemo(() => (orgs ? findOrgByRef(orgs, ref)?.metadata?.id || ref : null), [orgs, ref]);
  const { data: looked, isLoading } = useFetch(
    known === null && ref !== "" ? () => organizationIdOf(stigmer, ref, undefined) : null,
    [known, ref, stigmer],
    null as string | null,
    { cacheKey: known === null && ref !== "" ? `organization-id:${ref}` : undefined },
  );
  if (known !== null) return known;
  if (ref === "") return "";
  return isLoading ? null : looked;
}

/** Return value of {@link usePersonalKeys}. */
export interface UsePersonalKeysReturn {
  /** The keys, sorted; empty when there are none or the answer is not ready. */
  readonly keys: readonly string[];
  /** `true` once the run's subagents and servers have been read and `keys` is the answer. */
  readonly isReady: boolean;
}

/**
 * The keys a run of `agent` at `spec` reads from the person's My vault, for a conversation in `runOrg` (an organization id, as
 * stored resources name it, or its slug). `spec` is the version the run will use: the
 * pinned one for a conversation that has one, else the agent's current
 * spec. Pass `null` for either while it loads.
 */
export function usePersonalKeys(
  agent: Agent | null,
  spec: AgentSpec | null | undefined,
  runOrg: string,
): UsePersonalKeysReturn {
  const stigmer = useStigmer();
  const runOrgId = useOrganizationId(runOrg);
  const agentOrg = agent?.metadata?.org ?? "";
  const sameOrganization =
    agent !== null &&
    runOrgId !== null &&
    runOrgId !== "" &&
    agentOrg === runOrgId &&
    subagentOrgs(spec ?? undefined, agentOrg).every((subagentOrg) => subagentOrg === runOrgId);

  const { data: serverKeys, isLoading } = useFetch(
    sameOrganization && spec
      ? async () => {
          // An app user's runs read no key by name from My vault (the module header).
          if (await isAppUser(stigmer)) {
            return { declared: [], signIn: new Set<string>() };
          }
          // An unreadable subagent or plugin is left out: its keys are not known (the module header).
          const reading = await readAgentServers(stigmer, spec, agentOrg, { plugins: "skip" });
          return { declared: Object.keys(runDeclarations(reading)), signIn: signInKeys(reading) };
        }
      : null,
    [sameOrganization, spec, agentOrg, stigmer],
    null as { readonly declared: readonly string[]; readonly signIn: ReadonlySet<string> } | null,
  );

  return useMemo(() => {
    if (agent === null || spec === null || spec === undefined || runOrgId === null) {
      return { keys: [], isReady: false };
    }
    if (!sameOrganization) {
      return { keys: [], isReady: true };
    }
    if (isLoading || serverKeys === null) {
      return { keys: [], isReady: false };
    }
    const keys = serverKeys.declared.filter((key) => !serverKeys.signIn.has(key)).sort();
    return { keys, isReady: true };
  }, [agent, spec, runOrgId, sameOrganization, isLoading, serverKeys]);
}
