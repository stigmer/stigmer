"use client";

/**
 * "Add MCP server" and "Change address": an MCP server at an address
 * becomes a plugin of one server, built in the browser and installed
 * through the plugin push, the one way anything is installed. There is no
 * MCP server resource: a server is an entry in a plugin or in an agent's
 * own mcp_servers, and a plugin this small is two files.
 *
 * The files are `@stigmer/plugin-package`'s `oneServerPluginDocuments`,
 * the builder the CLI's `stigmer mcp add` writes with too, so the same
 * server added on either surface has the same digest. They go through the
 * library's preparation (`preparePluginArchive`, which reads them with the
 * reader the server installs with and archives them with `archivePlugin`),
 * so a refusal arrives before the push, in the reader's sentences, and the
 * digest is the one the server records. A header value may name a variable
 * as `${NAME}`; the reader declares it on the plugin, and a conversation
 * asks for it like any other key. A server that answers with a sign-in
 * challenge is marked to sign in by the server at install.
 *
 * `add` refuses a plugin of the same name already installed rather than
 * replace it: the form adds a server, and a push of the same name would
 * replace whatever that plugin holds. `change` is the one replacement:
 * it pushes a new version of a plugin the page read as one server
 * (`useOneServerPlugin`), refuses if the plugin moved on since that read,
 * and keeps the plugin's visibility, since a push that names none installs
 * at the kind's default.
 */

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PushPluginRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import type { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { inMemoryPluginFiles, oneServerPluginDocuments } from "@stigmer/plugin-package";
import { type PreparedPlugin, preparePluginArchive } from "@stigmer/plugin-package/client";
import { isNotFound } from "@stigmer/client";
import { useStigmer } from "@stigmer/react-core";
import { toError } from "@stigmer/react-core/internal";
import { PluginReadRefusal } from "./sources/read.js";

/** What the form collects: the server's name, its address, and the headers sent with every request. */
export interface McpServerFormInput {
  /** The server's name, which is also the plugin's: lowercase letters, digits, `.` and `-`. */
  readonly name: string;
  /** The server's URL. */
  readonly url: string;
  /** Headers sent with every request; a value may name a variable as `${NAME}`. */
  readonly headers?: Readonly<Record<string, string>>;
  /** What the server is for, shown on the plugin's page. */
  readonly description?: string;
}

/** Where the plugin is installed. */
export interface AddMcpServerOptions {
  readonly org: string;
  /** The plugin's visibility; the kind's default when omitted. */
  readonly visibility?: ApiResourceVisibility;
}

/** Which installed plugin a change replaces: the one the form was read from. */
export interface ChangeMcpServerOptions {
  /** The plugin as the page read it; its organization, slug, visibility and digest are the change's. */
  readonly plugin: Plugin;
}

/** Return value of {@link useAddMcpServer}. */
export interface UseAddMcpServerReturn {
  /** Build, check and install the one-server plugin. Resolves with the installed plugin; rejects with the reader's or the server's refusal. */
  readonly add: (input: McpServerFormInput, options: AddMcpServerOptions) => Promise<Plugin>;
  /**
   * Push a new version of a one-server plugin: the same name, the form's
   * address, headers and description, at the plugin's current visibility.
   * Refused without a push when the installed version is no longer the
   * one the form was read from.
   */
  readonly change: (input: McpServerFormInput, options: ChangeMcpServerOptions) => Promise<Plugin>;
  /** `true` while an add or a change is in flight. */
  readonly isAdding: boolean;
  /** The last refusal: a `PluginReadRefusal` for the reader's, an `Error` otherwise. */
  readonly error: Error | null;
  readonly clearError: () => void;
}

/**
 * The plugin files for one HTTP server, by path, in the layout every client
 * reads: `oneServerPluginDocuments`, the builder the CLI shares.
 */
export function mcpServerPluginFiles(input: McpServerFormInput): Map<string, string> {
  return oneServerPluginDocuments(input);
}

/**
 * The one-server plugin read and archived by the library, or the reader's
 * refusal thrown as a `PluginReadRefusal`.
 */
export async function prepareMcpServerPlugin(input: McpServerFormInput): Promise<PreparedPlugin> {
  const files = inMemoryPluginFiles(mcpServerPluginFiles(input));
  const totalSize = files.entries.reduce((sum, entry) => sum + entry.size, 0);
  const outcome = await preparePluginArchive({
    files,
    stats: { filesIncluded: files.entries.length, filesIgnored: 0, dirsSkipped: 0, totalSize },
  });
  if (!outcome.ok) {
    throw new PluginReadRefusal(`'${input.name.trim() || "this server"}' cannot be added`, outcome.errors, outcome.warnings);
  }
  return outcome.prepared;
}

/**
 * Behaviour hook behind the "Add MCP server" form.
 *
 * @example
 * ```tsx
 * function AddLinearButton({ onAdded }: { onAdded: (slug: string) => void }) {
 *   const { add, isAdding } = useAddMcpServer();
 *   const onClick = async () => {
 *     const plugin = await add({ name: "linear", url: "https://mcp.linear.app/mcp" }, { org: "acme" });
 *     onAdded(plugin.metadata?.slug ?? "");
 *   };
 *   return <button disabled={isAdding} onClick={onClick}>Add Linear</button>;
 * }
 * ```
 */
export function useAddMcpServer(): UseAddMcpServerReturn {
  const stigmer = useStigmer();
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const add = useCallback(
    async (input: McpServerFormInput, options: AddMcpServerOptions): Promise<Plugin> => {
      setIsAdding(true);
      setError(null);
      try {
        const prepared = await prepareMcpServerPlugin(input);
        const taken = await stigmer.plugin.getByReference({ org: options.org, slug: prepared.plugin.name }).then(
          () => true,
          (err: unknown) => {
            if (isNotFound(err)) return false;
            throw err;
          },
        );
        if (taken) {
          throw new Error(
            `a plugin named '${prepared.plugin.name}' is installed already; choose another name, or open that plugin to use its servers`,
          );
        }
        return await stigmer.plugin.push(
          create(PushPluginRequestSchema, {
            org: options.org,
            artifact: prepared.archive,
            message: "added from the console's MCP server form",
            ...(options.visibility !== undefined && { visibility: options.visibility }),
          }),
        );
      } catch (err) {
        const failure = err instanceof PluginReadRefusal ? err : toError(err);
        setError(failure);
        throw failure;
      } finally {
        setIsAdding(false);
      }
    },
    [stigmer],
  );

  const change = useCallback(
    async (input: McpServerFormInput, options: ChangeMcpServerOptions): Promise<Plugin> => {
      const meta = options.plugin.metadata;
      const org = meta?.org ?? "";
      const slug = meta?.slug ?? "";
      setIsAdding(true);
      setError(null);
      try {
        const prepared = await prepareMcpServerPlugin({ ...input, name: slug });
        const current = await stigmer.plugin.getByReference({ org, slug });
        if ((current.status?.digest ?? "") !== (options.plugin.status?.digest ?? "")) {
          throw new Error(`'${slug}' was changed since this page read it; reload the page and try again`);
        }
        return await stigmer.plugin.push(
          create(PushPluginRequestSchema, {
            org,
            artifact: prepared.archive,
            message: "address changed from the console",
            visibility: current.metadata?.visibility ?? meta?.visibility,
          }),
        );
      } catch (err) {
        const failure = err instanceof PluginReadRefusal ? err : toError(err);
        setError(failure);
        throw failure;
      } finally {
        setIsAdding(false);
      }
    },
    [stigmer],
  );

  const clearError = useCallback(() => setError(null), []);

  return useMemo(() => ({ add, change, isAdding, error, clearError }), [add, change, isAdding, error, clearError]);
}
