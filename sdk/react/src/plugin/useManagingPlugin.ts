"use client";

import { useMemo } from "react";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/**
 * The label a plugin stamps on every resource it installs; its value is the
 * plugin's id. Written only by the server's plugin controller; a client
 * reads it to know a resource is a plugin's to redefine.
 */
export const PLUGIN_LABEL = "stigmer.ai/plugin";

/** Return value of {@link useManagingPlugin}. */
export interface UseManagingPluginReturn {
  /** The plugin that installed the resource, or `null` when none does (no label, or the plugin is gone). */
  readonly plugin: Plugin | null;
  /** `true` while the label's plugin is being read. */
  readonly isLoading: boolean;
}

/**
 * Behaviour hook that says whether a resource is managed by an installed
 * plugin, from the resource's own labels.
 *
 * The server refuses a client edit of a labelled resource only while the
 * labelled plugin row exists (a label alone never locks a resource), so
 * this hook answers the same way: a label whose plugin no longer exists
 * yields `null`, and the resource is the user's again. Detail views narrow
 * `editable` by this answer so an edit form is never offered for a write
 * the server would refuse.
 */
export function useManagingPlugin(labels: Readonly<Record<string, string>> | undefined): UseManagingPluginReturn {
  const stigmer = useStigmer();
  const pluginId = labels?.[PLUGIN_LABEL] ?? null;

  const { data: plugin, isLoading } = useFetch(
    pluginId
      ? async () => {
          try {
            return await stigmer.plugin.get(pluginId);
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null,
    [pluginId, stigmer],
    null,
  );

  return useMemo(() => ({ plugin, isLoading }), [plugin, isLoading]);
}
