"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";

/**
 * Readiness of a connection's tool credentials for its visitors'
 * executions. Shared vocabulary for every connection kind that binds
 * `environment_refs` (shares, channels):
 *
 * - `na` — nothing to check: the caller decided the check does not
 *   apply (no MCP tools, connection disabled, local deployment, …).
 * - `needs-credentials` — the check applies but no environments are
 *   bound: tool calls will fail until credentials are bound.
 * - `checking` — lookups in flight.
 * - `ready` — every bound environment is shared with the organization.
 * - `blocked` — one or more bound environments are private; their
 *   `org/slug` references are listed for the hint copy.
 */
export type ToolCredentialsReadiness =
  | { readonly status: "na" }
  | { readonly status: "needs-credentials" }
  | { readonly status: "checking" }
  | { readonly status: "ready" }
  | { readonly status: "blocked"; readonly privateEnvironments: readonly string[] };

const NA: ToolCredentialsReadiness = { status: "na" };
const NEEDS_CREDENTIALS: ToolCredentialsReadiness = { status: "needs-credentials" };

/**
 * Data hook that checks whether a connection's bound credentials will
 * work at runtime — i.e. whether environments are bound and each one is
 * shared with the organization (`visibility_org`).
 *
 * The runtime resolves connection-bound credentials exclusively through
 * the org-shared environment seam (decision 011 — the agent's default
 * instance stays pristine and is never consulted). So a tool-using
 * agent with an empty binding list is *guaranteed* broken for the
 * connection's users, and this hook says so explicitly
 * (`needs-credentials`) instead of staying silent — the gap that made a
 * share misconfiguration invisible until a visitor's first message
 * failed (sharing project, session 12).
 *
 * `applicable` is the caller's predicate: connection kinds differ in
 * when the check matters (shares add an audience arm; channels do not),
 * so the caller owns that decision and this hook owns the lookups. All
 * lookups run as the owner viewing the dialog, who can read the bound
 * environments.
 *
 * Connection-kind wrappers: {@link useShareToolReadiness} (shares),
 * {@link useChannelToolReadiness} (channels).
 */
export function useToolCredentialsReadiness(
  applicable: boolean,
  environmentRefs: readonly ResourceRef[],
): ToolCredentialsReadiness {
  const stigmer = useStigmer();
  const [checked, setChecked] = useState<ToolCredentialsReadiness>(NA);

  // Stable key for the effect: the visibility lookups depend only on
  // which environments are bound, not on the array's identity.
  const refsKey = useMemo(
    () => environmentRefs.map((ref) => `${ref.org}/${ref.slug}`).join(","),
    [environmentRefs],
  );

  const shouldFetch = applicable && refsKey !== "";

  useEffect(() => {
    if (!shouldFetch) {
      setChecked(NA);
      return;
    }

    let cancelled = false;
    setChecked({ status: "checking" });

    (async (): Promise<ToolCredentialsReadiness> => {
      const privateRefs: string[] = [];
      for (const ref of refsKey.split(",")) {
        const [org, slug] = ref.split("/");
        try {
          const env = await stigmer.environment.getByReference({ org, slug });
          if (
            env.metadata?.visibility !== ApiResourceVisibility.visibility_org
          ) {
            privateRefs.push(ref);
          }
        } catch {
          // Unreadable ref (deleted, foreign): the runtime's merge will
          // skip it too — surface it as blocking.
          privateRefs.push(ref);
        }
      }

      return privateRefs.length === 0
        ? { status: "ready" }
        : { status: "blocked", privateEnvironments: privateRefs };
    })().then(
      (result) => {
        if (!cancelled) setChecked(result);
      },
      () => {
        // The hint is best-effort pre-flight advice — a failed check must
        // never block the dialog. The runtime error path still diagnoses.
        if (!cancelled) setChecked(NA);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [shouldFetch, refsKey, stigmer]);

  if (!applicable) return NA;
  // Zero bindings needs no lookup: a tool-using agent without bound
  // credentials is broken for the connection's users by construction.
  if (refsKey === "") return NEEDS_CREDENTIALS;
  return checked;
}
