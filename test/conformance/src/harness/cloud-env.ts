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
import { PlatformClientCommandController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/command_pb";
import { PlatformClientTokenController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import { createTransport, makeClients } from "./clients";
import { awaitGrpcReady } from "./grpc-ready";
import { uniqueName } from "../support/naming";

// Contract between global-setup-cloud.ts (writer) and CloudTarget (reader).
export const CLOUD_ENV = {
  // gRPC base URL of the stigmer-service under test, e.g. http://127.0.0.1:52341.
  address: "STIGMER_CONFORMANCE_CLOUD_ADDRESS",
  // Stigmer-signed JWT for the primary conformance user; every suite RPC
  // carries it as a Bearer token.
  token: "STIGMER_CONFORMANCE_CLOUD_TOKEN",
  // PlatformClient credentials for minting additional identities
  // (CloudTarget.provisionIdentity), used by cross-tenant isolation assertions.
  platformClientId: "STIGMER_CONFORMANCE_CLOUD_PLATFORM_CLIENT_ID",
  platformClientSecret: "STIGMER_CONFORMANCE_CLOUD_PLATFORM_CLIENT_SECRET",
} as const;

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
// convention as go-build.ts for the OSS server binary.
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
  stop(): Promise<void>;
}

export interface PlatformClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface PrimaryIdentity {
  readonly token: string;
  readonly platformClient: PlatformClientCredentials;
}

// Builds and spawns the Go launcher, waiting for its single JSON ready-line on
// stdout. The launcher's human-readable progress (stderr) is passed through so
// long container pulls and the JVM boot stay observable in CI logs.
export async function spawnCloudEnvironment(): Promise<CloudEnvironment> {
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
  });

  const grpcAddress = await waitForReadyLine(child);
  return {
    grpcBaseUrl: `http://${grpcAddress}`,
    stop: () => stopLauncher(child),
  };
}

// One-time auth bootstrap, run once per suite invocation:
// tokenless call (the launcher's test security mode maps it to the synthetic
// FGA-seeded identity) -> create a PlatformClient in the seeded org -> mint a
// real Stigmer JWT for a fresh primary user. Everything after this runs as
// that user through the production token-verification path.
export async function bootstrapPrimaryIdentity(grpcBaseUrl: string): Promise<PrimaryIdentity> {
  const tokenlessTransport = createTransport(grpcBaseUrl);
  await awaitGrpcReady(
    makeClients(tokenlessTransport),
    () => "(cloud environment: see the launcher's stderr and stigmer-service.log)",
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
  return { token, platformClient };
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

async function waitForReadyLine(child: ChildProcess): Promise<string> {
  if (child.stdout === null) {
    throw new Error("launcher spawned without a stdout pipe");
  }
  const lines = createInterface({ input: child.stdout });

  const ready = new Promise<string>((resolveReady, rejectReady) => {
    lines.on("line", (line) => {
      try {
        const parsed: unknown = JSON.parse(line);
        const address = (parsed as { grpcAddress?: unknown }).grpcAddress;
        if (typeof address === "string" && address !== "") {
          resolveReady(address);
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
      child.kill("SIGKILL");
      rejectTimeout(
        new Error(`cloud environment not ready within ${ENVIRONMENT_READY_TIMEOUT_MS}ms`),
      );
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
// at the cost of leaking containers (visible, reapable with `docker ps`).
async function stopLauncher(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = once(child, "exit");
  child.kill("SIGTERM");

  const timer = setTimeout(() => child.kill("SIGKILL"), SHUTDOWN_GRACE_MS);
  timer.unref();
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}
