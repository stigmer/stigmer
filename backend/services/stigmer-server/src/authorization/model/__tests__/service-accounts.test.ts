/**
 * Pins the derived `identity_account#organization` edge
 * (../service-accounts.ts): a service account's link to its organization,
 * which open source reads from the row at check time and which feeds
 * `admin from organization` on the account and, through the key's owner,
 * on its keys. Only a service-account row with an organization derives
 * it, exactly one tuple naming `metadata.org`; a person's row, a platform
 * client's end user that carries `metadata.org`, a service-account row
 * with no organization, and a row of another kind derive nothing, so no
 * organization's admins ever reach a person's account or keys.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import type { DerivedRelation } from "../rewrite.js";
import { serviceAccountOrganization } from "../service-accounts.js";

const OBJECT = { type: "identity_account", id: "ida_ci" };
const NO_LOADER = {} as Parameters<DerivedRelation>[2];

function accountRow(mode: IdentityAccountProvisioningMode, org: string) {
  return create(IdentityAccountSchema, {
    metadata: { id: OBJECT.id, name: "ci-deploy", org },
    spec: { idpId: "stgm_sa|org_acme|0123", provisioningMode: mode },
  });
}

describe("identity_account#organization", () => {
  it("a service-account row answers one tuple naming its organization", async () => {
    expect(
      await serviceAccountOrganization(
        OBJECT,
        accountRow(IdentityAccountProvisioningMode.service_account, "org_acme"),
        NO_LOADER,
      ),
    ).toEqual([
      {
        object: OBJECT,
        relation: "organization",
        subject: {
          form: "object",
          object: { type: "organization", id: "org_acme" },
        },
      },
    ]);
  });

  it("a person's row derives nothing", async () => {
    for (const mode of [
      IdentityAccountProvisioningMode.direct,
      IdentityAccountProvisioningMode.identity_account_provisioning_mode_unspecified,
    ]) {
      expect(
        await serviceAccountOrganization(
          OBJECT,
          accountRow(mode, ""),
          NO_LOADER,
        ),
      ).toEqual([]);
    }
  });

  it("a platform client's end user derives nothing, though its row names an organization", async () => {
    expect(
      await serviceAccountOrganization(
        OBJECT,
        accountRow(IdentityAccountProvisioningMode.platform_client, "org_acme"),
        NO_LOADER,
      ),
    ).toEqual([]);
  });

  it("a federated or machine row that names an organization derives nothing", async () => {
    for (const mode of [
      IdentityAccountProvisioningMode.federated,
      IdentityAccountProvisioningMode.machine,
    ]) {
      expect(
        await serviceAccountOrganization(
          OBJECT,
          accountRow(mode, "org_acme"),
          NO_LOADER,
        ),
      ).toEqual([]);
    }
  });

  it("a service-account row with no organization derives nothing", async () => {
    expect(
      await serviceAccountOrganization(
        OBJECT,
        accountRow(IdentityAccountProvisioningMode.service_account, ""),
        NO_LOADER,
      ),
    ).toEqual([]);
  });

  it("a row of another kind derives nothing", async () => {
    expect(
      await serviceAccountOrganization(OBJECT, create(AgentSchema), NO_LOADER),
    ).toEqual([]);
  });
});
