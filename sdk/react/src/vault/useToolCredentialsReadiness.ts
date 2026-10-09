"use client";

/**
 * Whether a surface whose runs have no person (a share's guests, a
 * channel's conversations) will find the keys its agent's tools need.
 *
 * Such runs use only the vaults the surface names, never anyone's My vault,
 * so a tool-using agent on a surface naming no vault is broken for its
 * users by construction, and this hook says so (`needs-credentials`)
 * instead of staying silent until the first message fails. A named vault
 * that cannot be read (deleted, or one the viewer may not see) or that is a
 * person's My vault (which the server refuses on these surfaces) is
 * `blocked`, named for the hint copy. The lookups run as the person viewing
 * the dialog: the server asks the same question of whoever attached each
 * vault when each run starts.
 */
import { useEffect, useMemo, useState } from "react";
import type { ResourceRef } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";

/**
 * Readiness of a surface's tool credentials for its users' runs:
 *
 * - `na` — the caller decided the check does not apply.
 * - `needs-credentials` — the check applies but no vault is named.
 * - `checking` — lookups in flight.
 * - `ready` — every named vault is a shared vault the viewer can read.
 * - `blocked` — one or more named vaults cannot serve; their `org/slug`
 *   references are listed.
 */
export type ToolCredentialsReadiness =
  | { readonly status: "na" }
  | { readonly status: "needs-credentials" }
  | { readonly status: "checking" }
  | { readonly status: "ready" }
  | { readonly status: "blocked"; readonly unusableVaults: readonly string[] };

const NA: ToolCredentialsReadiness = { status: "na" };
const NEEDS_CREDENTIALS: ToolCredentialsReadiness = { status: "needs-credentials" };

/**
 * Data hook that checks a surface's named vaults. `applicable` is the
 * caller's predicate (shares add an audience arm; channels do not).
 *
 * Surface wrappers: {@link useShareToolReadiness}, {@link useChannelToolReadiness}.
 */
export function useToolCredentialsReadiness(
  applicable: boolean,
  vaults: readonly ResourceRef[],
): ToolCredentialsReadiness {
  const stigmer = useStigmer();
  const [checked, setChecked] = useState<ToolCredentialsReadiness>(NA);

  const refsKey = useMemo(
    () => vaults.map((ref) => `${ref.org}/${ref.slug}`).join(","),
    [vaults],
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
      const unusable: string[] = [];
      for (const ref of refsKey.split(",")) {
        const [org, slug] = ref.split("/");
        try {
          const vault = await stigmer.vault.getByReference({ org, slug });
          if (vault.spec?.owner.case !== "org") unusable.push(ref);
        } catch {
          unusable.push(ref);
        }
      }
      return unusable.length === 0
        ? { status: "ready" }
        : { status: "blocked", unusableVaults: unusable };
    })().then((result) => {
      // Best-effort pre-flight advice: a vault that cannot be read is
      // reported as unusable above, never thrown, so the check settles.
      if (!cancelled) setChecked(result);
    });

    return () => {
      cancelled = true;
    };
  }, [shouldFetch, refsKey, stigmer]);

  if (!applicable) return NA;
  if (refsKey === "") return NEEDS_CREDENTIALS;
  return checked;
}
