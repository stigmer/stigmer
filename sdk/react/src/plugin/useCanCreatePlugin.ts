"use client";

import { useMemo } from "react";
import { useCheckPermission } from "../grant/useCheckPermission.js";

/** Return value of {@link useCanCreatePlugin}. */
export interface UseCanCreatePluginReturn {
  /** Whether the viewer may install a plugin, or add or change an agent's MCP servers, in the organization. */
  readonly allowed: boolean;
  /** `true` while the server's answer is in flight. */
  readonly isLoading: boolean;
}

/**
 * Mirrors the server's bar for pointing an organization's runs at a new
 * address, `can_create_plugin` on the organization: installing a plugin,
 * and adding or changing an MCP server an agent writes itself (the agent
 * save's MCP servers guard asks the same permission). Its admins hold it;
 * a member does not.
 *
 * The answer is the server's own self-check, which asks the authorizer
 * the save asks, so the console and the server agree in every edition.
 * Unlike a creation gate it fails closed: it gates edit controls on pages
 * a member also reads, so a member never sees a control the server would
 * refuse, even while the answer is in flight or when the check fails.
 *
 * Pass `null` for `org` while it loads: `allowed` stays `false`.
 *
 * @param org  The organization's id, or `null` while loading.
 */
export function useCanCreatePlugin(org: string | null): UseCanCreatePluginReturn {
  const { allowed, isLoading } = useCheckPermission(
    org ? { kind: "organization", id: org } : null,
    "can_create_plugin",
    { fail: "closed" },
  );
  return useMemo(
    () => ({ allowed: !!org && allowed, isLoading: !!org && isLoading }),
    [org, allowed, isLoading],
  );
}
