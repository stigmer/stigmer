// The cloud environment's env-var CONTRACT and identity bootstrap.
// Domain: conformance harness (cloud target lifecycle).
//
// The cloud targets are connect-only: they never boot anything. The
// environment they test is PROVISIONED ELSEWHERE — since 2026-09-10 (the Java
// stigmer-service's retirement) that is the TypeScript
// composition, booted by stigmer-cloud's readout recipe, which writes the
// CLOUD_ENV variables below before the suite runs. Until then a Go launcher in
// this repository (test/integration/cmd/conformance-cloudenv) booted the Java
// service hermetically and this module spawned it; that half retired with the
// service. What remains is the contract (CLOUD_ENV) and the way the targets
// make a person: a console sign-in through the environment's direct-login
// tenant, then the first-login provisioning a console runs
// (provisionConsolePerson, over people.ts, which the Enterprise target
// shares).
//
// Why a console sign-in and not a minted user token: a minted token works
// in one organization only, so a person
// made that way could neither found the organizations the suites provision
// nor act in them. A console person speaks for themselves in every
// organization they hold a role in, which is what the suites' founder,
// member and outsider are. Minted user tokens appear only in the suites
// that test them.

import type { DirectLoginTenant } from "../targets/target";
import type { ConformanceClients } from "./clients";
import { newDirectLoginTenant, readDirectLoginTenantMaterial } from "./direct-login-tenant";
import { PERSON_TOKEN_TTL_SECONDS, provisionPerson, type ProvisionedPerson } from "./people";
import { freshSubject } from "../support/identityaccounts";

// Contract between the provisioner (writer) and the cloud targets (readers);
// global-setup-cloud.ts refuses a run whose required entries are undeclared.
export const CLOUD_ENV = {
  // gRPC base URL of the service under test, e.g. http://127.0.0.1:52341.
  address: "STIGMER_CONFORMANCE_CLOUD_ADDRESS",
  // HTTP (Spring) base URL of the same service — the routes the gRPC port
  // does not serve, notably the artifact presign endpoints
  // (/v1/proxy/artifacts/...) the cloud-execution runner's proxy artifact
  // store targets (stigmer#803).
  httpAddress: "STIGMER_CONFORMANCE_CLOUD_HTTP_ADDRESS",
  // The primary conformance user's console token: minted by the
  // environment's direct-login tenant for a provisioned person, who founds
  // and owns every tenancy the target provisions; every suite RPC carries
  // it as a Bearer token.
  token: "STIGMER_CONFORMANCE_CLOUD_TOKEN",
  // The conf-operator user's console token — a platform operator the
  // hermetic bootstrap provisions through production RPCs (stigmer#547), used
  // by CloudTarget.provisionPrivilegedScope for operator-only writes
  // (reserved labels, the public flip, the model catalog and the usage
  // meter's platform lanes). Deliberately UNSET on pre-provisioned/deployed
  // endpoints: handing conformance operator credentials to a real
  // deployment is the permanent skip the stigmer#547 ruling recorded, so
  // privileged-lane assertions skip there.
  operatorToken: "STIGMER_CONFORMANCE_CLOUD_OPERATOR_TOKEN",
  // The platform identity tenant the server under test was booted against
  // (its STIGMER_IDP_URL / Java idp-url), as the environment's mock tenant
  // declares it — so the direct-login suite can MINT the tokens a console,
  // desktop, CLI or MCP client presents and drive the server's direct-login
  // lane. The signing key is the private half of the key the tenant's JWKS
  // publishes (base64 of a PKCS#8 PEM, the composition's `*_BASE64` custody
  // pattern); the kid names it in that document. Set by whoever owns the
  // tenant: the hermetic launcher hands its in-process tenant's material
  // over on the ready line (the same material minted the bootstrap
  // operator's first token); the composition readout's spike tenant writes
  // an env file. Deliberately UNSET on any deployed endpoint — a real
  // tenant's key is never handed to conformance — and CloudTarget's setup
  // requires it (its people sign in through the tenant), so the cloud
  // target runs only where the tenant is handed over. The API audience is
  // required with the issuer; the MCP audience is optional (blank = the
  // tenant mints for the API alone).
  directLoginIssuer: "STIGMER_CONFORMANCE_CLOUD_DIRECT_LOGIN_ISSUER",
  directLoginSigningKeyBase64: "STIGMER_CONFORMANCE_CLOUD_DIRECT_LOGIN_SIGNING_KEY_BASE64",
  directLoginKid: "STIGMER_CONFORMANCE_CLOUD_DIRECT_LOGIN_KID",
  directLoginApiAudience: "STIGMER_CONFORMANCE_CLOUD_DIRECT_LOGIN_API_AUDIENCE",
  directLoginMcpAudience: "STIGMER_CONFORMANCE_CLOUD_DIRECT_LOGIN_MCP_AUDIENCE",
  // The cloud-capability HTTP lanes, one address per lane — see
  // TargetProfile.proxyBaseUrl and siblings for why they are not one
  // httpAddress. The composition publishes whatever listener each lane
  // binds. Each is REQUIRED on a cloud target (the flags are true there): an
  // environment that forgets one fails its arms loudly, never false-greens.
  proxyAddress: "STIGMER_CONFORMANCE_CLOUD_PROXY_ADDRESS",
  cursorBidiAddress: "STIGMER_CONFORMANCE_CLOUD_CURSOR_BIDI_ADDRESS",
  publicAddress: "STIGMER_CONFORMANCE_CLOUD_PUBLIC_ADDRESS",
  stripeWebhookAddress: "STIGMER_CONFORMANCE_CLOUD_STRIPE_WEBHOOK_ADDRESS",
  // The webhook signing secret the server under test was booted with; the
  // suite signs its synthetic Stripe events with it (Stripe-Signature v1
  // HMAC-SHA256 over `<timestamp>.<payload>`), so the signature contract is
  // asserted without a network. Never a production secret: the hermetic
  // launcher mints a run-local one, and a deployed endpoint is never given
  // one (the arms fail loudly there, as they should).
  stripeWebhookSecret: "STIGMER_CONFORMANCE_CLOUD_STRIPE_WEBHOOK_SECRET",
  // Control URL of the run's cloud fixtures (the fake LLM upstream, the fake
  // Stripe API, the fake Discord webhook receiver): booted once in the global
  // setup, scripted by every worker over this URL. Published by the global
  // setup or by the fixtures' standalone entrypoint for the composition
  // readout.
  fixturesControlUrl: "STIGMER_CONFORMANCE_CLOUD_FIXTURES_CONTROL_URL",
} as const;

// The environment's direct-login tenant, which every cloud target needs to
// make its people (the global setup refuses a run without it).
export function requireDirectLoginTenant(): DirectLoginTenant {
  const material = readDirectLoginTenantMaterial();
  if (material === undefined) {
    throw new Error(
      `${CLOUD_ENV.directLoginIssuer} is unset: the cloud target makes its people by signing them in ` +
        "through the environment's direct-login tenant, as a console does, and cannot run without it",
    );
  }
  return newDirectLoginTenant(material);
}

// A brand-new person: a console token for a fresh subject, then the
// first-login provisioning a console runs (provisionMyAccount) through the
// clients that present it, so the person is a real account before any grant
// names them.
export function provisionConsolePerson(
  tenant: DirectLoginTenant,
  presenting: (token: string) => Pick<ConformanceClients, "identityAccountCommand">,
): Promise<ProvisionedPerson> {
  return provisionPerson(
    tenant.mint({ subject: freshSubject(), ttlSeconds: PERSON_TOKEN_TTL_SECONDS }),
    presenting,
  );
}
