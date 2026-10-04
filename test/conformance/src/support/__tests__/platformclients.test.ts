// Pins the PlatformClient fixture's spec: a client creates the accounts it
// mints for unless told otherwise, and names a sign-in role only when the
// arm asks for one (an unset role grants nothing). The command service is
// stubbed; nothing here starts a server.
import { describe, expect, it } from "vitest";

import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { ConformanceClients } from "../../harness/clients";
import { createPlatformClient } from "../platformclients";

function recordingClients(): { clients: ConformanceClients; specs: unknown[] } {
  const specs: unknown[] = [];
  const clients = {
    platformClientCommand: {
      create: async (input: { spec: unknown }) => {
        specs.push(input.spec);
        return {
          platformClient: { metadata: { id: "pcl_1", slug: "dash" }, spec: { clientId: "stgm_cid_1" } },
          clientSecret: "stgm_cs_1",
        };
      },
    },
  } as unknown as ConformanceClients;
  return { clients, specs };
}

describe("createPlatformClient", () => {
  it("creates accounts on sign-in and names no role by default", async () => {
    const { clients, specs } = recordingClients();
    await createPlatformClient(clients, { org: "org_1", name: "dash" });
    expect(specs).toEqual([{ createAccountsOnSignIn: true, allowedOrigins: [] }]);
  });

  it("names the sign-in role an arm asks for, and creates no accounts when told not to", async () => {
    const { clients, specs } = recordingClients();
    await createPlatformClient(clients, {
      org: "org_1",
      name: "dash",
      createAccountsOnSignIn: false,
      signInRole: IamRole.member,
    });
    expect(specs).toEqual([{ createAccountsOnSignIn: false, signInRole: IamRole.member, allowedOrigins: [] }]);
  });
});
