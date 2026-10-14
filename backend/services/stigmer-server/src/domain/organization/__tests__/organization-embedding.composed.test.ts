/**
 * Pins an organization's embedding settings (../embedding.ts) over a
 * composed server with sign-in on and the built-in Authorizer:
 *
 *   - updateEmbedding replaces the whole message and records who attached
 *     each vault it introduces; a later write that keeps a vault keeps its
 *     attacher, and one that removes it drops the entry;
 *   - its vaults pass the rule every surface that names vaults passes: a
 *     My vault is refused, and so is a vault of another organization;
 *   - its sign-in role is one an organization grants: owner and a role
 *     without account creation are the contract's refusals, and a role no
 *     organization grants is the door's;
 *   - only the organization's admins change it;
 *   - update keeps the stored settings whatever it carries, and create
 *     starts an organization with none.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import {
  OrganizationEmbeddingSchema,
  OrganizationSpecSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/spec_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import {
  bootSignInServer,
  foundOrganization,
  provision,
  refusal,
} from "../../identityaccount/__tests__/service-account-support.js";
import type { SignInServer } from "../../identityaccount/__tests__/service-account-support.js";
import { signInRoleNotGrantableMessage } from "../../token/constants.js";
import { myVaultRefusal } from "../../vault/attachments.js";
import { seedMyVaultRow, seedSharedVault } from "../../vault/__tests__/support.js";

const FOUNDER = "fake|embedding-founder";
const MEMBER = "fake|embedding-member";

let at: SignInServer;
let acme = "";
let globex = "";
let founderId = "";
/** Who the attachment rule records for the founder: the identity the test verifier stamps. */
const FOUNDER_ATTACHER = FOUNDER;
let keysVault = "";
let otherVault = "";
let foreignVault = "";

const vault = (org: string, id: string) => ({ kind: ApiResourceKind.vault, org, id });

beforeAll(async () => {
  at = await bootSignInServer("organization-embedding");
  founderId = await provision(at, FOUNDER);
  acme = await foundOrganization(at.as(FOUNDER), "embedding-acme");
  globex = await foundOrganization(at.as(FOUNDER), "embedding-globex");
  await provision(at, MEMBER);
  keysVault = (await seedSharedVault(at.server.store, acme, "product-keys")).metadata?.id ?? "";
  otherVault = (await seedSharedVault(at.server.store, acme, "more-keys")).metadata?.id ?? "";
  foreignVault = (await seedSharedVault(at.server.store, globex, "globex-keys")).metadata?.id ?? "";
});

afterAll(async () => {
  await at?.shutdown();
});

const asFounder = () => createClient(OrganizationCommandController, at.as(FOUNDER));

describe("updateEmbedding", () => {
  it("replaces the whole message and records who attached each vault", async () => {
    const saved = await asFounder().updateEmbedding({
      orgId: acme,
      embedding: {
        allowedOrigins: ["https://app.example"],
        createAccountsOnSignIn: true,
        signInRole: IamRole.member,
        vaults: [vault(acme, keysVault)],
      },
    });
    expect(saved.metadata?.id).toBe(acme);
    expect(saved.spec?.embedding).toMatchObject({
      allowedOrigins: ["https://app.example"],
      createAccountsOnSignIn: true,
      signInRole: IamRole.member,
    });
    expect(saved.status?.embeddingVaultAttachers).toEqual({ [keysVault]: FOUNDER_ATTACHER });

    const replaced = await asFounder().updateEmbedding({
      orgId: acme,
      embedding: { vaults: [vault(acme, otherVault)] },
    });
    expect(replaced.spec?.embedding?.allowedOrigins).toEqual([]);
    expect(replaced.spec?.embedding?.createAccountsOnSignIn).toBe(false);
    expect(replaced.status?.embeddingVaultAttachers).toEqual({ [otherVault]: FOUNDER_ATTACHER });
  });

  it("refuses a My vault and a vault of another organization", async () => {
    const mine = await seedMyVaultRow(at.server.store, acme, founderId);
    const myVault = await refusal(
      asFounder().updateEmbedding({
        orgId: acme,
        embedding: { vaults: [vault(acme, mine.metadata?.id ?? "")] },
      }),
    );
    expect([myVault.code, myVault.rawMessage]).toEqual([
      Code.FailedPrecondition,
      myVaultRefusal("an organization's embedding settings"),
    ]);

    const foreign = await refusal(
      asFounder().updateEmbedding({
        orgId: acme,
        embedding: { vaults: [vault(globex, foreignVault)] },
      }),
    );
    expect(foreign.code).not.toBe(Code.Unknown);
    expect(foreign.code).not.toBe(Code.Internal);
  });

  it("refuses owner, a role without account creation, and a role no organization grants", async () => {
    for (const embedding of [
      { createAccountsOnSignIn: true, signInRole: IamRole.owner },
      { createAccountsOnSignIn: false, signInRole: IamRole.member },
    ]) {
      const refused = await refusal(asFounder().updateEmbedding({ orgId: acme, embedding }));
      expect(refused.code, JSON.stringify(embedding)).toBe(Code.InvalidArgument);
    }
    const ungrantable = await refusal(
      asFounder().updateEmbedding({
        orgId: acme,
        embedding: { createAccountsOnSignIn: true, signInRole: IamRole.participant },
      }),
    );
    expect([ungrantable.code, ungrantable.rawMessage]).toEqual([
      Code.InvalidArgument,
      signInRoleNotGrantableMessage(IamRole.participant),
    ]);
  });

  it("is refused to a member of the organization", async () => {
    const refused = await refusal(
      createClient(OrganizationCommandController, at.as(MEMBER)).updateEmbedding({
        orgId: acme,
        embedding: { createAccountsOnSignIn: true },
      }),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
  });
});

describe("the other organization writes", () => {
  it("update keeps the stored settings and their attachers, whatever it carries", async () => {
    await asFounder().updateEmbedding({
      orgId: acme,
      embedding: { createAccountsOnSignIn: true, vaults: [vault(acme, keysVault)] },
    });
    const current = await createClient(OrganizationQueryController, at.as(FOUNDER)).get({ value: acme });
    const resource = clone(OrganizationSchema, current);
    resource.spec ??= create(OrganizationSpecSchema);
    resource.spec.description = "changed";
    resource.spec.embedding = create(OrganizationEmbeddingSchema, { createAccountsOnSignIn: false });
    const updated = await asFounder().update({ resource, updateMask: { paths: ["spec"] } });
    expect(updated.spec?.description).toBe("changed");
    expect(updated.spec?.embedding?.createAccountsOnSignIn).toBe(true);
    expect(updated.status?.embeddingVaultAttachers).toEqual({ [keysVault]: FOUNDER_ATTACHER });
  });

  it("create starts an organization with no embedding settings", async () => {
    const created = await asFounder().create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "embedding-fresh", slug: "embedding-fresh" },
      spec: { embedding: { createAccountsOnSignIn: true, signInRole: IamRole.member } },
    });
    expect(created.spec?.embedding).toBeUndefined();
  });
});
