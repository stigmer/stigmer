/**
 * Pins display-resolver.ts (20260913.01 slice 5, Q-S5-4): how an access
 * listing renders a principal that is an identity account — the batch
 * read through the identity-account PORT's `findByIds`, and the display
 * name precedence `first+last > first > last > metadata.name > email`.
 *
 * The `metadata.name` arm is this entry's one code divergence from the
 * Java PrincipalEnricher: the trusted-local operator account carries its
 * display name THERE and empty first/last names (identityaccount/
 * operator.ts), while the cloud names every account by its email — so on
 * the cloud the arm and the email arm answer the same string, and on a
 * laptop the Members row reads the name the operator configured instead
 * of an address.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { fakeIdentityAccountStore } from "../../identityaccount/__tests__/support.js";
import { newAccountDisplayResolver } from "../display-resolver.js";

function account(
  id: string,
  fields: {
    name?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    pictureUrl?: string;
    mode?: IdentityAccountProvisioningMode;
  },
) {
  return create(IdentityAccountSchema, {
    metadata: { id, name: fields.name ?? "" },
    spec: {
      email: fields.email ?? "",
      firstName: fields.firstName ?? "",
      lastName: fields.lastName ?? "",
      pictureUrl: fields.pictureUrl ?? "",
      provisioningMode: fields.mode ?? IdentityAccountProvisioningMode.direct,
    },
  });
}

async function resolveOne(row: ReturnType<typeof account>) {
  const store = fakeIdentityAccountStore();
  await store.save(row);
  const resolver = newAccountDisplayResolver(store);
  const views = await resolver.resolveIdentityAccounts([
    row.metadata?.id ?? "",
  ]);
  return views.get(row.metadata?.id ?? "");
}

describe("the display name precedence", () => {
  it("first + last beats everything", async () => {
    const view = await resolveOne(
      account("ida_1", {
        firstName: "Ada",
        lastName: "Lovelace",
        name: "ada@example.com",
        email: "ada@example.com",
      }),
    );
    expect(view?.name).toBe("Ada Lovelace");
  });

  it("first alone, then last alone", async () => {
    expect(
      (await resolveOne(account("ida_2", { firstName: "Ada", name: "x" })))
        ?.name,
    ).toBe("Ada");
    expect(
      (await resolveOne(account("ida_3", { lastName: "Lovelace", name: "x" })))
        ?.name,
    ).toBe("Lovelace");
  });

  it("metadata.name beats the email — the trusted-local operator's row (Q-S5-4)", async () => {
    const view = await resolveOne(
      account("ida_4", { name: "The Operator", email: "operator@example.com" }),
    );
    expect(view?.name).toBe("The Operator");
    expect(view?.email).toBe("operator@example.com");
  });

  it("an account the cloud named by its email renders exactly as the Java precedence did", async () => {
    const view = await resolveOne(
      account("ida_5", { name: "bob@example.com", email: "bob@example.com" }),
    );
    expect(view?.name).toBe("bob@example.com");
  });

  it("the email is the last resort", async () => {
    const view = await resolveOne(account("ida_6", { email: "c@example.com" }));
    expect(view?.name).toBe("c@example.com");
  });
});

describe("the view's other fields", () => {
  it("carries kind, id, avatar and the identity origin with the Stigmer label for direct and machine accounts", async () => {
    const view = await resolveOne(
      account("ida_7", {
        name: "Ada",
        pictureUrl: "https://img/ada",
        mode: IdentityAccountProvisioningMode.machine,
      }),
    );
    expect(view?.kind).toBe("identity_account");
    expect(view?.id).toBe("ida_7");
    expect(view?.avatar).toBe("https://img/ada");
    expect(view?.identityOrigin?.provisioningMode).toBe(
      IdentityAccountProvisioningMode.machine,
    );
    expect(view?.identityOrigin?.providerDisplayName).toBe("Stigmer");
  });

  it("a federated account carries its mode and no provider label", async () => {
    const view = await resolveOne(
      account("ida_8", {
        name: "Fed",
        mode: IdentityAccountProvisioningMode.federated,
      }),
    );
    expect(view?.identityOrigin?.providerDisplayName).toBe("");
  });

  it("answers only the ids that resolve — the caller falls back for the rest", async () => {
    const store = fakeIdentityAccountStore();
    await store.save(account("ida_9", { name: "Nine" }));
    const views = await newAccountDisplayResolver(
      store,
    ).resolveIdentityAccounts(["ida_9", "ida_missing"]);
    expect([...views.keys()]).toEqual(["ida_9"]);
  });
});
