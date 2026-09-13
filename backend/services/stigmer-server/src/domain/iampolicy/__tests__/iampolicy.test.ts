/**
 * Pins the IamPolicy domain through a composed OSS server in the
 * trusted-local posture — the open-source behaviours the conformance suite
 * cannot express cross-edition (T01_0_plan.md §3a, §5; T01_1_review.md
 * Q-OR-3, Q-OR-5, Q-OR-6a, Q-OR-7, Q-OR-8, Q-OR-9):
 *
 *   - creating an organization makes its creator the owner: the built-in
 *     role lifecycle's one write arm, read back through the row-driven
 *     access list and count with the operator's display fields;
 *   - a grant on anything but an organization is UNIMPLEMENTED with the
 *     edition named (the grant scope), and a role the organization does
 *     not admit is INVALID_ARGUMENT with the cloud's copy;
 *   - create is idempotent by derived id and stamps the proto's apiVersion;
 *     a role change is delete then create; revokeOrgAccess empties the
 *     account's rows; deleting the organization cleans its rows;
 *   - the three system RPCs are PERMISSION_DENIED over the wire and served
 *     on the in-process transport (the `internal` class);
 *   - checkMyPermission's three arms: an enterprise-tiered kind is false
 *     with the Authorizer never consulted (the settings navigation stays
 *     hidden); can_grant_access outside the scope is false; an
 *     organization permission is the composed Authorizer's answer; an
 *     unknown permission is INVALID_ARGUMENT;
 *   - the tuple-half queries are UNIMPLEMENTED with the edition named;
 *   - the byte-pinned NOT_FOUND copy on get; delete of an absent triple is
 *     the default instance.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../../pipeline/steps/defaults.js";
import {
  accountIdFor,
  localIdpIdFor,
} from "../../identityaccount/constants.js";
import {
  AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE,
  IAM_POLICY_API_VERSION,
  PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE,
  policyIdFor,
  policyNotFoundMessage,
  roleNotGrantableMessage,
  unknownPermissionMessage,
} from "../constants.js";
import { orgRole, triple } from "./support.js";

const OPERATOR_EMAIL = "operator@example.com";
const OPERATOR_NAME = "The Operator";

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

describe("iampolicy domain (composed server, trusted-local posture)", () => {
  let dir: string;
  let server: ComposedServer;
  let transport: Transport;
  let command: Client<typeof IamPolicyCommandController>;
  let query: Client<typeof IamPolicyQueryController>;
  let organizations: Client<typeof OrganizationCommandController>;
  /** The platform's own pipeline: the in-process transport's `internal` caller. */
  let platform: Client<typeof IamPolicyCommandController>;
  let platformAccounts: Client<typeof IdentityAccountCommandController>;
  /** The operator's account id — the trusted-local caller resolves to it. */
  const operatorId = accountIdFor(localIdpIdFor(OPERATOR_EMAIL));
  let seq = 0;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "iampolicy-domain-test-"));
    setOperatorIdentity(OPERATOR_EMAIL, OPERATOR_NAME);
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        STIGMER_OPERATOR_EMAIL: OPERATOR_EMAIL,
        STIGMER_OPERATOR_NAME: OPERATOR_NAME,
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    command = createClient(IamPolicyCommandController, transport);
    query = createClient(IamPolicyQueryController, transport);
    organizations = createClient(OrganizationCommandController, transport);
    platform = createClient(
      IamPolicyCommandController,
      server.inProcessTransport,
    );
    platformAccounts = createClient(
      IdentityAccountCommandController,
      server.inProcessTransport,
    );
  });

  afterAll(async () => {
    await server.shutdown();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  async function newOrganization(): Promise<string> {
    seq += 1;
    const slug = `roles-org-${seq}`;
    await organizations.create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: slug, slug, org: "" },
      spec: { description: "created by the iampolicy domain test" },
    });
    return slug;
  }

  /** A second account, created the way the platform creates one (in-process). */
  async function newAccount(): Promise<string> {
    seq += 1;
    const created = await platformAccounts.create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "IdentityAccount",
      metadata: { name: `person${seq}@example.com` },
      spec: {
        idpId: `auth0|person${seq}`,
        email: `person${seq}@example.com`,
        firstName: "Person",
        lastName: `${seq}`,
      },
    });
    return created.metadata?.id ?? "";
  }

  describe("the creator owns the organization (the built-in role lifecycle)", () => {
    it("lists the operator as owner with display fields, and counts one principal", async () => {
      const org = await newOrganization();

      const access = await query.listResourceAccessByPrincipal({
        resource: create(ApiResourceRefSchema, {
          kind: "organization",
          id: org,
        }),
      });
      const count = await query.getPrincipalsCount({
        orgId: org,
        principalKind: "identity_account",
      });

      expect(access.entries).toHaveLength(1);
      const [entry] = access.entries;
      expect(entry?.principal?.id).toBe(operatorId);
      expect(entry?.principal?.email).toBe(OPERATOR_EMAIL);
      expect(entry?.principal?.name).toBe(OPERATOR_NAME);
      expect(entry?.roles.map((grant) => grant.role?.code)).toEqual(["owner"]);
      expect(entry?.roles[0]?.isInherited).toBe(false);
      expect(count.count).toBe(1);
    });

    it("deleting the organization cleans its rows", async () => {
      const org = await newOrganization();
      await organizations.delete({ value: org });
      const count = await query.getPrincipalsCount({
        orgId: org,
        principalKind: "identity_account",
      });
      expect(count.count).toBe(0);
    });
  });

  describe("grants on the organization", () => {
    it("create is idempotent by derived id and stamps the proto's apiVersion", async () => {
      const org = await newOrganization();
      const bob = await newAccount();
      const spec = orgRole(bob, "member", org);

      const first = await command.create(spec);
      const second = await command.create(spec);

      expect(first.metadata?.id).toBe(policyIdFor(spec));
      expect(first.apiVersion).toBe(IAM_POLICY_API_VERSION);
      expect(second.metadata?.id).toBe(first.metadata?.id);
      expect(
        (
          await query.getPrincipalsCount({
            orgId: org,
            principalKind: "identity_account",
          })
        ).count,
      ).toBe(2);
    });

    it("a role change is delete then create, and the access list follows", async () => {
      const org = await newOrganization();
      const bob = await newAccount();
      await command.create(orgRole(bob, "member", org));

      const deleted = await command.delete(orgRole(bob, "member", org));
      await command.create(orgRole(bob, "admin", org));

      expect(deleted.metadata?.id).toBe(
        policyIdFor(orgRole(bob, "member", org)),
      );
      const roles = await query.getPrincipalResourceRoles({
        principal: create(ApiResourceRefSchema, {
          kind: "identity_account",
          id: bob,
        }),
        resource: create(ApiResourceRefSchema, {
          kind: "organization",
          id: org,
        }),
      });
      expect(roles.roles.map((role) => role.code)).toEqual(["admin"]);
    });

    it("every kind_meta role of the organization is grantable (Q-OR-4); a role it does not list is INVALID_ARGUMENT with the cloud's copy", async () => {
      const org = await newOrganization();
      const bob = await newAccount();
      for (const role of ["owner", "admin", "member", "viewer"]) {
        await command.create(orgRole(bob, role, org));
      }
      const error = await grpcError(() =>
        command.create(orgRole(bob, "editor", org)),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(
        roleNotGrantableMessage("editor", "organization", [
          "owner",
          "admin",
          "member",
          "viewer",
        ]),
      );
    });

    it("revokeOrgAccess empties the account's rows on that organization only", async () => {
      const org = await newOrganization();
      const other = await newOrganization();
      const bob = await newAccount();
      await command.create(orgRole(bob, "admin", org));
      await command.create(orgRole(bob, "viewer", org));
      await command.create(orgRole(bob, "member", other));

      await command.revokeOrgAccess({
        identityAccountId: bob,
        organizationId: org,
      });

      const onOrg = await query.getPrincipalResourceRoles({
        principal: create(ApiResourceRefSchema, {
          kind: "identity_account",
          id: bob,
        }),
        resource: create(ApiResourceRefSchema, {
          kind: "organization",
          id: org,
        }),
      });
      const onOther = await query.getPrincipalResourceRoles({
        principal: create(ApiResourceRefSchema, {
          kind: "identity_account",
          id: bob,
        }),
        resource: create(ApiResourceRefSchema, {
          kind: "organization",
          id: other,
        }),
      });
      expect(onOrg.roles).toEqual([]);
      expect(onOther.roles.map((role) => role.code)).toEqual(["member"]);
    });

    it("delete of an absent triple answers the default instance (Java's contract)", async () => {
      const org = await newOrganization();
      const deleted = await command.delete(
        orgRole("ida_nobody", "member", org),
      );
      expect(deleted.metadata?.id ?? "").toBe("");
    });

    it("get answers the row by id and the byte-pinned NOT_FOUND copy for an unknown id", async () => {
      const org = await newOrganization();
      const bob = await newAccount();
      const created = await command.create(orgRole(bob, "member", org));
      const got = await query.get({ value: created.metadata?.id ?? "" });
      expect(got.spec).toEqual(created.spec);
      const error = await grpcError(() =>
        query.get({ value: "iamp_00000000000000000000000000" }),
      );
      expect(error.code).toBe(Code.NotFound);
      expect(error.rawMessage).toBe(
        policyNotFoundMessage("iamp_00000000000000000000000000"),
      );
    });
  });

  describe("the grant scope: open source grants on organizations only (Q-OR-3)", () => {
    it("a grant on an agent is UNIMPLEMENTED with the edition named, never INVALID_ARGUMENT or INTERNAL", async () => {
      const bob = await newAccount();
      const error = await grpcError(() =>
        command.create(
          triple({ kind: "identity_account", id: bob }, "viewer", {
            kind: "agent",
            id: "agt_01hzzzzzzzzzzzzzzzzzzzzzzz",
          }),
        ),
      );
      expect(error.code).toBe(Code.Unimplemented);
      expect(error.rawMessage).toBe(PER_RESOURCE_GRANTS_UNIMPLEMENTED_MESSAGE);
    });
  });

  describe("the three system RPCs (Q-OR-7)", () => {
    it("are PERMISSION_DENIED for a wire user, with the annotation's copy", async () => {
      const org = await newOrganization();
      const structural = triple(
        { kind: "organization", id: org },
        "organization",
        { kind: "agent", id: "agt_01hzzzzzzzzzzzzzzzzzzzzzzz" },
      );
      const denied = await grpcError(() => command.bootstrapPolicy(structural));
      expect(denied.code).toBe(Code.PermissionDenied);
      expect(denied.rawMessage).toBe(
        "unauthorized to bootstrap policy - can_bootstrap_iam permission required",
      );
      expect(
        (
          await grpcError(() =>
            command.cleanupResourcePolicies(
              create(ApiResourceRefSchema, { kind: "organization", id: org }),
            ),
          )
        ).code,
      ).toBe(Code.PermissionDenied);
      expect(
        (
          await grpcError(() =>
            command.bootstrapRevokeOrgAccess({
              identityAccountId: operatorId,
              organizationId: org,
            }),
          )
        ).code,
      ).toBe(Code.PermissionDenied);
    });

    it("serve the platform's own pipeline on the in-process transport, structural relations included", async () => {
      const org = await newOrganization();
      const structural = triple(
        { kind: "organization", id: org },
        "organization",
        { kind: "agent", id: "agt_01hzzzzzzzzzzzzzzzzzzzzzzz" },
      );

      const seeded = await platform.bootstrapPolicy(structural);
      expect(seeded.metadata?.id).toBe(policyIdFor(structural));
      // A structural row never shows in the access list: only assignable roles do.
      const access = await query.listResourceAccessByPrincipal({
        resource: create(ApiResourceRefSchema, {
          kind: "agent",
          id: "agt_01hzzzzzzzzzzzzzzzzzzzzzzz",
        }),
      });
      expect(access.entries).toEqual([]);

      await platform.cleanupResourcePolicies(
        create(ApiResourceRefSchema, {
          kind: "agent",
          id: "agt_01hzzzzzzzzzzzzzzzzzzzzzzz",
        }),
      );
      const error = await grpcError(() =>
        query.get({ value: policyIdFor(structural) }),
      );
      expect(error.code).toBe(Code.NotFound);
    });
  });

  describe("checkMyPermission has one definition (Q-OR-8)", () => {
    it("an enterprise-tiered kind answers false — the operator-only settings navigation stays hidden on open source", async () => {
      const result = await query.checkMyPermission({
        resource: create(ApiResourceRefSchema, {
          kind: "platform",
          id: "stigmer",
        }),
        relation: "can_manage_model_pricing",
      });
      expect(result.isAuthorized).toBe(false);
    });

    it("can_grant_access outside the grant scope answers false; on an organization it is the Authorizer's answer", async () => {
      const org = await newOrganization();
      const onAgent = await query.checkMyPermission({
        resource: create(ApiResourceRefSchema, {
          kind: "agent",
          id: "agt_01hzzzzzzzzzzzzzzzzzzzzzzz",
        }),
        relation: "can_grant_access",
      });
      const onOrg = await query.checkMyPermission({
        resource: create(ApiResourceRefSchema, {
          kind: "organization",
          id: org,
        }),
        relation: "can_grant_access",
      });
      const viewAgent = await query.checkMyPermission({
        resource: create(ApiResourceRefSchema, {
          kind: "agent",
          id: "agt_01hzzzzzzzzzzzzzzzzzzzzzzz",
        }),
        relation: "can_view_access",
      });
      expect(onAgent.isAuthorized).toBe(false);
      // The permissive single-team Authorizer allows everything it is asked.
      expect(onOrg.isAuthorized).toBe(true);
      expect(viewAgent.isAuthorized).toBe(true);
    });

    it("an unknown permission is INVALID_ARGUMENT, quoted", async () => {
      const error = await grpcError(() =>
        query.checkMyPermission({
          resource: create(ApiResourceRefSchema, {
            kind: "organization",
            id: "acme",
          }),
          relation: "can_fly",
        }),
      );
      expect(error.code).toBe(Code.InvalidArgument);
      expect(error.rawMessage).toBe(unknownPermissionMessage("can_fly"));
    });
  });

  describe("the tuple-half queries without a composed engine", () => {
    it("answer UNIMPLEMENTED with the edition named — never INTERNAL", async () => {
      const principal = create(ApiResourceRefSchema, {
        kind: "identity_account",
        id: operatorId,
      });
      const resource = create(ApiResourceRefSchema, {
        kind: "organization",
        id: "acme",
      });
      for (const call of [
        () =>
          query.checkAuthorization({
            policy: triple(
              { kind: "identity_account", id: operatorId },
              "admin",
              { kind: "organization", id: "acme" },
            ),
          }),
        () =>
          query.listAuthorizedResourceIds({
            principal,
            resourceKind: "organization",
            relation: "can_view",
          }),
        () =>
          query.listAuthorizedPrincipalIds({
            resource,
            principalKind: "identity_account",
            relation: "can_view",
          }),
        () =>
          query.checkMyPermission({
            resource,
            relation: "can_view",
            contextualPolicies: [orgRole(operatorId, "viewer", "acme")],
          }),
      ]) {
        const error = await grpcError(call);
        expect(error.code).toBe(Code.Unimplemented);
        expect(error.rawMessage).toContain(
          AUTHORIZATION_QUERIES_UNIMPLEMENTED_MESSAGE,
        );
      }
    });
  });
});
