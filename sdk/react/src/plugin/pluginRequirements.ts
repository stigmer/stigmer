/**
 * What the plugins an agent lists ask of the person running it: the keys
 * their servers and hooks read, and the servers that sign in. The
 * console's mirror of the server's run requirements (each MCP server of
 * each listed plugin reads the variables its entry names, declared by the
 * plugin or else a required secret; each plugin's hooks read the
 * variables `hookVariableReferences` finds; a server that signs in is
 * filled by a login at its address), so the composer asks for what a run
 * would refuse without, and nothing else.
 *
 * Reading the plugins is one fetch each, by reference: the reference's
 * organization, else the agent's. A plugin that cannot be read throws, as
 * it would refuse the run.
 */

import { create } from "@bufbuild/protobuf";
import type { Stigmer, ResourceRef } from "@stigmer/sdk";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import {
  EnvVarDeclarationSchema,
  type EnvVarDeclaration,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { hookVariableReferences } from "@stigmer/plugin-package";
import { toolAddressOf, toolLoginKeyOf } from "../vault/address.js";

/** A server of a listed plugin that signs in, with the address its login is saved at. */
export interface SignInServer {
  /** The plugin, by the reference the agent lists it with (organization filled). */
  readonly plugin: ResourceRef;
  readonly pluginName: string;
  readonly server: McpServerEntry;
  readonly address: string;
}

/** Each listed plugin, read by reference; `defaultOrg` fills a reference that names no organization. */
export async function readPlugins(
  stigmer: Pick<Stigmer, "plugin">,
  refs: readonly ResourceRef[],
  defaultOrg: string,
): Promise<{ readonly ref: ResourceRef; readonly plugin: Plugin }[]> {
  const read: { readonly ref: ResourceRef; readonly plugin: Plugin }[] = [];
  for (const listed of refs) {
    const ref = { org: listed.org || defaultOrg, slug: listed.slug };
    read.push({ ref, plugin: await stigmer.plugin.getByReference(ref) });
  }
  return read;
}

/**
 * Every key the plugins' servers and hooks read, with its declaration: the
 * plugin's own, else a required secret. A name two plugins declare keeps
 * the first declaration seen; the run matches each declarer on its own,
 * and the composer asks for a name once.
 */
export function pluginDeclarations(plugins: readonly Plugin[]): Record<string, EnvVarDeclaration> {
  const declarations: Record<string, EnvVarDeclaration> = {};
  for (const plugin of plugins) {
    const status = plugin.status;
    if (status === undefined) continue;
    const names = [
      ...status.mcpServers.flatMap((server) => server.env),
      ...(status.hooks !== undefined ? hookVariableReferences(status.hooks) : []),
    ];
    for (const name of names) {
      if (Object.hasOwn(declarations, name)) continue;
      // Defined, not assigned: a name read from a plugin may be `__proto__`.
      Object.defineProperty(declarations, name, {
        value: status.env[name] ?? create(EnvVarDeclarationSchema, { isSecret: true, optional: false }),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return declarations;
}

/** The HTTP servers among the plugins that sign in, one per address. */
export function signInServers(read: readonly { readonly ref: ResourceRef; readonly plugin: Plugin }[]): SignInServer[] {
  const byAddress = new Map<string, SignInServer>();
  for (const { ref, plugin } of read) {
    for (const server of plugin.status?.mcpServers ?? []) {
      if (server.transport.case !== "http" || server.signIn === undefined) continue;
      const address = toolAddressOf(server);
      if (address === null || byAddress.has(address)) continue;
      byAddress.set(address, { plugin: ref, pluginName: plugin.metadata?.name || ref.slug, server, address });
    }
  }
  return [...byAddress.values()];
}

/** The login key of every server among the plugins that signs in: filled by a sign-in, never typed. */
export function signInKeys(plugins: readonly Plugin[]): Set<string> {
  const keys = new Set<string>();
  for (const plugin of plugins) {
    for (const server of plugin.status?.mcpServers ?? []) {
      if (server.signIn === undefined) continue;
      const key = toolLoginKeyOf(server);
      if (key !== null) keys.add(key);
    }
  }
  return keys;
}

/** Every server among the plugins, for matching the logins a vault holds. */
export function serversOf(plugins: readonly Plugin[]): McpServerEntry[] {
  return plugins.flatMap((plugin) => plugin.status?.mcpServers ?? []);
}
