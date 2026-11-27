/**
 * The embedding coverage read (AgentQueryController.checkEmbeddingCoverage)
 * on a composed server with sign-in on, the key ring supplied so a service
 * account's key mints user tokens hermetically. What it pins, over the
 * wire, from the router entry through the handler's loads to the answer:
 *
 *   - an app user (a token a service account of the organization minted,
 *     whose minted_by the verifier carries) learns, by name only, which of
 *     the agent's keys the organization's embedding vaults fill: the key
 *     the vault holds is named, a key no vault holds is not, and no vault
 *     name, id or value is in the answer;
 *   - before the embedding settings name the vault, the answer is empty;
 *   - a first-party person gets an empty answer with the vault named: no
 *     run of theirs reads the embedding settings.
 *
 * The unit registers a permissive Authorizer: this rig's verifier stamps
 * the IdP subject as the caller, which the built-in Authorizer resolves to
 * an account only through the caller's token, and the run's attacher check
 * asks for a recorded attacher with no token. Who may read the agent and
 * whether the attacher may still use the vault are the conformance suite's
 * (the open-source sign-in posture, whose verifier stamps account ids) and
 * the resolver's arms' to pin.
 *
 * The resolver's own arms (domain/vault/__tests__/resolve.test.ts, "the
 * embedding coverage read") pin the matching rule, refused vaults and the
 * agreement with a run's plan; the conformance suite
 * (test/conformance/src/suites/embedding-coverage.conformance.test.ts) pins
 * the same read on every edition's enforcing lane.
 */
import { generateKeyPairSync } from "node:crypto";

import { createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { VaultCommandController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/command_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { TokenService } from "@stigmer/apis/ai/stigmer/iam/token/v1/token_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/command_pb";

import { newPermissiveSingleTeamAuthorizer } from "../../../pipeline/steps/authorize.js";
import { platformTokenKeyRingFromPem } from "../../../platformtoken/key-ring.js";
import type { SigningPlatformTokenKeyRing } from "../../../platformtoken/key-ring.js";
import {
  bootSignInServer,
  createServiceAccount,
  foundOrganization,
  mintServiceAccountKey,
  provision,
} from "../../identityaccount/__tests__/service-account-support.js";
import type { SignInServer } from "../../identityaccount/__tests__/service-account-support.js";

const FOUNDER = "fake|coverage-founder";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const built = platformTokenKeyRingFromPem({
  privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  publicKeyPems: [publicKey.export({ format: "pem", type: "spki" }).toString()],
});
if (built.signer === undefined) throw new Error("fixture ring must sign");
const RING: SigningPlatformTokenKeyRing = { ...built, signer: built.signer };

let at: SignInServer;
let acme = "";
let vaultId = "";
let vaultSlug = "";
let agentId = "";
let appUserToken = "";

async function nameVault(vaults: string[]): Promise<void> {
  await createClient(OrganizationCommandController, at.as(FOUNDER)).updateEmbedding({
    orgId: acme,
    embedding: {
      createAccountsOnSignIn: true,
      signInRole: IamRole.member,
      vaults: vaults.map((id) => ({ kind: ApiResourceKind.vault, org: acme, id })),
    },
  });
}

function coverageAs(transport: ReturnType<SignInServer["as"]>) {
  return createClient(AgentQueryController, transport).checkEmbeddingCoverage({
    agent: { kind: ApiResourceKind.agent, org: acme, id: agentId },
    org: acme,
  });
}

beforeAll(async () => {
  at = await bootSignInServer("embedding-coverage", {
    authorizer: newPermissiveSingleTeamAuthorizer(),
    drivers: { platformTokenKeys: RING },
  });
  await provision(at, FOUNDER);
  acme = await foundOrganization(at.as(FOUNDER), "coverage-acme");
  await nameVault([]);

  // The founder's shared vault, holding the agent's key.
  const vaults = createClient(VaultCommandController, at.as(FOUNDER));
  const vault = await vaults.create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Vault",
    metadata: { name: "coverage-everyone", org: acme },
    spec: { description: "the integrator's keys for every app user" },
  });
  vaultId = vault.metadata?.id ?? "";
  vaultSlug = vault.metadata?.slug ?? "";
  const target = { org: acme, vault: { case: "id" as const, value: vaultId } };
  await vaults.setSecrets({ vault: target, secrets: { COV_KEY: { value: "everyone-key" } } });

  // An org-visible agent declaring that key and one nowhere.
  const agent = await createClient(AgentCommandController, at.as(FOUNDER)).create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name: "coverage-agent", org: acme, visibility: ApiResourceVisibility.visibility_org },
    spec: {
      description: "reads the integrator's key",
      instructions: "Answer the question.",
      env: { COV_KEY: { isSecret: true }, COV_NOWHERE: { isSecret: true } },
    },
  });
  agentId = agent.metadata?.id ?? "";

  // An app user, minted by an admin service account of the organization.
  const dashboard = await createServiceAccount(at.as(FOUNDER), acme, "coverage-dashboard", IamRole.admin);
  const key = await mintServiceAccountKey(at.as(FOUNDER), dashboard.metadata?.id ?? "", "coverage-key");
  const minted = await createClient(TokenService, at.presenting(key)).mintUserToken({
    org: acme,
    userId: "coverage-user",
  });
  appUserToken = minted.accessToken;
});

afterAll(async () => {
  await at?.shutdown();
});

describe("checkEmbeddingCoverage", () => {
  it("names, for an app user, the keys the embedding vaults fill, and nothing before they are named", async () => {
    const before = await coverageAs(at.presenting(appUserToken));
    expect([before.keys, before.signInAddresses]).toEqual([[], []]);

    await nameVault([vaultId]);
    const after = await coverageAs(at.presenting(appUserToken));
    expect(after.keys).toEqual(["COV_KEY"]);
    expect(after.signInAddresses).toEqual([]);
    const text = JSON.stringify({ keys: after.keys, signInAddresses: after.signInAddresses });
    for (const hidden of [vaultId, vaultSlug, "coverage-everyone", "everyone-key"]) {
      expect(text, hidden).not.toContain(hidden);
    }
  });

  it("answers a first-party person with nothing, the vault named: their runs never read the embedding settings", async () => {
    await nameVault([vaultId]);
    const answer = await coverageAs(at.as(FOUNDER));
    expect([answer.keys, answer.signInAddresses]).toEqual([[], []]);
  });
});
