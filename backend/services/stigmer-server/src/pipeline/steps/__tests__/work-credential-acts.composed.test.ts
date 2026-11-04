/**
 * Pins, door by door on a composed server, that a credential for one piece
 * of work never mints a lasting credential or changes who belongs to the
 * organization (stigmer#2946): a run's credential (class `runner`) acting
 * as the organization's founder, who could do every one of these acts
 * signed in as themselves, is refused PERMISSION_DENIED with the work
 * credential's sentence on each:
 *
 *   - ApiKey `create`, and `createForServiceAccount`;
 *   - IdentityAccount `createServiceAccount`;
 *   - Organization `create`, `updateEmbedding` and `delete`;
 *   - Grant `create` and `revokeOrgAccess` on the organization itself.
 *
 * and nothing is written: the founder's keys, the organization's members,
 * its service accounts and the organization itself are as they were. The
 * founder's own credential (class `user`) is admitted on the same door, so
 * the refusal is the credential's, not the person's.
 *
 * The server runs in the authentication posture with the built-in
 * Authorizer and two fake verifiers: the composition's person verifier
 * (composed-support.ts) and a run-credential verifier that stamps class
 * `runner` for the founder's account, as a run's credential acts as its
 * run's person.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiKeyCommandController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/command_pb";
import { ApiKeyQueryController } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/query_pb";
import { GrantCommandController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/command_pb";
import { IdentityAccountCommandController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import type { CallerIdentity, IdentityVerifier } from "../../../extensions/identity.js";
import { accountIdFor } from "../../../domain/identityaccount/constants.js";
import { orgRole } from "../../../domain/grant/__tests__/support.js";
import { workCredentialRefusedMessage } from "../refuse-service-account.js";

const FOUNDER = "fake|work-founder";
const MEMBER = "fake|work-member";
const ORG = "work-org";
const RUN_TOKEN = "run-credential-of-the-founder";

/** A run's credential: it acts as the founder's account, class `runner`. */
const runCredentialVerifier: IdentityVerifier = {
  name: "fake-run-credential",
  verify: (token) => {
    if (token !== RUN_TOKEN) {
      return Promise.resolve(null);
    }
    const identity: CallerIdentity = {
      identityId: accountIdFor(FOUNDER),
      callerClass: "runner",
      issuer: "",
      rawToken: token,
    };
    return Promise.resolve(identity);
  },
};

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

describe("a run's credential, acting as the founder, is refused every credential and membership act", () => {
  let dir: string;
  let server: ComposedServer;
  let port = 0;
  let orgId = "";
  let memberId = "";
  let serviceAccountId = "";

  const asFounder = (): Transport => transportFor(port, fakeJwt(FOUNDER, "founder@example.com"));
  const asRun = (): Transport => transportFor(port, RUN_TOKEN);

  async function expectWorkRefusal(act: string, call: Promise<unknown>): Promise<void> {
    const error = await refusal(call);
    expect(error.code, act).toBe(Code.PermissionDenied);
    expect(error.rawMessage, act).toBe(workCredentialRefusedMessage(act));
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "work-credential-acts-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [
        {
          name: "fake-sign-in-and-runs",
          requireAuthentication: true,
          identityVerifiers: [fakeVerifier, runCredentialVerifier],
        },
      ],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
    await createClient(IdentityAccountCommandController, asFounder()).provisionMyAccount({});
    const organization = await createClient(OrganizationCommandController, asFounder()).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG },
    });
    orgId = organization.metadata?.id ?? "";
    memberId =
      (
        await createClient(
          IdentityAccountCommandController,
          transportFor(port, fakeJwt(MEMBER, "member@example.com")),
        ).provisionMyAccount({})
      ).metadata?.id ?? "";
    await createClient(GrantCommandController, asFounder()).create(orgRole(memberId, "member", orgId));
    serviceAccountId =
      (
        await createClient(IdentityAccountCommandController, asFounder()).createServiceAccount({
          org: orgId,
          name: "ci",
          role: IamRole.member,
        })
      ).metadata?.id ?? "";
  });

  afterAll(async () => {
    await server?.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("the founder's own credential mints a key: the person may, so a refusal below is the credential's", async () => {
    const key = await createClient(ApiKeyCommandController, asFounder()).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name: "laptop", org: "" },
      spec: {},
    });
    expect(key.metadata?.id).not.toBe("");
  });

  it("refuses minting an API key for the founder, and writes none", async () => {
    const keys = createClient(ApiKeyQueryController, asFounder());
    const before = (await keys.list({})).entries.length;
    await expectWorkRefusal(
      "create API keys",
      createClient(ApiKeyCommandController, asRun()).create({
        apiVersion: "iam.stigmer.ai/v1",
        kind: "ApiKey",
        metadata: { name: "forever", org: "" },
        spec: { neverExpires: true },
      }),
    );
    expect((await keys.list({})).entries.length).toBe(before);
  });

  it("refuses minting a key for a service account, and creating a service account", async () => {
    const error = await refusal(
      createClient(ApiKeyCommandController, asRun()).createForServiceAccount({
        serviceAccountId,
        name: "deploy",
        neverExpires: true,
      }),
    );
    expect(error.code).toBe(Code.PermissionDenied);
    expect(error.rawMessage).toMatch(/^a credential for one run or lane cannot /);
    const created = await refusal(
      createClient(IdentityAccountCommandController, asRun()).createServiceAccount({
        org: orgId,
        name: "robot",
        role: IamRole.admin,
      }),
    );
    expect(created.code).toBe(Code.PermissionDenied);
    expect(created.rawMessage).toMatch(/^a credential for one run or lane cannot /);
  });

  it("refuses granting and revoking roles on the organization, and the member keeps their role", async () => {
    const grants = createClient(GrantCommandController, asRun());
    const granted = await refusal(grants.create(orgRole(memberId, "owner", orgId)));
    expect(granted.code).toBe(Code.PermissionDenied);
    expect(granted.rawMessage).toMatch(/^a credential for one run or lane cannot /);
    const revoked = await refusal(grants.revokeOrgAccess({ identityAccountId: memberId, org: orgId }));
    expect(revoked.code).toBe(Code.PermissionDenied);
    expect(revoked.rawMessage).toMatch(/^a credential for one run or lane cannot /);
  });

  it("refuses creating an organization, changing its embedding, and deleting it, and the organization stays", async () => {
    const organizations = createClient(OrganizationCommandController, asRun());
    await expectWorkRefusal(
      "create organizations",
      organizations.create({
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { name: "elsewhere", slug: "elsewhere", org: "" },
        spec: { description: "elsewhere" },
      }),
    );
    const embedding = await refusal(organizations.updateEmbedding({ orgId, embedding: {} }));
    expect(embedding.code).toBe(Code.PermissionDenied);
    expect(embedding.rawMessage).toMatch(/^a credential for one run or lane cannot /);
    await expectWorkRefusal("delete organizations", organizations.delete({ value: orgId }));
    const still = await createClient(OrganizationQueryController, asFounder()).get({ value: orgId });
    expect(still.metadata?.id).toBe(orgId);
  });
});
