// Hermetic cloud environment: launcher process + identity bootstrap.
// Domain: conformance harness (cloud target lifecycle).
//
// The heavy boot (Testcontainers infra + a mock platform identity tenant +
// the Java stigmer-service fat JAR in PRODUCTION security mode) lives in a Go
// launcher that reuses the battle-tested integration harness
// (test/integration/cmd/conformance-cloudenv). This module owns the TS side:
// spawning that launcher, minting the pre-seeded bootstrap operator's first
// token from the tenant material the launcher hands over, performing the
// one-time auth bootstrap over gRPC as that operator, and defining the
// env-var contract through which the cloud global setup publishes the
// environment to test workers.
//
// Env vars are the interface deliberately: a future run against a deployed
// environment sets the same variables directly and skips the launcher — the
// CloudTarget never knows how the environment came to exist.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient } from "@connectrpc/connect";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { PlatformClientCommandController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/command_pb";
import { PlatformClientTokenController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import { createTransport, makeClients } from "./clients";
import { newDirectLoginTenant } from "./direct-login-tenant";
import { awaitGrpcReady } from "./grpc-ready";
import { CONFORMANCE_OAUTH_REDIRECT_URI } from "./server-process";
import { uniqueName } from "../support/naming";

// Contract between global-setup-cloud.ts (writer) and CloudTarget (reader).
export const CLOUD_ENV = {
  // gRPC base URL of the stigmer-service under test, e.g. http://127.0.0.1:52341.
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

// The org whose FGA ownership tuple the launcher seeds for the bootstrap
// operator (must match harness.TestOrg / SeedBootstrapOperator in
// test/integration). The bootstrap creates its PlatformClient here because it
// is the only org that operator is guaranteed to own.
const FGA_SEEDED_ORG = "test-org";

const execFileAsync = promisify(execFile);

// Repo root is four levels up from test/conformance/src/harness/.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const LAUNCHER_MODULE_DIR = resolve(REPO_ROOT, "test/integration");
const LAUNCHER_PACKAGE = "./cmd/conformance-cloudenv";

// Built to a deterministic temp path and spawned directly (never `go run`,
// which would put the go tool between us and the launcher: a SIGKILL fallback
// would then orphan the JVM and containers instead of stopping them). Same
// convention as ts-build.ts for the OSS server build.
const LAUNCHER_OUTPUT_DIR = join(tmpdir(), "stigmer-conformance");
const LAUNCHER_BINARY = join(
  LAUNCHER_OUTPUT_DIR,
  process.platform === "win32" ? "conformance-cloudenv.exe" : "conformance-cloudenv",
);

// Container pulls on a cold cache plus the JVM boot; matches the launcher's
// own bootTimeout so whichever side times out first still reports clearly.
const ENVIRONMENT_READY_TIMEOUT_MS = 10 * 60 * 1000;
const SHUTDOWN_GRACE_MS = 60_000;

export interface CloudEnvironment {
  readonly grpcBaseUrl: string;
  readonly httpBaseUrl: string;
  // The Cursor BiDi proxy's own h2c listener (Netty; Tomcat cannot serve
  // Connect bidi streams), published by the launcher's ready line since E1.
  readonly cursorBidiBaseUrl: string;
  // The mock platform identity tenant the JAR discovered at boot — its
  // private half, so this process can mint what the tenant would (entry
  // 20260907.02). Test-only material that lives for the run.
  readonly identityTenant: IdentityTenant;
  stop(): Promise<void>;
}

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

// Builds and spawns the Go launcher, waiting for its single JSON ready-line on
// stdout. The launcher's human-readable progress (stderr) is passed through so
// long container pulls and the JVM boot stay observable in CI logs.
//
// `launcherEnv` carries the cloud-capability fixtures' hand-over (E1): the
// fake upstream / Stripe / Discord addresses and the run-local webhook secret
// the launcher threads into explicit ServiceConfig fields, so the JVM's
// outbound posture is declared once on each side of the process boundary and
// never inherited ambiently.
export async function spawnCloudEnvironment(launcherEnv: Record<string, string> = {}): Promise<CloudEnvironment> {
  await mkdir(LAUNCHER_OUTPUT_DIR, { recursive: true });
  await execFileAsync("go", ["build", "-o", LAUNCHER_BINARY, LAUNCHER_PACKAGE], {
    cwd: LAUNCHER_MODULE_DIR,
    maxBuffer: 64 * 1024 * 1024,
  });

  const child = spawn(LAUNCHER_BINARY, [], {
    // The harness resolves the sibling stigmer-cloud checkout (service JAR,
    // FGA model) relative to the integration module dir; logs land in its
    // .test-output/ like the integration tests' own runs.
    cwd: LAUNCHER_MODULE_DIR,
    stdio: ["ignore", "pipe", "inherit"],
    env: {
      ...process.env,
      // The launcher passes this through to the Java service (an explicit
      // ServiceConfig field, never ambient inheritance). The suite's own
      // constant is the single source of truth: the mcpserver OAuth suites
      // assert this exact value inside DCR requests and authorize URLs, so
      // a second definition anywhere would drift.
      STIGMER_OAUTH_REDIRECT_URI: CONFORMANCE_OAUTH_REDIRECT_URI,
      ...launcherEnv,
    },
  });

  const readyLine = await waitForReadyLine(child);
  return {
    grpcBaseUrl: `http://${readyLine.grpcAddress}`,
    httpBaseUrl: readyLine.httpAddress,
    cursorBidiBaseUrl: readyLine.cursorBidiAddress,
    identityTenant: readyLine.identityTenant,
    stop: () => stopLauncher(child),
  };
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

interface ReadyLine {
  readonly grpcAddress: string;
  readonly httpAddress: string;
  readonly cursorBidiAddress: string;
  readonly identityTenant: IdentityTenant;
}

// The launcher's readySignal, field for field (cmd/conformance-cloudenv).
// Parsed strictly: the addresses and the whole tenant group are required, so
// a launcher that forgot a field fails here with the field named rather than
// failing later at the first mint or the first proxy call.
function parseReadyLine(line: string): ReadyLine | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // Not the ready-line; the launcher keeps stdout otherwise silent.
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const requiredString = (source: Record<string, unknown>, key: string, where: string): string => {
    const value = source[key];
    if (typeof value !== "string" || value === "") {
      throw new Error(`launcher ready line is missing ${where}${key}`);
    }
    return value;
  };
  // Only a line that looks like the ready signal is validated; anything
  // else on stdout is ignored, as before.
  if (typeof record["grpcAddress"] !== "string") {
    return undefined;
  }
  const tenantRaw = record["identityTenant"];
  if (typeof tenantRaw !== "object" || tenantRaw === null) {
    throw new Error("launcher ready line is missing identityTenant");
  }
  const tenant = tenantRaw as Record<string, unknown>;
  const optionalString = (key: string): string => {
    const value = tenant[key];
    return typeof value === "string" ? value : "";
  };
  return {
    grpcAddress: requiredString(record, "grpcAddress", ""),
    httpAddress: requiredString(record, "httpAddress", ""),
    cursorBidiAddress: requiredString(record, "cursorBidiAddress", ""),
    identityTenant: {
      issuer: requiredString(tenant, "issuer", "identityTenant."),
      kid: requiredString(tenant, "kid", "identityTenant."),
      privateKeyPem: requiredString(tenant, "privateKeyPem", "identityTenant."),
      apiAudience: requiredString(tenant, "apiAudience", "identityTenant."),
      // The MCP audience is the one optional field (a tenant may mint for
      // the API alone).
      mcpAudience: optionalString("mcpAudience"),
      bootstrapSubject: requiredString(tenant, "bootstrapSubject", "identityTenant."),
    },
  };
}

async function waitForReadyLine(child: ChildProcess): Promise<ReadyLine> {
  if (child.stdout === null) {
    throw new Error("launcher spawned without a stdout pipe");
  }
  const lines = createInterface({ input: child.stdout });

  const ready = new Promise<ReadyLine>((resolveReady, rejectReady) => {
    lines.on("line", (line) => {
      try {
        const parsed = parseReadyLine(line);
        if (parsed !== undefined) {
          resolveReady(parsed);
        }
      } catch (err) {
        rejectReady(err);
      }
    });
    child.once("exit", (code, signal) => {
      rejectReady(
        new Error(
          `cloud environment launcher exited before ready (code=${code}, signal=${signal}); ` +
            "its stderr above has the failure detail",
        ),
      );
    });
    child.once("error", rejectReady);
  });

  const timeout = new Promise<never>((_, rejectTimeout) => {
    const timer = setTimeout(() => {
      // Graceful teardown, NOT a naked SIGKILL (stigmer/stigmer#801): a boot
      // can hang AFTER the service JVM is already up (FGA seeding, a slow
      // container), and SIGKILLing the launcher at that point skipped its
      // deferred teardown entirely — the JVM orphaned silently and the next
      // attempt's clean logs masked the leak. SIGTERM triggers the deferred
      // teardown; stopLauncher's own SIGKILL fallback still bounds a wedged
      // one. The rejection waits for the teardown so vitest cannot exit
      // underneath it.
      console.error(
        `[cloud-env] not ready within ${ENVIRONMENT_READY_TIMEOUT_MS}ms — tearing the launcher down`,
      );
      void stopLauncher(child).finally(() => {
        rejectTimeout(
          new Error(`cloud environment not ready within ${ENVIRONMENT_READY_TIMEOUT_MS}ms`),
        );
      });
    }, ENVIRONMENT_READY_TIMEOUT_MS);
    timer.unref();
  });

  try {
    return await Promise.race([ready, timeout]);
  } finally {
    lines.close();
  }
}

// SIGTERM triggers the launcher's deferred teardown (containers, JVM); the
// SIGKILL fallback prevents a wedged teardown from hanging the vitest run,
// at the cost of leaking whatever was not yet stopped — containers (visible,
// reapable with `docker ps`) AND the naked service JVM, which nothing lists
// (stigmer/stigmer#801) — so the fallback firing is always worth a loud line.
async function stopLauncher(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = once(child, "exit");
  child.kill("SIGTERM");

  const timer = setTimeout(() => {
    console.error(
      `[cloud-env] launcher did not exit within ${SHUTDOWN_GRACE_MS}ms of SIGTERM — ` +
        "SIGKILL fallback; containers and the service JVM may have leaked " +
        "(check `docker ps` and `pgrep -f stigmer_service_fatjar`; stigmer/stigmer#801)",
    );
    child.kill("SIGKILL");
  }, SHUTDOWN_GRACE_MS);
  timer.unref();
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
