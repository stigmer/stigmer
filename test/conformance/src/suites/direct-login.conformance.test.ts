// Direct-login conformance (stigmer-cloud#604 — the X1 checklist's S1 lane).
// Pins what the serving edge does with the raw access token a console,
// desktop, CLI or MCP client obtains from the PLATFORM'S OWN identity tenant
// — the credential every first-party login presents, and the one lane five
// green readouts never drove because the cloud target authenticates with
// PlatformClient-minted tokens (the entry's origin story):
//   - a token for a subject with NO account is ADMITTED, idp-shaped: whoAmI
//     answers NOT_FOUND with the byte-pinned copy (the console's signal to
//     call provisionMyAccount), never UNAUTHENTICATED — the Java mapper's
//     raw-subject fallback, the composition's direct-idp miss arm;
//   - a FIRST login end to end: provisionMyAccount creates a `direct`
//     account for that subject from the tenant's /userinfo, the personal
//     org it creates is OWNED BY the new account (findMyOrganizations as the
//     same token lists it — the owner tuple names the ida_, not the raw
//     subject, the defect entry 20260905.01 fixed), and the next whoAmI
//     resolves the token to the account;
//   - the tenant's MCP audience (the hosted MCP server forwards tokens
//     minted for its own resource) is accepted beside the API audience;
//   - a token for a FOREIGN audience, an EXPIRED token, and a token signed
//     by a STRANGER under the tenant's issuer are refused UNAUTHENTICATED
//     with the Java classifyAuthError copy, byte-pinned on both editions
//     (GrpcSecurityConfigBase.classifyAuthError; the composition's
//     iam/direct/verifier.ts constants are the same bytes by contract).
// The suite forges nothing about the tenant: tokens come from the TARGET's
// own mint (directLoginTenant — the readout substrate hands the harness the
// mock tenant's key); only the stranger arm signs with a throwaway key,
// under the same claim shape, so it fails for the signature alone.
//
// Where the target has no tenant to mint for — the local OSS targets by
// design (capability false), the hermetic cloud launcher (test security
// mode, no edge) and every deployed endpoint (a real tenant's key is never
// conformance's) — the arms skip VISIBLY with the target's reason, never
// asserting admission on an unobservable edge.
import { generateKeyPairSync } from "node:crypto";

import { Code } from "@connectrpc/connect";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import {
  directLoginClaims,
  signDirectLoginToken,
} from "../harness/direct-login-tenant";
import {
  createTarget,
  type DirectLoginTenant,
  type TargetProfile,
} from "../targets";

// Java classifyAuthError arms — byte-pinned cross-edition copy.
const TOKEN_EXPIRED_MESSAGE = "token has expired";
const TOKEN_AUDIENCE_MESSAGE =
  "token audience does not match the expected audience";
const TOKEN_SIGNATURE_MESSAGE = "token signature verification failed";
// iam/account/handlers.ts whoAmI — the Java IdentityAccountWhoAmIHandler copy.
const ACCOUNT_NOT_FOUND_MESSAGE =
  "Identity account not found for the authenticated user";

let target: TargetProfile;
const directLoginEnabled = createTarget().capabilities.directLogin;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
});

afterAll(async () => {
  await target?.teardown();
});

// The tenant, or a visible skip carrying the target's own reason.
function tenantOrSkip(ctx: {
  skip: (note?: string) => never;
}): DirectLoginTenant {
  const bypass = target.edgeAuthenticationBypass?.();
  if (bypass !== undefined) {
    ctx.skip(bypass);
  }
  const tenant = target.directLoginTenant?.();
  if (tenant === undefined) {
    ctx.skip(
      target.directLoginUnavailable?.() ??
        "the target exposes no direct-login tenant",
    );
  }
  return tenant;
}

