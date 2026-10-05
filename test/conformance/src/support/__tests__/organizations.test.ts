// Pins the conformance helpers in support/organizations.ts: how the server's
// refusal copy names an organization the caller acts in (its slug, read from
// the organization the value names, and the value as given when the server
// answers no slug), and the child organization helper (it sends the parent
// and external id, and refuses a create that answers no slug or id).
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { createChildOrganization, organizationSlug } from "../organizations";

function queryAnswering(slug: string | undefined): ConformanceClients["organizationQuery"] {
  return {
    get: async () => ({ metadata: slug === undefined ? undefined : { slug } }),
  } as unknown as ConformanceClients["organizationQuery"];
}

describe("organizationSlug", () => {
  it("answers the slug of the organization a value names", async () => {
    expect(await organizationSlug(queryAnswering("acme"), "org_01jaaaaaaaaaaaaaaaaaaaaaaa")).toBe("acme");
  });

  it("answers the value as given when the server answers no slug", async () => {
    expect(await organizationSlug(queryAnswering(undefined), "org_01jaaaaaaaaaaaaaaaaaaaaaaa")).toBe(
      "org_01jaaaaaaaaaaaaaaaaaaaaaaa",
    );
  });
});

function commandAnswering(
  metadata: { slug?: string; id?: string },
  sent: unknown[],
): ConformanceClients["organizationCommand"] {
  return {
    create: async (input: unknown) => {
      sent.push(input);
      return { metadata };
    },
  } as unknown as ConformanceClients["organizationCommand"];
}

describe("createChildOrganization", () => {
  it("creates a child naming its parent and external id, and answers its slug and id", async () => {
    const sent: unknown[] = [];
    const child = await createChildOrganization(
      commandAnswering({ slug: "cust", id: "org_child" }, sent),
      "org_parent",
      "the test",
      "cust-1",
    );
    expect(child).toEqual({ slug: "cust", id: "org_child" });
    expect(sent[0]).toMatchObject({ spec: { parentOrg: "org_parent", externalId: "cust-1" } });
  });

  it("refuses a create that answers no slug or id, naming the scope", async () => {
    await expect(
      createChildOrganization(commandAnswering({ slug: "cust" }, []), "org_parent", "the test"),
    ).rejects.toThrow("cannot provision the test");
  });
});
