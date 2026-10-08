/**
 * Pins the caller's-sign-ins lookup that grant status and disconnect share:
 * only connections a sign-in to this server saved count (never a pasted
 * login, never another server's sign-in at the same address), at every
 * address the server's sign-ins were saved at, and an empty server id
 * matches nothing even when a malformed entry carries no server id.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import type { VaultService } from "../../vault/service.js";
import { findCallerSignIns } from "../sign-in-connection.js";

const ORG = "org_1";
const caller: CallerIdentity = {
  identityId: "ida_ana",
  callerClass: "user",
  issuer: "",
  rawToken: "",
};

function vaultsHolding(vault: Vault | undefined): { vaults: VaultService } {
  const findMine = async (org: string, person: string): Promise<Vault | undefined> =>
    org === ORG && person === caller.identityId ? vault : undefined;
  return { vaults: { findMine } as unknown as VaultService };
}

const myVault = create(VaultSchema, {
  metadata: { id: "vlt_ana", org: ORG },
  spec: {
    connections: {
      "https://mcp.linear.app/mcp": {
        token: "sealed-linear",
        source: VaultConnectionSource.sign_in,
        signIn: { mcpServerId: "mcps_linear" },
      },
      "https://mcp.linear.app/old": {
        token: "sealed-linear-old",
        source: VaultConnectionSource.sign_in,
        signIn: { mcpServerId: "mcps_linear" },
      },
      "https://mcp.notion.com/mcp": {
        token: "sealed-notion",
        source: VaultConnectionSource.sign_in,
        signIn: { mcpServerId: "mcps_notion" },
      },
      "https://pasted.example.com/mcp": {
        token: "sealed-pasted",
        source: VaultConnectionSource.pasted,
      },
      "https://broken.example.com/mcp": {
        token: "sealed-broken",
        source: VaultConnectionSource.sign_in,
        signIn: { mcpServerId: "" },
      },
    },
  },
});

describe("findCallerSignIns", () => {
  it("answers the server's own sign-ins at every address they were saved at, and nothing else", async () => {
    const found = await findCallerSignIns(vaultsHolding(myVault), "mcps_linear", ORG, caller);
    expect(found.vault).toBe(myVault);
    expect(found.signIns.map((signIn) => signIn.address).sort()).toEqual([
      "https://mcp.linear.app/mcp",
      "https://mcp.linear.app/old",
    ]);
  });

  it("matches nothing for an empty server id, not even a sign-in that names no server", async () => {
    const found = await findCallerSignIns(vaultsHolding(myVault), "", ORG, caller);
    expect(found.vault).toBe(myVault);
    expect(found.signIns).toEqual([]);
  });

  it("answers no vault and no sign-ins before the caller's first save", async () => {
    const found = await findCallerSignIns(vaultsHolding(undefined), "mcps_linear", ORG, caller);
    expect(found).toEqual({ vault: undefined, signIns: [] });
  });
});
