/**
 * Pins stigmer/stigmer#1169 end to end: an API key created while the
 * server trusted every caller is refused BY NAME once sign-in is turned
 * on, and a key created after signing in works.
 *
 * Two boots over ONE data directory, the upgrade a self-hoster makes:
 *   1. Trusted-local, with an operator email configured: the laptop
 *      creates an Organization and an API key over the wire. The key's
 *      creator stamp is the operator's email, the one principal that
 *      posture has.
 *   2. The same directory boots with the require-authentication posture
 *      (a unit that vouches for unsigned JWT-shaped tokens and declares
 *      the posture, composed-support.ts; the open-source OIDC self-host's
 *      shape). The old key is refused UNAUTHENTICATED with the sentence
 *      and the API_KEY_CREATED_BEFORE_SIGN_IN reason, not admitted as a
 *      bare email that every later check would deny as "Permission
 *      denied". The operator then signs in, which is a different account,
 *      derived from the issuer's subject; creates a key; and that key
 *      authenticates as the account that created it.
 *
 * The verifier's per-arm proofs (the "system" stamp, the email-shaped
 * issuer subject, the read count) are domain/apikey/__tests__/verifier.test.ts;
 * this file is the upgrade's definition of done at the wire.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiKeyCommandController } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/command_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import {
  API_KEY_CREATED_BEFORE_SIGN_IN,
  API_KEY_CREATED_BEFORE_SIGN_IN_MESSAGE,
} from "../../domain/apikey/verifier.js";
import { accountIdFor } from "../../domain/identityaccount/constants.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../pipeline/steps/defaults.js";
import type { ServerExtension } from "../registry.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "./composed-support.js";

const OPERATOR_EMAIL = "operator@example.com";
const OPERATOR_SUBJECT = "fake|operator";
const ORG = "laptop-org";

describe("an API key created before sign-in was turned on (composed server, two boots over one directory; stigmer/stigmer#1169)", () => {
  let dir: string;
  let server: ComposedServer;
  let port: number;
  let preSignInKey = "";

  const signInOn: ServerExtension = {
    name: "fake-oidc-only",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
  };

  async function boot(extensions: ServerExtension[]): Promise<void> {
    server = await composeServer({
      config: loadConfig({
        ...baseConfig(dir),
        STIGMER_OPERATOR_EMAIL: OPERATOR_EMAIL,
        STIGMER_OPERATOR_NAME: "The Operator",
      }),
      logger: silentLogger,
      extensions,
      portOverride: 0,
      host: "127.0.0.1",
    });
    port = await server.start();
  }

  function apiKeyInput(name: string) {
    return {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: { name, org: ORG },
      spec: { neverExpires: true },
    };
  }

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "apikey-before-sign-in-"));
    setOperatorIdentity(OPERATOR_EMAIL, "The Operator");
    await boot([]);
  });

  afterAll(async () => {
    await server.shutdown();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  it("boot 1: the laptop creates an Organization and a key, stamped with the operator's email", async () => {
    await createClient(
      OrganizationCommandController,
      transportFor(port),
    ).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG },
    });
    const created = await createClient(
      ApiKeyCommandController,
      transportFor(port),
    ).create(apiKeyInput("runner"));

    preSignInKey = created.spec?.keyHash ?? "";
    expect(preSignInKey).toMatch(/^stk_/);
    expect(created.status?.audit?.specAudit?.createdBy?.id).toBe(
      OPERATOR_EMAIL,
    );
  });

  it("boot 2: with sign-in on, that key is refused by name", async () => {
    await server.shutdown();
    await boot([signInOn]);

    const refusal = await createClient(
      IdentityAccountQueryController,
      transportFor(port, preSignInKey),
    )
      .whoAmI({})
      .then(
        () => undefined,
        (error: unknown) => ConnectError.from(error),
      );

    expect(refusal?.code).toBe(Code.Unauthenticated);
    expect(refusal?.rawMessage).toBe(API_KEY_CREATED_BEFORE_SIGN_IN_MESSAGE);
    const [info] = refusal?.findDetails(ErrorInfoSchema) ?? [];
    expect(info?.reason).toBe(API_KEY_CREATED_BEFORE_SIGN_IN);
    expect(info?.domain).toBe("stigmer.ai");
  });

  it("boot 2: a key created after signing in authenticates as the account that created it", async () => {
    const operator = fakeJwt(OPERATOR_SUBJECT, OPERATOR_EMAIL);
    await createClient(
      IdentityAccountCommandController,
      transportFor(port, operator),
    ).provisionMyAccount({});
    const created = await createClient(
      ApiKeyCommandController,
      transportFor(port, operator),
    ).create(apiKeyInput("runner-after-sign-in"));

    const me = await createClient(
      IdentityAccountQueryController,
      transportFor(port, created.spec?.keyHash ?? ""),
    ).whoAmI({});

    expect(me.metadata?.id).toBe(accountIdFor(OPERATOR_SUBJECT));
  });
});
