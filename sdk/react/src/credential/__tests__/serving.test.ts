/**
 * Saving typed values where the next run looks for them. Pinned: with no
 * credential of the person's serving the declarer, one is created, owned
 * by the person (their id from whoAmI), named after the declarer, serving
 * it alone, its values secret unless typed plain; with one, its fields are
 * set and nothing else is written; an organization-owned save names no
 * person; another owner's credential serving the same target is never
 * written into.
 */
import { describe, expect, it } from "vitest";
import { createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { saveToServingCredential } from "../serving";
import { ME, credentialWorld, routeCredentials, storedCredential, type CredentialWorld } from "./credential-world";

const ORG = "org_acme";
const LINEAR = { kind: "mcp_server", org: ORG, slug: "linear" } as const;

function client(world: CredentialWorld): Stigmer {
  return new Stigmer({
    baseUrl: "/",
    getAccessToken: () => "t",
    customTransport: createRouterTransport((router) => routeCredentials(router, world)),
  });
}

describe("saveToServingCredential", () => {
  it("creates the person's credential, named after the declarer and serving it, when none serves it", async () => {
    const world = credentialWorld([
      storedCredential({ id: "team", org: ORG, owner: "org", fields: ["KEY"], serves: [LINEAR] }),
    ]);
    await saveToServingCredential(client(world), {
      org: ORG,
      target: LINEAR,
      name: "Linear",
      values: { KEY: { value: "k", isSecret: true }, REGION: { value: "eu", isSecret: false } },
    });

    expect(world.writes.map((w) => w.rpc)).toEqual(["create"]);
    const created = world.writes[0]!.credential;
    expect(created.metadata?.name).toBe("Linear");
    expect(created.metadata?.org).toBe(ORG);
    expect(created.spec?.owner).toEqual({ case: "person", value: ME });
    expect(created.spec?.fields.KEY?.plain).toBe(false);
    expect(created.spec?.fields.REGION?.plain).toBe(true);
    expect(created.spec?.serves.map((t) => t.target)).toEqual([
      { case: "mcpServer", value: expect.objectContaining({ org: ORG, slug: "linear" }) },
    ]);
  });

  it("sets the fields of the person's credential that serves the declarer", async () => {
    const world = credentialWorld([
      storedCredential({ id: "mine", org: ORG, owner: "person", fields: ["OTHER"], serves: [LINEAR] }),
    ]);
    await saveToServingCredential(client(world), {
      org: ORG,
      target: LINEAR,
      name: "Linear",
      values: { KEY: { value: "k", isSecret: true } },
    });

    expect(world.writes.map((w) => [w.rpc, w.credential.metadata?.id, w.fields])).toEqual([["setFields", "mine", ["KEY"]]]);
    expect(Object.keys(world.credentials[0]!.spec?.fields ?? {}).sort()).toEqual(["KEY", "OTHER"]);
  });

  it("saves into the organization's credential, naming no person, for an organization-owned save", async () => {
    const world = credentialWorld([]);
    await saveToServingCredential(client(world), {
      org: ORG,
      target: LINEAR,
      name: "Linear",
      values: { KEY: { value: "k", isSecret: true } },
      owner: "org",
    });

    expect(world.writes[0]?.credential.spec?.owner).toEqual({ case: "org", value: ORG });
  });
});
