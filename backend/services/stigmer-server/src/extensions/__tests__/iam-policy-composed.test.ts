/**
 * Pins the built-in authorization POSTURE end to end (20260913.01,
 * T01_1_review.md Q-OR-6): `builtInAuthorization = extensions.authorizer
 * === undefined`, named once in compose.ts. The open-source membership
 * rules and the built-in role lifecycle exist to feed the built-in
 * authorizer; a composition that registers its OWN Authorizer has its own
 * onboarding (the cloud's invitations, its personal-organization step, its
 * tuple driver) and must get neither of them — otherwise every cloud
 * organization create would write a second, unasked-for `owner` row and
 * every first sign-in would hand out roles the cloud never granted.
 *
 * This is the NEGATIVE proof, over a composed server in the cloud's own
 * shape (a declared require-authentication posture, the unit's verifier,
 * the unit's Authorizer, no lifecycle driver): an organization created by a
 * signed-in subject leaves NO policy row; the creator's first provisioning
 * writes none (no ownership heal); a second subject's first provisioning
 * writes none (no membership). The POSITIVE proof — the empty composition
 * installs both — is domain/iampolicy/__tests__/iampolicy.test.ts.
 *
 * Green before the domain lands and green after by design: its value is at
 * the slice that wires compose.ts, where an unconditional install turns it
 * red. Every negative assertion sits beside a positive one (the create
 * succeeded, the accounts exist, the unit's Authorizer WAS consulted) so
 * the file cannot pass vacuously.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fromBinary } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import type { Authorizer } from "../authorizer.js";
import type { ServerExtension } from "../registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "./composed-support.js";

const CREATOR = "fake|creator";
const NEWCOMER = "fake|newcomer";

describe("iam-policy posture (composed server, a unit's own Authorizer: nothing built in is installed)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let authorizerCalls = 0;

  /** Allows everything and counts — the proof the posture switch saw a registered Authorizer. */
  const permissiveAuthorizer: Authorizer = {
    authorize: () => {
      authorizerCalls += 1;
      return Promise.resolve({ kind: "allow" });
    },
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "iam-policy-composed-"));
    const unit: ServerExtension = {
      name: "fake-iam",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
      authorizer: permissiveAuthorizer,
    };
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  /** The policy rows the composed server's store holds — the one observation the posture is about. */
  async function policyRows(): Promise<ReadonlyArray<string>> {
    const rows = await server.store.listResources(ApiResourceKind.iam_policy);
    return rows.map(
      (row) => fromBinary(IamPolicySchema, row).metadata?.id ?? "",
    );
  }

  it("an organization created by a signed-in subject leaves no policy row — the built-in role lifecycle is not installed", async () => {
    const asCreator = transportFor(
      port,
      fakeJwt(CREATOR, "creator@example.com"),
    );
    const created = await createClient(
      OrganizationCommandController,
      asCreator,
    ).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "posture-org", slug: "posture-org", org: "" },
      spec: { description: "created under a unit's own Authorizer" },
    });
    // Organization create is `is_skip_authorization` by annotation (anyone
    // may found one), so the proof that the posture switch saw a registered
    // Authorizer is the read that follows: `get` is annotated can_view.
    await createClient(OrganizationQueryController, asCreator).get({
      value: "posture-org",
    });

    expect(created.metadata?.id, "the create itself succeeded").toBe(
      "posture-org",
    );
    expect(
      authorizerCalls,
      "the unit's Authorizer was consulted",
    ).toBeGreaterThan(0);
    expect(await policyRows()).toEqual([]);
  });

  it("the creator's first provisioning writes no row — the membership rules' ownership heal is not installed", async () => {
    const account = await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(CREATOR, "creator@example.com")),
    ).provisionMyAccount({});

    expect(account.metadata?.id).toBe(accountIdFor(CREATOR));
    expect(await policyRows()).toEqual([]);
  });

  it("a newcomer's first provisioning writes no row — no membership is handed out", async () => {
    const account = await createClient(
      IdentityAccountCommandController,
      transportFor(port, fakeJwt(NEWCOMER, "newcomer@example.com")),
    ).provisionMyAccount({});

    expect(account.metadata?.id).toBe(accountIdFor(NEWCOMER));
    expect(await policyRows()).toEqual([]);
  });
});
