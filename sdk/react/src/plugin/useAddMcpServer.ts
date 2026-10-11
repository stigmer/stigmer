"use client";

/**
 * "Add MCP server": an MCP server at an address becomes a plugin of one
 * server, built in the browser and installed through the plugin push, the
 * one way anything is installed. There is no MCP server resource: a server
 * lives in a plugin, and a plugin this small is two files.
 *
 * The files are the Claude Code layout every client reads: a
 * `.claude-plugin/plugin.json` naming the plugin after the server, and a
 * `.mcp.json` holding the one HTTP entry (`{"mcpServers": {"<name>":
 * {"type": "http", "url": ..., "headers": {...}}}}`). They go through the
 * library's preparation (`preparePluginArchive`, which reads them with the
 * reader the server installs with and archives them with `archivePlugin`),
 * so a refusal arrives before the push, in the reader's sentences, and the
 * digest is the one the server records. A header value may name a variable
 * as `${NAME}`; the reader declares it on the plugin, and a conversation
 * asks for it like any other key. A server that answers with a sign-in
 * challenge is marked to sign in by the server at install.
 *
 * A plugin of the same name already installed is refused here rather than
 * replaced: the form adds a server, and a push of the same name would
 * replace whatever that plugin holds.
 */

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PushPluginRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { inMemoryPluginFiles } from "@stigmer/plugin-package";
import { type PreparedPlugin, preparePluginArchive } from "@stigmer/plugin-package/client";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
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

/** Return value of {@link useAddMcpServer}. */
export interface UseAddMcpServerReturn {
  /** Build, check and install the one-server plugin. Resolves with the installed plugin; rejects with the reader's or the server's refusal. */
  readonly add: (input: McpServerFormInput, options: AddMcpServerOptions) => Promise<Plugin>;
  readonly isAdding: boolean;
  /** The last refusal: a `PluginReadRefusal` for the reader's, an `Error` otherwise. */
  readonly error: Error | null;
  readonly clearError: () => void;
}

/** The plugin files for one HTTP server, by path, in the layout every client reads. */
export function mcpServerPluginFiles(input: McpServerFormInput): Map<string, string> {
  const name = input.name.trim();
  const description = input.description?.trim() ?? "";
  const headers = Object.fromEntries(
    Object.entries(input.headers ?? {})
      .map(([key, value]) => [key.trim(), value.trim()] as const)
      .filter(([key]) => key !== ""),
  );
  const manifest = { name, ...(description !== "" && { description }) };
  const server = { type: "http", url: input.url.trim(), ...(Object.keys(headers).length > 0 && { headers }) };
  return new Map([
    [".claude-plugin/plugin.json", `${JSON.stringify(manifest, null, 2)}\n`],
    [".mcp.json", `${JSON.stringify({ mcpServers: { [name]: server } }, null, 2)}\n`],
  ]);
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
 * const { add, isAdding } = useAddMcpServer();
 * const plugin = await add({ name: "linear", url: "https://mcp.linear.app/mcp" }, { org });
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

  const clearError = useCallback(() => setError(null), []);

  return useMemo(() => ({ add, isAdding, error, clearError }), [add, isAdding, error, clearError]);
}