// Auth0's subject shape for a database user; unique per test so no run ever
// meets a row a previous run left behind.
function freshSubject(): string {
  return `auth0|conformance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

describe.skipIf(!directLoginEnabled)(
  "direct login: the platform tenant's tokens",
  () => {
    it("admits a subject with no account idp-shaped — whoAmI answers NOT_FOUND with the byte-pinned copy, never UNAUTHENTICATED", async (ctx) => {
      const tenant = tenantOrSkip(ctx);
      const presenting = target.clientsPresenting(
        tenant.mint({ subject: freshSubject() }),
      );
      const error = await expectGrpcCode(
        () => presenting.identityAccountQuery.whoAmI({}),
        Code.NotFound,
        "whoAmI for a valid tenant token whose subject has no account",
      );
      expect(
        error.rawMessage,
        "the console branches on this copy to start provisioning",
      ).toBe(ACCOUNT_NOT_FOUND_MESSAGE);
    });

    it("provisions a first login end to end: a direct account from /userinfo, a personal org OWNED BY the new account, and whoAmI resolving to it", async (ctx) => {
      const tenant = tenantOrSkip(ctx);
      const subject = freshSubject();
      const asUser = target.clientsPresenting(tenant.mint({ subject }));

      const account = await asUser.identityAccountCommand.provisionMyAccount(
        {},
      );
      const accountId = account.metadata?.id ?? "";
      try {
        expect(
          accountId,
          "provisionMyAccount answers the created account",
        ).not.toBe("");
        expect(
          account.spec?.idpId,
          "the account is keyed by the token's subject",
        ).toBe(subject);
        expect(
          account.spec?.provisioningMode,
          "a platform-tenant login is a DIRECT account (never federated, never platform_client)",
        ).toBe(IdentityAccountProvisioningMode.direct);
        expect(
          account.spec?.email,
          "the profile came from the tenant's /userinfo — an access token carries none",
        ).not.toBe("");

        const resolved = await asUser.identityAccountQuery.whoAmI({});
        expect(
          resolved.metadata?.id,
          "after provisioning the SAME token resolves to the account at position 1 — no second row",
        ).toBe(accountId);

        const mine = await asUser.organizationQuery.findMyOrganizations({});
        expect(
          mine.entries.some((org) => org.spec?.isPersonal === true),
          "the personal org is visible to the account — its owner tuple names the ida_, not the raw subject",
        ).toBe(true);
      } finally {
        // Leave nothing behind: the personal org (owned by the account) and the
        // account (self-owned). Best-effort — a failed cleanup must not mask
        // the assertion that failed.
        try {
          const mine = await asUser.organizationQuery.findMyOrganizations({});
          for (const org of mine.entries) {
            if (
              org.spec?.isPersonal === true &&
              org.metadata?.id !== undefined
            ) {
              await asUser.organizationCommand.delete({
                value: org.metadata.id,
              });
            }
          }
          if (accountId !== "") {
            await asUser.identityAccountCommand.delete({ value: accountId });
          }
        } catch {
          // Residue is reported by the substrate's count instruments, not here.
        }
      }
    });

    it("accepts the tenant's MCP audience beside the API audience (the hosted MCP server forwards those tokens)", async (ctx) => {
      const tenant = tenantOrSkip(ctx);
      if (tenant.mcpAudience === undefined) {
        ctx.skip(
          "the tenant mints for the API audience alone (no MCP audience declared)",
        );
      }
      const presenting = target.clientsPresenting(
        tenant.mint({ subject: freshSubject(), audience: tenant.mcpAudience }),
      );
      // Admitted (idp-shaped) — the audience gate passed; NOT_FOUND is the
      // lane's answer for an unknown subject, UNAUTHENTICATED would be the gate.
      await expectGrpcCode(
        () => presenting.identityAccountQuery.whoAmI({}),
        Code.NotFound,
        "whoAmI with a token minted for the MCP audience",
      );
    });

    it("refuses a token minted for a foreign audience with the byte-pinned audience copy", async (ctx) => {
      const tenant = tenantOrSkip(ctx);
      const presenting = target.clientsPresenting(
        tenant.mint({
          subject: freshSubject(),
          audience: "https://another-api.conformance.test/",
        }),
      );
      const error = await expectGrpcCode(
        () => presenting.identityAccountQuery.whoAmI({}),
        Code.Unauthenticated,
        "a tenant token naming an audience this API does not serve",
      );
      expect(error.rawMessage).toBe(TOKEN_AUDIENCE_MESSAGE);
    });

    it("refuses an expired token with the byte-pinned expiry copy", async (ctx) => {
      const tenant = tenantOrSkip(ctx);
      const presenting = target.clientsPresenting(
        tenant.mint({ subject: freshSubject(), ttlSeconds: -120 }),
      );
      const error = await expectGrpcCode(
        () => presenting.identityAccountQuery.whoAmI({}),
        Code.Unauthenticated,
        "a tenant token two minutes past its exp",
      );
      expect(error.rawMessage).toBe(TOKEN_EXPIRED_MESSAGE);
    });

    it("refuses a token signed by a stranger under the tenant's issuer with the byte-pinned signature copy", async (ctx) => {
      const tenant = tenantOrSkip(ctx);
      const stranger = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const forged = signDirectLoginToken({
        privateKeyPem: stranger.privateKey
          .export({ type: "pkcs8", format: "pem" })
          .toString(),
        kid: "conformance-stranger-key",
        claims: directLoginClaims({
          issuer: tenant.issuer,
          subject: freshSubject(),
          audience: [tenant.apiAudience, `${tenant.issuer}userinfo`],
          ttlSeconds: 300,
        }),
      });
      const error = await expectGrpcCode(
        () => target.clientsPresenting(forged).identityAccountQuery.whoAmI({}),
        Code.Unauthenticated,
        "a token claiming the tenant's issuer but signed by a key its JWKS does not carry",
      );
      expect(error.rawMessage).toBe(TOKEN_SIGNATURE_MESSAGE);
    });
  },
);
