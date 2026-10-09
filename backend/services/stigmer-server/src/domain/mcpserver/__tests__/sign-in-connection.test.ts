/**
 * Pins the caller's-sign-in lookup that grant status and disconnect share:
 * the sign-in saved at the server's address in the caller's My vault,
 * whichever page started it; never a pasted login there, a login at
 * another address, or anything for a local program (it has no address); an
 * address that names the object's prototype is never read as a login; a
 * server that does not exist answers NOT_FOUND.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import type { VaultService } from "../../vault/service.js";
import { findCallerSignIn } from "../sign-in-connection.js";

const ORG = "org_1";
const caller: CallerIdentity = {
  identityId: "ida_ana",
  callerClass: "user",
  issuer: "",
  rawToken: "",
};

function httpServer(url: string): McpServer {
  return create(McpServerSchema, {
    metadata: { id: "mcps_linear", org: ORG },
    spec: { serverType: { case: "http", value: { url } }, auth: { targetEnvVar: "LINEAR_TOKEN" } },
  });
}

function rigHolding(vault: Vault | undefined, server: McpServer | undefined) {
  const findMine = async (org: string, person: string): Promise<Vault | undefined> =>
    org === ORG && person === caller.identityId ? vault : undefined;
  const getResource = async (): Promise<McpServer> => {
    if (server === undefined) {
      throw new ResourceNotFoundError("mcp_server/mcps_linear");
    }
    return server;
  };
  return {
    vaults: { findMine } as unknown as VaultService,
    store: { getResource } as unknown as Store,
  };
}

const myVault = create(VaultSchema, {
  metadata: { id: "vlt_ana", org: ORG },
  spec: {
    connections: {
      "https://mcp.linear.app/mcp": {
        token: "sealed-linear",
        source: VaultConnectionSource.sign_in,
        signIn: { loginApp: "" },
      },
      "https://mcp.linear.app/old": {
        token: "sealed-linear-old",
        source: VaultConnectionSource.sign_in,
        signIn: { loginApp: "" },
      },
      "https://pasted.example.com/mcp": {
        token: "sealed-pasted",
        source: VaultConnectionSource.pasted,
      },
    },
  },
});

describe("findCallerSignIn", () => {
  it("answers the sign-in at the server's address, and none at its other addresses", async () => {
    const found = await findCallerSignIn(rigHolding(myVault, httpServer("https://MCP.linear.app/mcp/")), "mcps_linear", ORG, caller);
    expect(found.vault).toBe(myVault);
    expect(found.address).toBe("https://mcp.linear.app/mcp");
    expect(found.connection?.token).toBe("sealed-linear");
  });

  it("answers no sign-in for a pasted login at the address, an address naming the prototype, or a local program", async () => {
    const pasted = await findCallerSignIn(rigHolding(myVault, httpServer("https://pasted.example.com/mcp")), "mcps_linear", ORG, caller);
    expect(pasted.connection).toBeUndefined();

    const local = create(McpServerSchema, {
      metadata: { id: "mcps_linear", org: ORG },
      spec: { serverType: { case: "stdio", value: { command: "npx" } } },
    });
    const program = await findCallerSignIn(rigHolding(myVault, local), "mcps_linear", ORG, caller);
    expect(program).toMatchObject({ address: undefined, connection: undefined });
  });

  it("answers no vault and no sign-in before the caller's first save", async () => {
    const found = await findCallerSignIn(rigHolding(undefined, httpServer("https://mcp.linear.app/mcp")), "mcps_linear", ORG, caller);
    expect(found).toMatchObject({ vault: undefined, connection: undefined });
  });

  it("answers NOT_FOUND for a server that does not exist", async () => {
    const error = await findCallerSignIn(rigHolding(myVault, undefined), "mcps_linear", ORG, caller).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.NotFound);
  });
});
