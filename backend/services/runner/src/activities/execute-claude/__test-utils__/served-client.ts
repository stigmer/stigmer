/**
 * An MCP client standing in for the Claude engine against the host's
 * served tools: the real loopback endpoint (`loopback-mcp.ts`) over the
 * given servers, dialled the way the engine dials it (streamable HTTP, the
 * endpoint's own bearer header from its configuration). Every call is
 * admitted unless the test hands its own admission.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { startLoopbackMcp, type CallAdmission, type LoopbackMcp, type ServedServer } from "../loopback-mcp.js";

/** A client on one served server, with the endpoint it reaches. */
export interface ServedClient {
  readonly client: Client;
  readonly endpoint: LoopbackMcp;
  close(): Promise<void>;
}

/** Serve `servers` and connect a client to the one named `name` (the first, by default). */
export async function connectServed(servers: readonly ServedServer[], options: { readonly admit?: CallAdmission; readonly name?: string } = {}): Promise<ServedClient> {
  const endpoint = await startLoopbackMcp(servers, options.admit ?? (() => undefined));
  const name = options.name ?? servers[0]!.name;
  const config = endpoint.configs[name]!;
  const client = new Client({ name: "engine", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } }));
  return {
    client,
    endpoint,
    close: async () => {
      await client.close();
      await endpoint.close();
    },
  };
}
