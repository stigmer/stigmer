// `get plugin`: what a plugin holds and how a person manages it, in the words
// the console's plugin page uses. The summary gives what it is for, its
// version and the digest of the installed archive; then its servers, each
// with how it is reached and whether the caller is signed in to it, with the
// command that signs in (or in again, or out); its keys, each with how it is
// filled (a sign-in, or a key pasted into My vault), whether My vault holds
// it, and the command that saves it; its skills and agents by the names a
// turn uses (`<plugin>:<name>`); how it changes and is removed; and why its
// name never changes.
//
// The view reads the caller's My vault beside the resource (`related`), by
// the one rule `connect plugin` signs in by (connect/my-vault.ts); a vault
// that could not be read leaves the saved states unsaid, never guessed. The
// server sign-ins and the keys are plugin-access.ts's reading, the one the
// install's "Next" lines print. json and yaml stay the whole resource.

import { fromJson } from "@bufbuild/protobuf";
import { type Plugin, PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { toolServerSegment } from "@stigmer/plugin-package";
import { readMyVault, serverLogin } from "../connect/my-vault.js";
import {
  connectCommand,
  keyFilledBy,
  type PluginKey,
  pluginCommandName,
  pluginKeys,
  serverSignIns,
} from "../plugin-access.js";
import { type JsonObject, obj, str } from "../render.js";
import type { KindView, Section, ViewContext } from "./view.js";

export const pluginView: KindView = {
  sections: (json, ctx) => {
    const plugin = asPlugin(json);
    const name = pluginCommandName(plugin);
    const status = plugin.status;
    const spec = obj(json, "spec");
    return [
      {
        fields: [
          ["Description", str(spec, "description")],
          ["Version", str(spec, "version")],
          ["Digest", (status?.digest ?? "").slice(0, 12)],
        ],
      },
      { title: "Servers", lines: (status?.mcpServers ?? []).flatMap((server) => serverLines(plugin, server, ctx)) },
      { title: "Keys", lines: pluginKeys(plugin).flatMap((key) => keyLines(plugin, key, ctx)) },
      {
        title: "Skills",
        rows: (status?.skills ?? []).map((skill) => [`${name}:${skill.name}`, skill.description]),
      },
      {
        title: "Agents",
        rows: (status?.agents ?? []).map((agent) => [`${name}:${agent.name}`, agent.description]),
      },
      { title: "Change or remove", lines: changeLines(plugin) },
      { title: "Name", lines: [renameSentence(name)] },
    ] satisfies Section[];
  },
  related: async (client, json) => {
    const org = str(obj(json, "metadata"), "org");
    try {
      return { myVault: (await readMyVault(client, org)) ?? null };
    } catch {
      // A vault that cannot be read leaves the saved states unsaid.
      return {};
    }
  },
};

/** Why a plugin's name never changes, and the way to another name. */
export function renameSentence(name: string): string {
  return (
    `Its name is part of every tool name its agents use (mcp__${toolServerSegment(name, "")}…), so it doesn't change. ` +
    "To use another name, add it again under that name, move your agents to it, and remove this one."
  );
}

// The plugin back from the view's protojson, so the sign-in and key reading
// is the install's own over the same message.
function asPlugin(json: JsonObject): Plugin {
  return fromJson(PluginSchema, json, { ignoreUnknownFields: true });
}

// My vault as read: a vault, undefined for none yet, or unread.
function vaultOf(ctx: ViewContext): { readonly read: boolean; readonly vault: Vault | undefined } {
  return ctx.myVault === undefined ? { read: false, vault: undefined } : { read: true, vault: ctx.myVault ?? undefined };
}

function serverLines(plugin: Plugin, server: McpServerEntry, ctx: ViewContext): string[] {
  const lines = [`- ${server.name}  ${reachedBy(server)}`];
  const command = connectCommand(plugin, server);
  if (server.signIn !== undefined && server.transport.case === "http") {
    const { read, vault } = vaultOf(ctx);
    const login = serverLogin(vault, server);
    if (!read) {
      lines.push("  Signs in. To sign in:", `    ${command}`);
    } else if (!login.signedIn) {
      lines.push("  Not signed in. To sign in:", `    ${command}`);
    } else {
      lines.push(login.savedSignIn ? "  Signed in. To sign in again:" : "  Signed in.");
      if (login.savedSignIn) lines.push(`    ${command} --sign-in-again`);
      if (login.savedLogin && login.address !== undefined) {
        lines.push("  To sign out:", `    stigmer vault remove-connection ${login.address} --mine`);
      }
    }
  } else {
    const keys = server.env.filter((name) => pluginKeys(plugin).some((key) => key.name === name && !key.setByPlugin));
    if (keys.length > 0) lines.push(`  Reads ${keys.join(", ")}; see Keys.`);
  }
  lines.push(`  Tools: mcp__${toolServerSegment(pluginCommandName(plugin), server.name)}__*`);
  return lines;
}

function keyLines(plugin: Plugin, key: PluginKey, ctx: ViewContext): string[] {
  const kind = [key.isSecret ? "secret" : "setting", key.optional ? "optional" : "required"].join(", ");
  const lines = [`- ${key.name} (${kind})${key.description !== "" ? `: ${key.description}` : ""}`];
  const state: string[] = [keyFilledBy(key)];
  const { read, vault } = vaultOf(ctx);
  const saved = read && !key.setByPlugin ? keySaved(key, vault) : undefined;
  if (saved !== undefined) state.push(saved ? "Saved in My vault." : "Not in My vault.");
  const save = key.setByPlugin ? undefined : key.saveCommand;
  if (save !== undefined) {
    state.push(key.filledBySignIn !== undefined ? "To paste one:" : saved === true ? "To replace it:" : "To save it:");
  }
  lines.push(`  ${state.join(" ")}`);
  if (save !== undefined) lines.push(`    ${save}`);
  return lines;
}

// A login key counts as saved when a login serves its server; any key, when
// a secret of its name is saved.
function keySaved(key: PluginKey, vault: Vault | undefined): boolean {
  if (key.filledBySignIn !== undefined && serverLogin(vault, key.filledBySignIn.server).signedIn) return true;
  return Object.hasOwn(vault?.spec?.secrets ?? {}, key.name);
}

function changeLines(plugin: Plugin): string[] {
  const name = pluginCommandName(plugin);
  return [
    ...(looksOneServer(plugin)
      ? ["To change its address:", `  stigmer mcp add ${name} <new-address>`]
      : ["To change it, change its folder and push it again:", "  stigmer push plugin <folder>"]),
    "To remove it (refused while an agent lists it; logins you saved for its servers stay in My vault):",
    `  stigmer delete plugin ${name}`,
  ];
}

// A plugin `mcp add` could have made, as its status reads: one server at an
// address, named as the plugin, and nothing else. `mcp add` itself decides
// from the plugin's files.
function looksOneServer(plugin: Plugin): boolean {
  const status = plugin.status;
  const servers = status?.mcpServers ?? [];
  return (
    servers.length === 1 &&
    servers[0]?.transport.case === "http" &&
    servers[0].name === pluginCommandName(plugin) &&
    (status?.skills.length ?? 0) === 0 &&
    (status?.agents.length ?? 0) === 0 &&
    (status?.hooks?.groups.length ?? 0) === 0 &&
    status?.evals === undefined
  );
}

function reachedBy(server: McpServerEntry): string {
  switch (server.transport.case) {
    case "http":
      return server.transport.value.url;
    case "stdio":
      return [server.transport.value.command, ...server.transport.value.args].join(" ");
    default:
      return "";
  }
}
