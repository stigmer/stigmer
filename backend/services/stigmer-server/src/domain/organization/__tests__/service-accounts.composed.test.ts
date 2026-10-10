/**
 * Pins that an organization's service account never creates an
 * organization (controller.ts createOrganization,
 * RefuseServiceAccountCaller ahead of RefuseBoundCredential), through a
 * composed server with sign-in on and the built-in Authorizer, over the
 * wire: an ADMIN service account's key is refused a new top-level
 * organization and a child of its own organization alike, with
 * PERMISSION_DENIED and the refusal copy, and no organization is written.
 * The child arm matters because a bound credential may otherwise create a
 * child of the organization it is bound to, and a service account's key
 * is bound.
 */
import { fromBinary } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { serviceAccountRefusedMessage } from "../../../pipeline/steps/refuse-service-account.js";
import {
  bootSignInServer,
  createServiceAccount,
  foundOrganization,
  mintServiceAccountKey,
  provision,
  refusal,
} from "../../identityaccount/__tests__/service-account-support.js";
import type { SignInServer } from "../../identityaccount/__tests__/service-account-support.js";

const FOUNDER = "fake|org-founder";
const REFUSAL = serviceAccountRefusedMessage("create organizations");

let at: SignInServer;
let org: string;
let robotKey: string;

async function organizationSlugs(): Promise<string[]> {
  const rows = await at.server.store.listResources(
    ApiResourceKind.organization,
  );
  return rows
    .map((row) => fromBinary(OrganizationSchema, row).metadata?.slug ?? "")
    .sort();
}

function organizationInput(slug: string, parentOrg = "") {
  return {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: slug, slug, org: "" },
    spec: { description: slug, parentOrg },
  };
}

beforeAll(async () => {
  at = await bootSignInServer("organization-service-accounts");
  await provision(at, FOUNDER);
  org = await foundOrganization(at.as(FOUNDER), "robot-home");
  const robot = await createServiceAccount(
    at.as(FOUNDER),
    org,
    "org-robot",
    IamRole.admin,
  );
  robotKey = await mintServiceAccountKey(
    at.as(FOUNDER),
    robot.metadata?.id ?? "",
    "robot-key",
  );
});

afterAll(async () => {
  await at.shutdown();
});

describe("a service account's key creates no organization", () => {
  it("a top-level one is PERMISSION_DENIED with the copy", async () => {
    const error = await refusal(
      createClient(
        OrganizationCommandController,
        at.presenting(robotKey),
      ).create(organizationInput("robot-made")),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(REFUSAL);
    expect(await organizationSlugs()).toEqual(["robot-home"]);
  });

  it("a child of its own organization is PERMISSION_DENIED with the copy", async () => {
    const error = await refusal(
      createClient(
        OrganizationCommandController,
        at.presenting(robotKey),
      ).create(organizationInput("robot-child", org)),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toBe(REFUSAL);
    expect(await organizationSlugs()).toEqual(["robot-home"]);
  });

  it("while the admin who made it still creates a child there", async () => {
    await createClient(OrganizationCommandController, at.as(FOUNDER)).create(
      organizationInput("founder-child", org),
    );
    expect(await organizationSlugs()).toEqual(["founder-child", "robot-home"]);
  });
});
