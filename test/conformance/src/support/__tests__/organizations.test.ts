// Pins the conformance helpers in support/organizations.ts: how the server's
// refusal copy names an organization the caller acts in (its slug, read from
// the organization the value names, and the value as given when the server
// answers no slug), and the child organization helper (it sends the parent
// and external id, and refuses a create that answers no slug or id), and the
// create of a deleted organization's slug (it retries while the slug is held,
// ALREADY_EXISTS, and fails on any other answer or once its time is up), and
// the caller taking admin in a child it made (the ordinary grant naming the
// account whoAmI answers, refused when whoAmI answers none).
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { createChildOrganization, createOrganizationOnceReleased, organizationSlug, takeAdminIn } from "../organizations";

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

/** A command that answers each create from a script: an error to throw, or the organization. */
function commandScripted(answers: Array<ConnectError | { id: string }>): {
  command: ConformanceClients["organizationCommand"];
  calls: () => number;
} {
  let calls = 0;
  return {
    calls: () => calls,
    command: {
      create: async () => {
        calls += 1;
        const answer = answers.shift();
        if (answer === undefined || answer instanceof ConnectError) {
          throw answer ?? new Error("script exhausted");
        }
        return { metadata: { id: answer.id } };
      },
    } as unknown as ConformanceClients["organizationCommand"],
  };
}

describe("createOrganizationOnceReleased", () => {
  const held = () => new ConnectError("held", Code.AlreadyExists);

  it("retries while the slug is held and answers the organization once it lands", async () => {
    const scripted = commandScripted([held(), { id: "org_new" }]);
    const created = await createOrganizationOnceReleased(scripted.command, "acme");
    expect(created.metadata?.id).toBe("org_new");
    expect(scripted.calls()).toBe(2);
  });

  it("fails at once on any answer but a held slug", async () => {
    const scripted = commandScripted([new ConnectError("denied", Code.PermissionDenied)]);
    await expect(createOrganizationOnceReleased(scripted.command, "acme")).rejects.toThrow("denied");
    expect(scripted.calls()).toBe(1);
  });

  it("fails with the held slug's refusal once its time is up", async () => {
    const scripted = commandScripted([held()]);
    await expect(createOrganizationOnceReleased(scripted.command, "acme", 0)).rejects.toThrow("held");
  });
});

describe("takeAdminIn", () => {
  function caller(id: string | undefined): { clients: ConformanceClients; granted: unknown[] } {
    const granted: unknown[] = [];
    const clients = {
      identityAccountQuery: { whoAmI: async () => ({ metadata: id === undefined ? undefined : { id } }) },
      grantCommand: { create: async (input: unknown) => (granted.push(input), {}) },
    } as unknown as ConformanceClients;
    return { clients, granted };
  }

  it("grants the caller admin on the child organization through the ordinary grant", async () => {
    const { clients, granted } = caller("ida_01founder");
    await takeAdminIn(clients, "org_01child");
    expect(granted).toEqual([
      expect.objectContaining({
        principal: expect.objectContaining({ kind: "identity_account", id: "ida_01founder" }),
        relation: "admin",
        resource: expect.objectContaining({ kind: "organization", id: "org_01child" }),
      }),
    ]);
  });

  it("refuses when whoAmI answers no account, granting nothing", async () => {
    const { clients, granted } = caller(undefined);
    await expect(takeAdminIn(clients, "org_01child")).rejects.toThrow(
      "whoAmI answered no account; the caller cannot take a role in the child organization",
    );
    expect(granted).toEqual([]);
  });
});
