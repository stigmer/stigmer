// The cloud environment's env-var CONTRACT and identity bootstrap.
// Domain: conformance harness (cloud target lifecycle).
//
// The cloud targets are connect-only: they never boot anything. The
// environment they test is PROVISIONED ELSEWHERE — since 2026-09-10 (the Java
// stigmer-service's retirement, stigmer-cloud DD-013) that is the TypeScript
// composition, booted by stigmer-cloud's readout recipe, which writes the
// CLOUD_ENV variables below before the suite runs. Until then a Go launcher in
// this repository (test/integration/cmd/conformance-cloudenv) booted the Java
// service hermetically and this module spawned it; that half retired with the
// service. What remains is the contract (CLOUD_ENV), the one-time auth
// bootstrap a provisioner performs as the pre-seeded operator
// (bootstrapPrimaryIdentity), and the user-token mint the targets use.
import { createClient } from "@connectrpc/connect";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { PlatformClientCommandController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/command_pb";
import { PlatformClientTokenController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import { createTransport, makeClients } from "./clients";
import { newDirectLoginTenant } from "./direct-login-tenant";
import { awaitGrpcReady } from "./grpc-ready";
import { uniqueName } from "../support/naming";

// Contract between global-setup-cloud.ts (writer) and CloudTarget (reader).
export const CLOUD_ENV = {
  // Which server binary the environment booted behind the cloud targets —
  // "stigmer-service" (the Java service the hermetic launcher runs) or
  // "stigmer-server" (the TypeScript composition the readout recipe boots).
  // REQUIRED: the cloud targets are connect-only and cannot tell from the
  // wire (getServerInfo answers `cloud` for both, correctly — the product
  // edition is the same), yet the known-deviation registry keys Java's bugs
  // on exactly this fact. Declared by the provisioner that knows what it
  // built (global-setup-cloud.ts; the composition's readout-bootstrap), never
  // defaulted — an environment that forgets it fails setup by name rather
  // than inheriting the other implementation's quirks (stigmer#1012).
  implementation: "STIGMER_CONFORMANCE_CLOUD_IMPLEMENTATION",
  // gRPC base URL of the service under test, e.g. http://127.0.0.1:52341.
  address: "STIGMER_CONFORMANCE_CLOUD_ADDRESS",
  // HTTP (Spring) base URL of the same service — the routes the gRPC port
  // does not serve, notably the artifact presign endpoints
  // (/v1/proxy/artifacts/...) the cloud-execution runner's proxy artifact
  // store targets (stigmer#803).
  httpAddress: "STIGMER_CONFORMANCE_CLOUD_HTTP_ADDRESS",
  // Stigmer-signed JWT for the primary conformance user; every suite RPC
  // carries it as a Bearer token.
  token: "STIGMER_CONFORMANCE_CLOUD_TOKEN",
  // PlatformClient credentials for minting additional identities
  // (CloudTarget.provisionIdentity), used by cross-tenant isolation assertions.
  platformClientId: "STIGMER_CONFORMANCE_CLOUD_PLATFORM_CLIENT_ID",
  platformClientSecret: "STIGMER_CONFORMANCE_CLOUD_PLATFORM_CLIENT_SECRET",
  // Stigmer-signed JWT for the conf-operator user — a platform operator the
  // hermetic bootstrap provisions through production RPCs (stigmer#547), used
  // by CloudTarget.provisionPrivilegedScope for operator-only writes
  // (reserved labels, the public flip). Deliberately UNSET on
  // pre-provisioned/deployed endpoints: handing conformance operator
  // credentials to a real deployment is the permanent skip the stigmer#547
  // ruling recorded, so privileged-lane assertions skip there.
  operatorToken: "STIGMER_CONFORMANCE_CLOUD_OPERATOR_TOKEN",
  // The platform identity tenant the server under test was booted against
  // (its STIGMER_IDP_URL / Java idp-url), as the environment's mock tenant
  // declares it — so the direct-login suite can MINT the tokens a console,
  // desktop, CLI or MCP client presents and drive the server's direct-login
  // lane (stigmer-cloud#604, the S1 lane). The signing key is the private
  // half of the key the tenant's JWKS publishes (base64 of a PKCS#8 PEM, the
  // composition's `*_BASE64` custody pattern); the kid names it in that
  // document. Set by whoever owns the tenant: the hermetic launcher hands
  // its in-process tenant's material over on the ready line (the same
  // material minted the bootstrap operator's first token); the composition
  // readout's spike tenant writes an env file. Deliberately UNSET on any
  // deployed endpoint — a real tenant's key is never handed to conformance —
  // so CloudTarget exposes no directLoginTenant and the suite skips VISIBLY.
  // The API audience is required with the issuer; the MCP audience is
  // optional (blank = the tenant mints for the API alone).
  directLoginIssuer: "STIGMER_CONFORMANCE_CLOUD_DIRECT_LOGIN_ISSUER",
  directLoginSigningKeyBase64: "STIGMER_CONFORMANCE_CLOUD_DIRECT_LOGIN_SIGNING_KEY_BASE64",
  directLoginKid: "STIGMER_CONFORMANCE_CLOUD_DIRECT_LOGIN_KID",
  directLoginApiAudience: "STIGMER_CONFORMANCE_CLOUD_DIRECT_LOGIN_API_AUDIENCE",
  directLoginMcpAudience: "STIGMER_CONFORMANCE_CLOUD_DIRECT_LOGIN_MCP_AUDIENCE",
  // The cloud-capability HTTP lanes (E1, entry 20260906.04), one address per
  // lane — see TargetProfile.proxyBaseUrl and siblings for why they are not
  // one httpAddress. On the hermetic launcher every lane but bidi is the
  // Spring HTTP address; the composition publishes whatever listener C6/P1
  // bind. Each is REQUIRED on a cloud target (the flags are true there): an
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

// The org whose FGA ownership tuple the environment's provisioner seeds for
// the bootstrap operator (the readout recipe's bootstrap org; on the retired
// hermetic launcher, harness.TestOrg). The bootstrap creates its
// PlatformClient here because it is the only org that operator is guaranteed
// to own.
const FGA_SEEDED_ORG = "test-org";


// The ready line's tenant group. `bootstrapSubject` is the `sub` of the one
// pre-seeded platform operator (SeedBootstrapOperator in the launcher) —
// the only identity that can act before any PlatformClient exists.
export interface IdentityTenant {
  readonly issuer: string;
  readonly kid: string;
  readonly privateKeyPem: string;
  readonly apiAudience: string;
  readonly mcpAudience: string;
  readonly bootstrapSubject: string;
}

export interface PlatformClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface PrimaryIdentity {
  readonly token: string;
  readonly platformClient: PlatformClientCredentials;
  // The conf-operator user's JWT (platform operator via bootstrapPolicy).
  readonly operatorToken: string;
}


// Mints the bootstrap operator's first credential: a first-party token from
// the environment's tenant for the pre-seeded operator subject — the same
// mint the direct-login suite uses, so the bootstrap presents exactly what a
// console would after login. Production Java resolves the subject to the
// seeded account, and the operator's FGA grants do the rest.
export function mintBootstrapOperatorToken(tenant: IdentityTenant): string {
  return newDirectLoginTenant({
    issuer: tenant.issuer,
    signingKeyPem: tenant.privateKeyPem,
    kid: tenant.kid,
    apiAudience: tenant.apiAudience,
    mcpAudience: tenant.mcpAudience === "" ? undefined : tenant.mcpAudience,
  }).mint({ subject: tenant.bootstrapSubject });
}

// One-time auth bootstrap, run once per suite invocation, AS the pre-seeded
// bootstrap operator: readiness probe -> create a PlatformClient in the org
// the operator owns -> mint a real Stigmer JWT for a fresh primary user ->
// grant a second fresh user the operator role. Every call carries the
// operator's Bearer — the edge is production Java's interceptor, and a
// tokenless call would be refused UNAUTHENTICATED (the readiness probe
// included: findMyOrganizations is not is_public). Everything after this
// runs as the minted users through the production token-verification path.
export async function bootstrapPrimaryIdentity(
  grpcBaseUrl: string,
  bootstrapOperatorToken: string,
): Promise<PrimaryIdentity> {
  const operatorTransport = createTransport(grpcBaseUrl, { bearerToken: bootstrapOperatorToken });
  await awaitGrpcReady(
    makeClients(operatorTransport),
    () => "(cloud environment: see the launcher's stderr and stigmer-service-*.log)",
  );

  const platformClientCommand = createClient(PlatformClientCommandController, operatorTransport);
  const created = await platformClientCommand.create({
    apiVersion: "iam.stigmer.ai/v1",
    kind: "PlatformClient",
    metadata: { name: uniqueName("conformance-pc"), org: FGA_SEEDED_ORG },
    // JIT-provision minted users: every conformance identity (primary and the
    // per-assertion outsiders) is a fresh user_id that must not pre-exist.
    spec: { autoProvisionAccounts: true },
  });

  const clientId = created.platformClient?.spec?.clientId;
  if (clientId === undefined || clientId === "" || created.clientSecret === "") {
    throw new Error("PlatformClient create returned no usable credentials (client_id/client_secret)");
  }
  const platformClient: PlatformClientCredentials = { clientId, clientSecret: created.clientSecret };

  const token = await mintCloudUserToken(grpcBaseUrl, platformClient, uniqueName("conf-user"));
  const operatorToken = await bootstrapOperatorIdentity(grpcBaseUrl, operatorTransport, platformClient);
  return { token, platformClient, operatorToken };
}

// Provisions the conf-operator identity through production RPCs only
// (stigmer#547): mint a fresh user via the bootstrap PlatformClient, then
// grant it `operator` on platform:stigmer with bootstrapPolicy — the exact
// row + FGA-tuple shape the production BootstrapIdentitySeeder writes for the
// machine account. The bootstrap operator qualifies because the launcher
// seeded it as a platform operator, which derives can_bootstrap_iam. (The
// ordinary IamPolicy `create` RPC cannot express this grant: the platform
// kind declares no grantable_roles and `operator` is not an IamRole —
// bootstrapPolicy is the sanctioned lane.)
async function bootstrapOperatorIdentity(
  grpcBaseUrl: string,
  operatorTransport: ReturnType<typeof createTransport>,
  platformClient: PlatformClientCredentials,
): Promise<string> {
  const operatorToken = await mintCloudUserToken(grpcBaseUrl, platformClient, uniqueName("conf-operator"));
  const operatorAccountId = jwtSubject(operatorToken);

  const iamPolicyCommand = createClient(IamPolicyCommandController, operatorTransport);
  await iamPolicyCommand.bootstrapPolicy({
    principal: { kind: "identity_account", id: operatorAccountId },
    resource: { kind: "platform", id: "stigmer" },
    relation: "operator",
  });
  return operatorToken;
}

// The minted JWT's `sub` is the JIT-provisioned identity-account id — the
// principal the operator grant must name (the server chooses it; it is not
// the userId the mint request carried).
function jwtSubject(token: string): string {
  const payloadSegment = token.split(".")[1];
  if (payloadSegment === undefined) {
    throw new Error("minted token is not a JWT (no payload segment)");
  }
  const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as {
    sub?: unknown;
  };
  if (typeof payload.sub !== "string" || payload.sub === "") {
    throw new Error("minted token carries no sub claim; cannot grant the operator role");
  }
  return payload.sub;
}

// Mints a Stigmer JWT for the given user id. mintUserToken authenticates via
// the client credentials in the request body (no Bearer token required), so a
// plain transport suffices.
export async function mintCloudUserToken(
  grpcBaseUrl: string,
  credentials: PlatformClientCredentials,
  userId: string,
): Promise<string> {
  const tokenController = createClient(PlatformClientTokenController, createTransport(grpcBaseUrl));
  const response = await tokenController.mintUserToken({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    userId,
    userEmail: `${userId}@conformance.stigmer.ai`,
    userName: `Conformance ${userId}`,
  });
  if (response.accessToken === "") {
    throw new Error(`mintUserToken returned an empty access token for user ${userId}`);
  }
  return response.accessToken;
}
