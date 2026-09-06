// Hermetic cloud environment: launcher process + identity bootstrap.
// Domain: conformance harness (cloud target lifecycle).
//
// The heavy boot (Testcontainers infra + the Java stigmer-service fat JAR)
// lives in a Go launcher that reuses the battle-tested integration harness
// (test/integration/cmd/conformance-cloudenv). This module owns the TS side:
// spawning that launcher, performing the one-time auth bootstrap over gRPC,
// and defining the env-var contract through which the cloud global setup
// publishes the environment to test workers.
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
  // Whether the environment's serving edge authenticates callers at all —
  // `enforced` (the DEFAULT when unset: production Java's interceptor, the
  // TS composition's declared posture) or `bypassed-test-mode`. The hermetic
  // launcher boots the JAR with STIGMER_SECURITY_MODE=test, which does NOT
  // load GrpcSecurityConfigBase: a synthetic caller stands in for every
  // request, credential or not — the door bootstrapPrimaryIdentity walks
  // through below. Only global-setup-cloud.ts, the code that CHOSE that
  // mode, declares the bypass; a pre-provisioned or deployed endpoint that
  // forgets the variable gets the production contract and fails loudly if
  // its edge is open (DD-012: never a false green). The authentication
  // suite skips its credential arms VISIBLY where the edge is bypassed and
  // asserts them everywhere else. Java's production-mode posture is
  // covered by test/integration-security; making the hermetic launcher run
  // production mode is a recorded follow-up (entry 20260904.02, D-S1).
  edgeAuthentication: "STIGMER_CONFORMANCE_CLOUD_EDGE_AUTHENTICATION",
  // The platform identity tenant the server under test was booted against
  // (its STIGMER_IDP_URL / Java idp-url), as the readout substrate's mock
  // tenant declares it — so the direct-login suite can MINT the tokens a
  // console, desktop, CLI or MCP client presents and drive the server's
  // direct-login lane (stigmer-cloud#604, the S1 lane). The signing key is
  // the private half of the key the tenant's JWKS publishes (base64 of a
  // PKCS#8 PEM, the composition's `*_BASE64` custody pattern); the kid names
  // it in that document. Deliberately UNSET wherever the suite cannot own
  // the tenant's key — the hermetic launcher (test security mode, no edge)
  // and any deployed endpoint (a real tenant's key is never handed to
  // conformance) — so CloudTarget exposes no directLoginTenant and the
  // suite skips VISIBLY. The API audience is required with the issuer; the
  // MCP audience is optional (blank = the tenant mints for the API alone).
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

// The two declared edge postures — see CLOUD_ENV.edgeAuthentication.
export const EDGE_AUTHENTICATION = {
  enforced: "enforced",
  bypassedTestMode: "bypassed-test-mode",
} as const;
export type EdgeAuthentication =
  (typeof EDGE_AUTHENTICATION)[keyof typeof EDGE_AUTHENTICATION];

// Resolves the declared edge posture: unset = enforced (the production
// contract). Any other value is a harness misconfiguration, thrown loudly
// rather than coerced to either posture.
export function resolveEdgeAuthentication(): EdgeAuthentication {
  const raw = process.env[CLOUD_ENV.edgeAuthentication];
  if (raw === undefined || raw === "" || raw === EDGE_AUTHENTICATION.enforced) {
    return EDGE_AUTHENTICATION.enforced;
  }
  if (raw === EDGE_AUTHENTICATION.bypassedTestMode) {
    return EDGE_AUTHENTICATION.bypassedTestMode;
  }
  throw new Error(
    `${CLOUD_ENV.edgeAuthentication} must be "${EDGE_AUTHENTICATION.enforced}" or "${EDGE_AUTHENTICATION.bypassedTestMode}" when set; got "${raw}"`,
  );
}

// The org whose FGA ownership tuples the launcher seeds for the synthetic test
// identity (must match harness.TestOrg / fga_seeder.go in test/integration).
// The bootstrap creates its PlatformClient here because it is the only org the
// tokenless caller is guaranteed to own.
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
  stop(): Promise<void>;
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
    stop: () => stopLauncher(child),
  };
}

// One-time auth bootstrap, run once per suite invocation:
// tokenless call (the launcher's test security mode maps it to the synthetic
// FGA-seeded identity — the edge posture CLOUD_ENV.edgeAuthentication
// declares as bypassed) -> create a PlatformClient in the seeded org -> mint
// a real Stigmer JWT for a fresh primary user. Everything after this runs as
// that user through the production token-verification path.
export async function bootstrapPrimaryIdentity(grpcBaseUrl: string): Promise<PrimaryIdentity> {
  const tokenlessTransport = createTransport(grpcBaseUrl);
  await awaitGrpcReady(
    makeClients(tokenlessTransport),
    () => "(cloud environment: see the launcher's stderr and stigmer-service-*.log)",
  );

  const platformClientCommand = createClient(PlatformClientCommandController, tokenlessTransport);
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
  const operatorToken = await bootstrapOperatorIdentity(grpcBaseUrl, tokenlessTransport, platformClient);
  return { token, platformClient, operatorToken };
}

// Provisions the conf-operator identity through production RPCs only
// (stigmer#547): mint a fresh user via the bootstrap PlatformClient, then
// grant it `operator` on platform:stigmer with bootstrapPolicy — the exact
// row + FGA-tuple shape the production BootstrapIdentitySeeder writes for the
// machine account. The tokenless caller qualifies because the launcher's FGA
// seeding makes the synthetic test identity a platform operator, which
// derives can_bootstrap_iam. (The ordinary IamPolicy `create` RPC cannot
// express this grant: the platform kind declares no grantable_roles and
// `operator` is not an IamRole — bootstrapPolicy is the sanctioned lane.)
async function bootstrapOperatorIdentity(
  grpcBaseUrl: string,
  tokenlessTransport: ReturnType<typeof createTransport>,
  platformClient: PlatformClientCredentials,
): Promise<string> {
  const operatorToken = await mintCloudUserToken(grpcBaseUrl, platformClient, uniqueName("conf-operator"));
  const operatorAccountId = jwtSubject(operatorToken);

  const iamPolicyCommand = createClient(IamPolicyCommandController, tokenlessTransport);
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
}

async function waitForReadyLine(child: ChildProcess): Promise<ReadyLine> {
  if (child.stdout === null) {
    throw new Error("launcher spawned without a stdout pipe");
  }
  const lines = createInterface({ input: child.stdout });

  const ready = new Promise<ReadyLine>((resolveReady, rejectReady) => {
    lines.on("line", (line) => {
      try {
        const parsed = JSON.parse(line) as {
          grpcAddress?: unknown;
          httpAddress?: unknown;
          cursorBidiAddress?: unknown;
        };
        if (
          typeof parsed.grpcAddress === "string" && parsed.grpcAddress !== "" &&
          typeof parsed.httpAddress === "string" && parsed.httpAddress !== "" &&
          typeof parsed.cursorBidiAddress === "string" && parsed.cursorBidiAddress !== ""
        ) {
          resolveReady({
            grpcAddress: parsed.grpcAddress,
            httpAddress: parsed.httpAddress,
            cursorBidiAddress: parsed.cursorBidiAddress,
          });
        }
      } catch {
        // Not the ready-line; the launcher keeps stdout otherwise silent.
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
