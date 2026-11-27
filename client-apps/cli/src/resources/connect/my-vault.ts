// The caller's My vault and what it says about one of a plugin's servers:
// read once, judged by one rule, so `connect plugin` (which signs in only
// when no login serves the server) and `get plugin` (which says whether the
// server is signed in) never disagree on "signed in".
//
// A login is saved at a tool's address, never under the server: a login at
// the address (or, for a server on GitHub's own API, the github.com login)
// fills the server's login key, the variable its `Authorization: Bearer
// ${VAR}` header names. A server that also accepts a pasted key is served as
// well by a secret saved under that key; one that accepts only a sign-in is
// not. Values are never read: the vault answers names and addresses only.

import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { GetMyVaultInputSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/io_pb";
import { VaultConnectionSource } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { type Stigmer, StigmerError } from "@stigmer/client";
import { holdsLoginFor, toolAddress } from "./address.js";

/** The client surface My vault is read through. */
export type MyVaultClient = Pick<Stigmer, "vault">;

/** The caller's My vault in `org`, or undefined when they have none yet. */
export async function readMyVault(client: MyVaultClient, org: string): Promise<Vault | undefined> {
  try {
    return await client.vault.getMine(create(GetMyVaultInputSchema, { org }));
  } catch (err) {
    if (err instanceof StigmerError && err.connectCode === Code.NotFound) return undefined;
    throw err;
  }
}

const BEARER_PLACEHOLDER = /^Bearer\s+\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/i;

/**
 * The variable a server's login fills: the one its `Authorization: Bearer
 * ${VAR}` header names (the slot install writes for a server that signs in);
 * undefined for a server with no such header or not reached by address.
 */
export function loginKeyOf(server: McpServerEntry): string | undefined {
  if (server.transport.case !== "http") return undefined;
  for (const [name, value] of Object.entries(server.transport.value.headers)) {
    if (name.toLowerCase() !== "authorization") continue;
    const match = BEARER_PLACEHOLDER.exec(value.trim());
    if (match) return match[1];
  }
  return undefined;
}

/** What My vault holds for one server. */
export interface ServerLogin {
  /** The address a login for the server is saved at; undefined when it names none. */
  readonly address?: string;
  /** Whether My vault holds a login, or a pasted key the server accepts, that serves the server. */
  readonly signedIn: boolean;
  /** Whether a login is saved at exactly this address: what signing out removes. */
  readonly savedLogin: boolean;
  /** Whether that login came from a sign-in, so signing in again renews it. */
  readonly savedSignIn: boolean;
}

/** What `vault` (undefined: no My vault yet) holds for `server`. */
export function serverLogin(vault: Vault | undefined, server: McpServerEntry): ServerLogin {
  const address = server.transport.case === "http" ? toolAddress(server.transport.value.url) : undefined;
  if (address === undefined) return { signedIn: false, savedLogin: false, savedSignIn: false };
  const connections = vault?.spec?.connections ?? {};
  const saved = Object.hasOwn(connections, address) ? connections[address] : undefined;
  const loginKey = server.signIn?.oauthOnly === true ? undefined : loginKeyOf(server);
  const keySaved = loginKey !== undefined && Object.hasOwn(vault?.spec?.secrets ?? {}, loginKey);
  return {
    address,
    signedIn: holdsLoginFor(connections, address) || keySaved,
    savedLogin: saved !== undefined,
    savedSignIn: saved?.source === VaultConnectionSource.sign_in,
  };
}
