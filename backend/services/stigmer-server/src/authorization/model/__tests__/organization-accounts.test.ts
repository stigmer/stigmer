/**
 * Pins the derived `identity_account#organization` edge
 * (../organization-accounts.ts): the link from an account to the
 * organization that administers it, which open source reads from the row
 * at check time and which feeds `admin from organization` on the account
 * and, through the key's owner, on its keys. A service-account row and an
 * app user's row (a person the organization's product signs in, #3104)
 * with an organization derive it, exactly one tuple naming
 * `metadata.org`; a person's own row, a federated row that carries
 * `metadata.org`, either administered mode with no organization, and a
 * row of another kind derive nothing, so no organization's admins ever
 * reach a person's own account or keys.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { administeringOrganization } from "../organization-accounts.js";
import type { DerivedRelation } from "../rewrite.js";

const OBJECT = { type: "identity_account", id: "ida_ci" };
const NO_LOADER = {} as Parameters<DerivedRelation>[2];

const LINKED = [
  {
    object: OBJECT,
    relation: "organization",
    subject: {
      form: "object",
      object: { type: "organization", id: "org_acme" },
    },
  },
];

function accountRow(mode: IdentityAccountProvisioningMode, org: string) {
  return create(IdentityAccountSchema, {
    metadata: { id: OBJECT.id, name: "ci-deploy", org },
    spec: { idpId: "stgm_sa|org_acme|0123", provisioningMode: mode },
  });
}

describe("identity_account#organization", () => {
  it("a service-account row answers one tuple naming its organization", async () => {
    expect(
      await administeringOrganization(
        OBJECT,
        accountRow(IdentityAccountProvisioningMode.service_account, "org_acme"),
        NO_LOADER,
      ),
    ).toEqual(LINKED);
  });

  it("an app user's row answers one tuple naming its organization", async () => {
    expect(
      await administeringOrganization(
        OBJECT,
        accountRow(IdentityAccountProvisioningMode.app_user, "org_acme"),
        NO_LOADER,
      ),
    ).toEqual(LINKED);
  });

  it("a person's own row derives nothing, though it names an organization", async () => {
    for (const mode of [
      IdentityAccountProvisioningMode.direct,
      IdentityAccountProvisioningMode.identity_account_provisioning_mode_unspecified,
    ]) {
      for (const org of ["", "org_acme"]) {
        expect(
          await administeringOrganization(
            OBJECT,
            accountRow(mode, org),
            NO_LOADER,
          ),
        ).toEqual([]);
      }
    }
  });

  it("a federated row that names an organization derives nothing", async () => {
    expect(
      await administeringOrganization(
        OBJECT,
        accountRow(IdentityAccountProvisioningMode.federated, "org_acme"),
        NO_LOADER,
      ),
    ).toEqual([]);
  });

  it("a row of either administered mode with no organization derives nothing", async () => {
    for (const mode of [
      IdentityAccountProvisioningMode.service_account,
      IdentityAccountProvisioningMode.app_user,
    ]) {
      expect(
        await administeringOrganization(
          OBJECT,
          accountRow(mode, ""),
          NO_LOADER,
        ),
      ).toEqual([]);
    }
  });

  it("a row of another kind derives nothing", async () => {
    expect(
      await administeringOrganization(OBJECT, create(AgentSchema), NO_LOADER),
    ).toEqual([]);
  });
});
