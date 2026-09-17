"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { type PluginMember, PushPluginRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import type { PreparedInstall } from "./sources/read.js";

/** What an install needs beyond the prepared archive. */
export interface InstallPluginOptions {
  /** The organization the plugin is installed into. */
  readonly org: string;
  /** Visibility for the plugin and every resource it materialises; the kind's default when omitted. */
  readonly visibility?: ApiResourceVisibility;
  /** The marketplace the archive came from, kept in the version message as `stigmer install` keeps it. */
  readonly installedFrom?: string;
}

/** The install as the server reports it: the plugin and the members it now holds. */
export interface InstallPluginOutcome {
  readonly plugin: Plugin;
  readonly members: readonly PluginMember[];
}

/** Return value of {@link useInstallPlugin}. */
export interface UseInstallPluginReturn {
  /** Push the prepared archive; resolves with the plugin and its members. Rejects with the server's refusal. */
  readonly install: (prepared: PreparedInstall, options: InstallPluginOptions) => Promise<InstallPluginOutcome>;
  /** `true` while the push is in flight. */
  readonly isInstalling: boolean;
  /** The last error, or `null`. */
  readonly error: Error | null;
  /** Reset the error state. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that installs (or upgrades) a plugin from a prepared
 * archive through `stigmer.plugin.push()`, the one RPC the CLI's `push
 * plugin` and `install` use too, size-routed by the SDK (inline under the
 * message cap, staged over HTTP above it). Pushing the archive the org
 * already holds changes nothing, by the server's contract.
 *
 * @example
 * ```tsx
 * const { install, isInstalling } = useInstallPlugin();
 * const outcome = await install(prepared, { org, installedFrom: "cursor-plugins" });
 * ```
 */
export function useInstallPlugin(): UseInstallPluginReturn {
  const stigmer = useStigmer();
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const install = useCallback(
    async (prepared: PreparedInstall, options: InstallPluginOptions): Promise<InstallPluginOutcome> => {
      setIsInstalling(true);
      setError(null);
      try {
        const plugin = await stigmer.plugin.push(
          create(PushPluginRequestSchema, {
            org: options.org,
            artifact: prepared.archive,
            message:
              options.installedFrom === undefined
                ? "installed from the console"
                : `installed from marketplace '${options.installedFrom}'`,
            ...(options.visibility !== undefined && { visibility: options.visibility }),
          }),
        );
        const members = (await stigmer.plugin.listMembers(plugin.metadata?.id ?? "")).members;
        return { plugin, members };
      } catch (err) {
        const wrapped = toError(err);
        setError(wrapped);
        throw wrapped;
      } finally {
        setIsInstalling(false);
      }
    },
    [stigmer],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(() => ({ install, isInstalling, error, clearError }), [install, isInstalling, error, clearError]);
}
