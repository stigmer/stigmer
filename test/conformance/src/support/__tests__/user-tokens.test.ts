// Pins the user-token fixtures: a minter is an admin service account unless
// the arm names a role, with a never-expiring key; the embedding settings
// create accounts and name a role only when asked; a mint answers its
// Bearer token, and a fixture that got no id, key or token fails loudly
// instead of handing an arm an empty credential. The clients are stubbed;
// nothing here starts a server.
import { describe, expect, it } from "vitest";

import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { ConformanceClients } from "../../harness/clients";
import { API_KEY_PLAINTEXT_PREFIX } from "../apikeys";
import { createMinter, deleteMinter, mintUserToken, setEmbedding } from "../user-tokens";

function recordingClients(answers: { accountId?: string; token?: string; tokenType?: string } = {}) {
  const calls: { method: string; input: unknown }[] = [];
  const record = (method: string) => async (input: unknown) => {
    calls.push({ method, input });
    switch (method) {
      case "createServiceAccount":
        return { metadata: { id: answers.accountId ?? "ida_minter" } };
      case "createForServiceAccount":
        return { spec: { keyHash: `${API_KEY_PLAINTEXT_PREFIX}plaintext` } };
      case "mintUserToken":
        return { accessToken: answers.token ?? "user-jwt", tokenType: answers.tokenType ?? "Bearer" };
      default:
        return {};
    }
  };
  const clients = {
    identityAccountCommand: {
      createServiceAccount: record("createServiceAccount"),
      delete: record("delete"),
    },
    apiKeyCommand: { createForServiceAccount: record("createForServiceAccount") },
    organizationCommand: { updateEmbedding: record("updateEmbedding") },
    token: { mintUserToken: record("mintUserToken") },
  } as unknown as ConformanceClients;
  return { clients, calls };
}

describe("createMinter and deleteMinter", () => {
  it("creates an admin service account and a never-expiring key, and deletes the account", async () => {
    const { clients, calls } = recordingClients();
    const minter = await createMinter(clients, { org: "org_1", name: "dash" });
    await deleteMinter(clients, minter.accountId);
    expect(minter).toEqual({ accountId: "ida_minter", key: `${API_KEY_PLAINTEXT_PREFIX}plaintext` });
    expect(calls).toEqual([
      { method: "createServiceAccount", input: { org: "org_1", name: "dash", role: IamRole.admin } },
      {
        method: "createForServiceAccount",
        input: { serviceAccountId: "ida_minter", name: "dash-key", neverExpires: true },
      },
      { method: "delete", input: { value: "ida_minter" } },
    ]);
  });

  it("gives the account the role an arm names, and fails when the account comes back without an id", async () => {
    const { clients, calls } = recordingClients();
    await createMinter(clients, { org: "org_1", name: "dash", role: IamRole.member });
    expect(calls[0]?.input).toMatchObject({ role: IamRole.member });

    await expect(
      createMinter(recordingClients({ accountId: "" }).clients, { org: "org_1", name: "dash" }),
    ).rejects.toThrow("service account dash returned no id or key");
  });
});

describe("setEmbedding", () => {
  it("creates accounts on sign-in and names no role or origin by default", async () => {
    const { clients, calls } = recordingClients();
    await setEmbedding(clients, "org_1");
    expect(calls).toEqual([
      {
        method: "updateEmbedding",
        input: { orgId: "org_1", embedding: { createAccountsOnSignIn: true, allowedOrigins: [] } },
      },
    ]);
  });

  it("carries the role, origins and account creation an arm asks for", async () => {
    const { clients, calls } = recordingClients();
    await setEmbedding(clients, "org_1", {
      allowedOrigins: ["https://app.example"],
      createAccountsOnSignIn: false,
      signInRole: IamRole.viewer,
    });
    expect(calls[0]?.input).toEqual({
      orgId: "org_1",
      embedding: {
        createAccountsOnSignIn: false,
        signInRole: IamRole.viewer,
        allowedOrigins: ["https://app.example"],
      },
    });
  });
});

describe("mintUserToken", () => {
  it("answers the Bearer token, passing the person's email and name through", async () => {
    const { clients, calls } = recordingClients();
    const token = await mintUserToken(clients, "org_1", "user-7", { userEmail: "pat@example.com" });
    expect(token).toBe("user-jwt");
    expect(calls[0]?.input).toEqual({ org: "org_1", userId: "user-7", userEmail: "pat@example.com" });
  });

  it("fails on an empty token or a type other than Bearer", async () => {
    for (const answers of [{ token: "" }, { tokenType: "DPoP" }]) {
      await expect(
        mintUserToken(recordingClients(answers).clients, "org_1", "user-7"),
        JSON.stringify(answers),
      ).rejects.toThrow("mintUserToken for user-7 returned no Bearer token");
    }
  });
});
