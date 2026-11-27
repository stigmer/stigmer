// How each of a plugin's servers is signed in to and how each of its keys is
// filled, read from the plugin's status: the one reading behind the lines an
// install prints after it lands (`nextSteps` in plugin.ts) and the Servers
// and Keys sections `get plugin` prints (views/plugin.ts), so the two never
// say different things about the same plugin.
//
// A server signs in when its status entry carries `sign_in`; its login key is
// the variable its `Authorization: Bearer ${VAR}` header names, which a
// sign-in fills, and which a person may paste instead unless the server
// accepts only a sign-in. Every other key the plugin declares is pasted into
// My vault, or a vault the conversation lists. A name the runner fills itself
// (who is calling, the conversation) is no key a person gives, and a key the
// plugin gives a value of its own is not asked.

import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { RUNNER_FILLED_VARIABLES } from "@stigmer/plugin-package";
import { loginKeyOf } from "./connect/my-vault.js";

/** One server that signs in, and the command that signs in to it. */
export interface ServerSignIn {
  readonly server: McpServerEntry;
  /** `stigmer connect plugin <plugin>`, naming the server when the plugin has several. */
  readonly command: string;
  /** The variable the sign-in fills, when the server's header names one. */
  readonly loginKey?: string;
  /** Whether the server accepts only a sign-in, and no pasted key. */
  readonly oauthOnly: boolean;
}

/** One key the plugin reads, and how it is filled. */
export interface PluginKey {
  readonly name: string;
  readonly isSecret: boolean;
  readonly optional: boolean;
  readonly description: string;
  /** Whether the plugin gives the key a value of its own, so nobody is asked for it. */
  readonly setByPlugin: boolean;
  /** The server whose sign-in fills the key, when it is a login key. */
  readonly filledBySignIn?: ServerSignIn;
  /** The command that saves it in My vault; undefined for a key only a sign-in fills. */
  readonly saveCommand?: string;
}

/** The plugin's name as a command names it. */
export function pluginCommandName(plugin: Plugin): string {
  return plugin.metadata?.slug || plugin.spec?.name || plugin.metadata?.name || "";
}

/** The command that signs in to (and lists the tools of) one of the plugin's servers. */
export function connectCommand(plugin: Plugin, server: McpServerEntry): string {
  const servers = plugin.status?.mcpServers ?? [];
  return `stigmer connect plugin ${pluginCommandName(plugin)}${servers.length > 1 ? ` --server ${server.name}` : ""}`;
}

/** The plugin's servers that sign in, in the plugin's order. */
export function serverSignIns(plugin: Plugin): ServerSignIn[] {
  return (plugin.status?.mcpServers ?? [])
    .filter((server) => server.signIn !== undefined)
    .map((server) => {
      const loginKey = loginKeyOf(server);
      return {
        server,
        command: connectCommand(plugin, server),
        ...(loginKey !== undefined && { loginKey }),
        oauthOnly: server.signIn?.oauthOnly === true,
      };
    });
}

/** The keys the plugin reads, by name, leaving out any the runner fills. */
export function pluginKeys(plugin: Plugin): PluginKey[] {
  const signIns = serverSignIns(plugin);
  return Object.entries(plugin.status?.env ?? {})
    .filter(([name]) => !RUNNER_FILLED_VARIABLES.has(name))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, declaration]) => {
      const filledBySignIn = signIns.find((signIn) => signIn.loginKey === name);
      const pastable = filledBySignIn === undefined || !filledBySignIn.oauthOnly;
      return {
        name,
        isSecret: declaration.isSecret,
        optional: declaration.optional,
        description: declaration.description,
        setByPlugin: declaration.value !== "",
        ...(filledBySignIn !== undefined && { filledBySignIn }),
        ...(pastable && { saveCommand: saveKeyCommand(name) }),
      };
    });
}

/** The command that saves a key in My vault. */
export function saveKeyCommand(name: string): string {
  return `stigmer vault set-secret ${name} --mine`;
}

/** How a key is filled, in one sentence. */
export function keyFilledBy(key: PluginKey): string {
  if (key.setByPlugin) return "Set by the plugin.";
  if (key.filledBySignIn !== undefined) {
    return `Filled when you sign in to ${key.filledBySignIn.server.name}${key.filledBySignIn.oauthOnly ? "" : ", or paste one"}.`;
  }
  return "Paste it into My vault, or a vault the conversation lists.";
}
