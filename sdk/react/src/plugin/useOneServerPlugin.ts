"use client";

/**
 * Whether an installed plugin is a plugin of one HTTP server, the kind
 * "Add MCP server" and `stigmer mcp add` make, and if so the server as its
 * files say: the form "Change address" opens prefilled with.
 *
 * The answer comes from the plugin's own files at its installed digest
 * (`listFiles` and `readFile`, the reads the runner serves skills with),
 * never from its status: a status cannot see a README or any other file
 * beside the two documents, so a change rebuilt from it would flatten
 * them. A served file list leaves the eval suite out, so a plugin with
 * one (`status.evals`) is never one-server here, whatever its listing
 * shows. The status is a cheap first filter: a plugin listing skills,
 * agents, hooks or more than one server is not read at all.
 */

import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { hasOneServerPluginPaths, type OneServerPlugin, readOneServerPlugin } from "@stigmer/plugin-package";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";

/** Return value of {@link useOneServerPlugin}. */
export interface UseOneServerPluginReturn {
  /** The one server, when the plugin is a one-server plugin; `null` otherwise or while reading. */
  readonly server: OneServerPlugin | null;
  /** `true` while the plugin's files are read. */
  readonly isLoading: boolean;
  /** The read's failure, or `null`. A failed read offers no change. */
  readonly error: Error | null;
}

/**
 * Reads whether `plugin` is a plugin of one HTTP server. Pass `null` to
 * hold it idle.
 *
 * @example
 * ```tsx
 * function ChangeAddressButton({ plugin, onOpen }: { plugin: Plugin; onOpen: () => void }) {
 *   const { server } = useOneServerPlugin(plugin);
 *   return server ? <button onClick={onOpen}>Change address</button> : null;
 * }
 * ```
 */
export function useOneServerPlugin(plugin: Plugin | null): UseOneServerPluginReturn {
  const stigmer = useStigmer();
  const pluginId = plugin?.metadata?.id ?? "";
  const slug = plugin?.metadata?.slug ?? "";
  const digest = plugin?.status?.digest ?? "";
  const candidate = plugin !== null && pluginId !== "" && digest !== "" && looksOneServer(plugin, slug);

  const { data, isLoading, error } = useFetch<OneServerPlugin | null>(
    candidate
      ? async () => {
          const listing = await stigmer.plugin.listFiles({ pluginId, digest });
          const paths = listing.files.map((file) => file.path);
          if (!hasOneServerPluginPaths(paths)) return null;
          const decoder = new TextDecoder();
          const documents = new Map<string, string>();
          for (const path of paths) {
            const file = await stigmer.plugin.readFile({ pluginId, digest, path });
            documents.set(path, decoder.decode(file.content));
          }
          const server = readOneServerPlugin(documents);
          return server !== undefined && server.name === slug ? server : null;
        }
      : null,
    [stigmer, pluginId, digest, slug, candidate],
    null,
  );

  return { server: candidate ? data : null, isLoading: candidate && isLoading, error: candidate ? error : null };
}

/** The status's first filter: one HTTP server named as the plugin, and nothing else the plugin holds. */
function looksOneServer(plugin: Plugin, slug: string): boolean {
  const status = plugin.status;
  if (status === undefined || status.evals !== undefined) return false;
  if (status.skills.length > 0 || status.agents.length > 0) return false;
  if (status.hooks !== undefined && status.hooks.groups.length > 0) return false;
  const [server, ...rest] = status.mcpServers;
  return server !== undefined && rest.length === 0 && server.name === slug && server.transport.case === "http";
}
