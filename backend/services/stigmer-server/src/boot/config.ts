/**
 * Server configuration — stage 1 of the composition root
 * (config → storage → temporal → controllers → routes → listen).
 *
 * Deliberately covers ONLY the env contract the transport scaffold consumes.
 * Go's full config surface (pkg/config/config.go) is ported entry by entry
 * with the code that consumes it, so no config entry exists here before the
 * code that reads it.
 *
 * Env semantics mirror Go exactly (pkg/config/config.go getEnvInt/
 * getEnvString): a missing OR malformed value falls back to the default,
 * silently. That leniency is Go's shipped behavior and therefore contract —
 * a stricter loader would turn working `stigmer up` setups into boot
 * failures at cutover.
 *
 * One deliberate exception to the leniency: the operator identity
 * (STIGMER_OPERATOR_EMAIL/NAME) is boot-fatal on certain misconfiguration,
 * exactly as Go's loadOperatorIdentity — silently stamping a typo'd
 * identity on every audit record is worse than refusing to boot.
 */
import os from "node:os";
import path from "node:path";

import { isReleaseVersion } from "@stigmer/plugin-package/client";
import {
  loadTemporalConnectionConfig,
  TEMPORAL_CONNECTION_ENV_NAMES,
} from "@stigmer/temporal-codecs";
import type { TemporalConnectionConfig } from "@stigmer/temporal-codecs";

import { SERVER_VERSION } from "../domain/platform/version.js";
import {
  SANDBOX_CLEARED_RUNNER_ENV,
  SANDBOX_DRIVER_OWNED_RUNNER_ENV,
  SANDBOX_DRIVERS_WITHOUT_RUNNER_IMAGE,
  SANDBOX_IMAGE_DRIVER_OWNED_RUNNER_ENV,
} from "../sandbox/provisioner.js";
import { RUNNER_SECRET_NAMES } from "../sandbox/runner-secret-names.js";

export interface ServerConfig {
  /** Unified transport port: gRPC, gRPC-Web, Connect, and the REST lanes. */
  readonly grpcPort: number;
  /** Log level threshold: debug | info | warn | error (default info). */
  readonly logLevel: string;
  /** Deployment environment; "local" selects human-readable log output. */
  readonly env: string;
  /** Origin the model-registry background refresh fetches from. */
  readonly modelRegistryUpstream: string;
  /** The refresh is on unless STIGMER_MODEL_REGISTRY_REFRESH=off. */
  readonly modelRegistryRefreshEnabled: boolean;
  /**
   * Where the process announces the ports its listeners bound, once it is
   * listening (STIGMER_READY_LINE). Only the word "stdout" turns it on;
   * otherwise the process writes nothing to stdout. The line and why it
   * exists: boot/ready-line.ts.
   */
  readonly readyLine: "stdout" | undefined;
  /** SQLite database file (DB_PATH; Go defaultDBPath ~/.stigmer/stigmer.db). */
  readonly dbPath: string;
  /**
   * Postgres connection URL (DATABASE_URL). PRECEDENCE: when set
   * (non-empty), the Postgres driver is selected and dbPath is ignored —
   * DB_PATH always has a value (it defaults), so "Postgres wins" is the
   * only order under which DATABASE_URL can select anything. "" = sqlite,
   * the laptop-tier default; there is no half-configured state to
   * validate (the URL's reachability is proven by the boot connect, which
   * fails loudly).
   */
  readonly databaseUrl: string;
  /**
   * Operator identity for audit stamping (stigmer/stigmer#400). Empty email
   * keeps the "system" placeholder; the runner demotes that to anonymous.
   */
  readonly operatorEmail: string;
  readonly operatorName: string;
  /**
   * Temporal coordinates this server runs against (Go TemporalHostPort/
   * TemporalNamespace). The Temporal workers read the same fields;
   * connection failure is NON-fatal (the server serves with the engine
   * unavailable and the TemporalManager's health monitor keeps retrying —
   * Go server.go InitialConnect posture). The address runners are told to
   * dial is a separate fact: runnerBootstrapTemporalAddress below.
   */
  readonly temporalHostPort: string;
  readonly temporalNamespace: string;
  /**
   * How both Temporal connections authenticate to that frontend: TLS,
   * mutual TLS or an API key, read from the `STIGMER_TEMPORAL_*` settings
   * by `@stigmer/temporal-codecs`' `loadTemporalConnectionConfig` (its
   * header lists them and says why they are not Temporal's own names).
   * `{}` is today's plaintext connection. A contradictory or unreadable
   * setting fails the boot, like OIDC's half configuration.
   */
  readonly temporalConnection: TemporalConnectionConfig;
  /**
   * The Temporal address getRunnerBootstrapConfig publishes to runners
   * that discover their coordinates from this server instead of being
   * given them (STIGMER_RUNNER_BOOTSTRAP_TEMPORAL_ADDRESS; stigmer#1357).
   * Defaults to TEMPORAL_HOST_PORT — right whenever those runners share
   * this server's network (a laptop, the compose stack, the chart). Set
   * it when they do not: a server in a cluster that dials Temporal by its
   * internal service name, and a desktop runner that must dial the
   * frontend's external ingress. The namespace is not split; one
   * namespace is served on every ingress. Sandboxes are told their
   * address by the provisioner (sandboxTemporalAddress), never by this.
   */
  readonly runnerBootstrapTemporalAddress: string;
  /**
   * Artifact blob storage (attachments + execution outputs; Go
   * config.ArtifactStorage). "local" is the OSS default; "r2" selects
   * Cloudflare R2 with the settings below.
   */
  readonly artifactStorageType: string;
  /** The artifact root — shared with the runner's LOCAL_ARTIFACT_PATH (#285). */
  readonly artifactLocalBasePath: string;
  /**
   * Base URL for local artifact download URLs (ARTIFACT_LOCAL_SERVE_URL);
   * no trailing path segment (the storage key carries the full path).
   * "" = unset: the URL follows the port the artifact file server actually
   * bound (boot/artifact-lane.ts), so an ephemeral lane mints URLs that
   * reach it.
   */
  readonly artifactLocalServeUrl: string;
  /**
   * The artifact file server's own port (ARTIFACT_HTTP_PORT). Undefined =
   * unset: the lane follows the unified port, +1, or ephemeral when that
   * port is 0 — the rule lives in boot/artifact-lane.ts, because only the
   * composition knows the port the unified listener binds. Only bound when
   * artifact storage is local, and a lane that cannot bind fails the boot.
   */
  readonly artifactHttpPort: number | undefined;
  /**
   * The artifact file server's bind host (ARTIFACT_HTTP_HOST;
   * shipped with the Docker image). Defaults to 127.0.0.1 —
   * the retired Go server's posture, byte-identical for every bare-metal
   * install: download URLs are minted for the local machine. Containers
   * set 0.0.0.0 (the official image does, with its rationale) because a
   * loopback bind is unreachable through the container boundary even
   * with the port published.
   */
  readonly artifactHttpHost: string;
  /** Cloudflare R2 settings (S3-compatible; validated when type is "r2"). */
  readonly r2Bucket: string;
  readonly r2Endpoint: string;
  readonly r2AccessKeyId: string;
  readonly r2SecretAccessKey: string;
  readonly r2Region: string;
  /**
   * GitHub OAuth credentials for workspace repo selection (the github
   * broker domain). Override via STIGMER_GITHUB_CLIENT_ID /
   * STIGMER_GITHUB_CLIENT_SECRET — an empty value is treated as unset
   * (Go getEnvString), so no configuration can blank the bundled
   * defaults on OSS.
   */
  readonly gitHubOAuthClientId: string;
  readonly gitHubOAuthClientSecret: string;
  /**
   * The OAuth callback URL for the McpServer OAuth Connect flows
   * (STIGMER_OAUTH_REDIRECT_URI; Go config.go OAuthRedirectURI). Unset, a
   * server that serves the web console on its unified port derives the
   * console's own callback page on the origin browsers reach it on:
   * SKILL_TRANSFER_BASE_URL when set (the address a team install was told
   * its clients use, stigmer#1200), else `http://localhost:<port>`
   * (boot/oauth-redirect-uri.ts), so neither a team install nor a local one
   * has to be told. Unset on a server that serves no
   * console is a WARN at wiring time, not a boot failure — every RPC except
   * initiateOAuthConnect works without it, and initiate refuses with a
   * FailedPrecondition naming the variable (the pinned copy).
   */
  readonly oauthRedirectUri: string;
  /**
   * Skill artifact storage root (STORAGE_PATH; Go defaultStoragePath
   * ~/.stigmer/storage). Artifacts live at {storagePath}/skills/ —
   * byte-identical to Go's layout, so a Go-written directory is served in
   * place at cutover — and upload staging at {storagePath}/skills/staging/,
   * the prefix the domain names (domain/skill/constants.ts).
   */
  readonly storagePath: string;
  /**
   * Skill artifact storage backend (SKILL_ARTIFACT_STORAGE_TYPE) — the
   * per-domain opt-in, deliberately SEPARATE from
   * ARTIFACT_STORAGE_TYPE: skill artifacts stay on the local storagePath
   * root (the Go-written-directory serving invariant) regardless of the
   * generic artifact store's backend, until a deployment opts skill in
   * here explicitly. "" or "local" is today's local arm; "r2" shares the
   * artifact store's R2 settings; any other name selects a
   * composition-registered driver.
   */
  readonly skillArtifactStorageType: string;
  /**
   * Externally-reachable base of the skill artifact transfer lane's
   * capability URLs (#675; SKILL_TRANSFER_BASE_URL), set when the server
   * is reached through a tunnel or reverse proxy (the
   * ARTIFACT_LOCAL_SERVE_URL idiom, Go config.go:52-58). "" = unset: the
   * base is the server's own port on localhost, read from the port the
   * unified listener actually binds (boot/skill-transfer-origin.ts), so a
   * server on an ephemeral port mints URLs that reach it (stigmer#1386).
   * It is the unified port's public origin, so the served console's MCP
   * OAuth callback derives on it too (boot/oauth-redirect-uri.ts).
   */
  readonly skillTransferBaseUrl: string;
  /**
   * Web console asset directory override (STIGMER_CONSOLE_DIR). Empty —
   * the default — discovers the export as a `console/` sibling of the
   * running bundle (slim artifacts ship it there; dev dist trees have
   * none, so dev/test servers boot without the console lane). The
   * override serves a local `client-apps/web/out` build in development
   * and pins fixture exports in tests.
   */
  readonly consoleDir: string;
  /**
   * The OIDC issuer URL (STIGMER_OIDC_ISSUER) — THE auth-enabled switch
   * non-empty registers the OSS
   * identity verifiers (API tokens + OIDC) on the chassis and turns on
   * the require-authentication posture (absent token → UNAUTHENTICATED
   * except is_public methods — the Java interceptor's
   * posture). Empty — the default — is the trusted-local single-operator
   * state, byte-identical to the wire behavior before authentication
   * existed. Any OIDC issuer works here: sign-in is configuration, not
   * code.
   */
  readonly oidcIssuer: string;
  /**
   * The audience OIDC access tokens must carry (STIGMER_OIDC_AUDIENCE).
   * Required whenever the issuer is set — a verifier that skipped
   * audience validation would accept any token the issuer ever minted
   * for any other service (the confused-deputy failure). Half-configured
   * OIDC is boot-fatal, the R2/operator-identity loud-fail precedent.
   */
  readonly oidcAudience: string;
  /**
   * The OAuth client the served web console signs in with
   * (STIGMER_OIDC_CONSOLE_CLIENT_ID):
   * a PUBLIC client the operator registers at the issuer for the browser's
   * Authorization Code + PKCE flow — a public identifier, never a secret.
   * Deliberately lenient beside the two boot-fatal OIDC fields: a
   * self-host that set the issuer before this knob existed, and uses the
   * CLI and SDKs with API keys, must keep booting on upgrade. Empty means
   * the console cannot sign in; the composition root WARNs and the served
   * console says so itself. Named for the console on purpose — a
   * future CLI or desktop sign-in against a self-host is a different
   * client type (loopback/native) and should not be tempted to reuse it.
   */
  readonly oidcConsoleClientId: string;
  /**
   * Sandbox provisioner driver (SANDBOX_PROVISIONER_TYPE). ""
   * — the default — is the external-runner posture: no provisioner is
   * constructed and an operator-managed runner polls the queues (today's
   * behavior, named). "local-process" / "docker" / "kubernetes" select
   * the built-in isolation tiers (weakest to strongest); any other name
   * selects a composition-registered driver, and an unknown name is a
   * boot throw. Routing coherence (a selected driver requires at least
   * one per-queue routing mode) is validated in compose.ts where the
   * temporal configs live — one definition, oss#397's discipline.
   */
  readonly sandboxProvisionerType: string;
  /**
   * The server endpoint as reachable FROM INSIDE a provisioned sandbox
   * (STIGMER_SANDBOX_BACKEND_ENDPOINT) — a container cannot use this
   * process's localhost. Required (boot-fatal in compose.ts) when a
   * container-based provisioner is selected; ignored on the default arm.
   */
  readonly sandboxBackendEndpoint: string;
  /**
   * The server's public address as a remote MCP server reaches it
   * (STIGMER_SANDBOX_MCP_PUBLIC_ENDPOINT), handed to every provisioned
   * sandbox's runner as STIGMER_MCP_PUBLIC_ENDPOINT
   * (sandbox/provisioner.ts, SandboxDriverConfig.mcpPublicEndpoint).
   * Optional: empty hands nothing, and remote servers that template
   * STIGMER_SERVER_ADDRESS get no address.
   */
  readonly sandboxMcpPublicEndpoint: string;
  /**
   * Temporal address as reachable from inside a sandbox
   * (STIGMER_SANDBOX_TEMPORAL_ADDRESS). Defaults to TEMPORAL_HOST_PORT —
   * right whenever both resolve the same way (host networking,
   * cluster-internal DNS); overridden when the sandbox network differs.
   */
  readonly sandboxTemporalAddress: string;
  /**
   * The runner image container-based provisioners launch
   * (STIGMER_SANDBOX_RUNNER_IMAGE). The default is the published sandbox
   * image of this server's release (defaultSandboxRunnerImage).
   */
  readonly sandboxRunnerImage: string;
  /**
   * The runner executable the local-process driver spawns
   * (STIGMER_SANDBOX_RUNNER_COMMAND). The default is the npm-distributed
   * `stigmer-runner` binary on PATH.
   */
  readonly sandboxRunnerCommand: string;
  /**
   * The namespace the kubernetes driver provisions into
   * (STIGMER_SANDBOX_K8S_NAMESPACE) — one shared namespace, never
   * per-sandbox namespaces (the cloud provisioner's verified posture).
   */
  readonly sandboxKubernetesNamespace: string;
  /**
   * The runner's own settings every provisioned sandbox receives
   * (STIGMER_SANDBOX_RUNNER_ENV: a comma-separated list of variable names,
   * each value read from this server's environment at boot). For values
   * that are not secret, such as a model gateway's address
   * (ANTHROPIC_BASE_URL). Every driver delivers them the way it delivers
   * its other plain settings (sandbox/provisioner.ts,
   * SandboxDriverConfig.runnerEnv).
   */
  readonly sandboxRunnerEnv: Readonly<Record<string, string>>;
  /**
   * The runner's secrets every provisioned sandbox receives
   * (STIGMER_SANDBOX_RUNNER_SECRETS, the same list form), such as the
   * direct-mode model and Cursor keys an open-source runner authenticates
   * with: a runner outside the cloud has no proxy to hold them for it
   * (the runner's config.ts, "Direct mode"). Every driver delivers them
   * through the channel it uses for the runner's token, never a plain
   * manifest value or argv.
   */
  readonly sandboxRunnerSecretEnv: Readonly<Record<string, string>>;
}

// The bundled "Stigmer Local" OAuth App credentials (callback:
// localhost:3000), hardcoded in source following the GitHub CLI (gh)
// pattern: a localhost-only OAuth App's client_secret has negligible
// security value. Byte-mirrored from Go pkg/config/config.go. Release
// bundles may stamp the Cloud OAuth App via the esbuild defines in
// scripts/bundle-slim.mjs — the ldflags equivalent.
declare const __STIGMER_GITHUB_CLIENT_ID__: string | undefined;
declare const __STIGMER_GITHUB_CLIENT_SECRET__: string | undefined;

const DEFAULT_GITHUB_OAUTH_CLIENT_ID: string =
  typeof __STIGMER_GITHUB_CLIENT_ID__ === "string" &&
  __STIGMER_GITHUB_CLIENT_ID__ !== ""
    ? __STIGMER_GITHUB_CLIENT_ID__
    : "Ov23li4q5kgj90QMr226";
const DEFAULT_GITHUB_OAUTH_CLIENT_SECRET: string =
  typeof __STIGMER_GITHUB_CLIENT_SECRET__ === "string" &&
  __STIGMER_GITHUB_CLIENT_SECRET__ !== ""
    ? __STIGMER_GITHUB_CLIENT_SECRET__
    : "edc089d10b6cc0dcee898f9680d62d1504e2c89a";

/** Default unified port; the CLI's env contract pins the same value. */
export const DEFAULT_GRPC_PORT = 7234;

/** Default model-registry origin (model_registry_store.go). */
export const DEFAULT_MODEL_REGISTRY_UPSTREAM = "https://api.stigmer.ai";

/**
 * The sandbox runner image this server launches when the operator names
 * none: the image of its own release, `ghcr.io/stigmer/runner:v<version>`
 * (release.sandbox-cloud.yaml tags one per release, `X.Y.Z` and
 * `X.Y.Z-rc.N`), because the launch command (sandbox/runner-launch.ts) is
 * a contract between a server and the image it starts, and `latest` moves
 * on every runner change to `main`. Only a bundled server knows its version
 * (the release lane stamps SERVER_VERSION into the server image, the
 * all-in-one image and @stigmer/server-slim); the @stigmer/server library
 * and an unbundled build report `dev`, and a dev-channel stamp has no
 * published image, so those fall back to `latest`, and a composition that
 * embeds the library names its image itself (the cloud selects the image
 * of the release it pins). isReleaseVersion is the one test of which
 * versions the release lane publishes.
 */
export function defaultSandboxRunnerImage(
  serverVersion: string = SERVER_VERSION,
): string {
  return isReleaseVersion(serverVersion)
    ? `ghcr.io/stigmer/runner:v${serverVersion}`
    : "ghcr.io/stigmer/runner:latest";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const { operatorEmail, operatorName } = loadOperatorIdentity(env);
  const grpcPort = envInt(env, "GRPC_PORT", DEFAULT_GRPC_PORT);
  // Unset (or malformed, the loader's leniency) leaves the lane to follow
  // the unified port; boot/artifact-lane.ts derives it at composition.
  const artifactHttpPort = envOptionalInt(env, "ARTIFACT_HTTP_PORT");
  const artifactHttpHost = envString(env, "ARTIFACT_HTTP_HOST", "127.0.0.1");
  const artifactStorageType = envString(env, "ARTIFACT_STORAGE_TYPE", "local");
  const r2 = {
    r2Bucket: envString(env, "R2_BUCKET", ""),
    r2Endpoint: envString(env, "R2_ENDPOINT", ""),
    r2AccessKeyId: envString(env, "R2_ACCESS_KEY_ID", ""),
    r2SecretAccessKey: envString(env, "R2_SECRET_ACCESS_KEY", ""),
    r2Region: envString(env, "R2_REGION", "auto"),
  };
  const skillArtifactStorageType = envString(
    env,
    "SKILL_ARTIFACT_STORAGE_TYPE",
    "",
  );
  // Go validateR2Config: boot-fatal on incomplete r2 configuration — a
  // second deliberate exception to the lenient-loader posture (a server
  // that silently ignored half an R2 config would write blobs nowhere).
  // Skill's per-domain knob shares the settings, so its r2 arm gets
  // the same completeness gate.
  if (artifactStorageType === "r2" || skillArtifactStorageType === "r2") {
    validateR2Config(r2);
  }
  return {
    grpcPort,
    artifactHttpPort,
    artifactHttpHost,
    ...r2,
    temporalHostPort: envString(env, "TEMPORAL_HOST_PORT", "localhost:7233"),
    temporalNamespace: envString(env, "TEMPORAL_NAMESPACE", "default"),
    temporalConnection: loadTemporalConnectionConfig((name) => env[name]),
    runnerBootstrapTemporalAddress: envString(
      env,
      "STIGMER_RUNNER_BOOTSTRAP_TEMPORAL_ADDRESS",
      envString(env, "TEMPORAL_HOST_PORT", "localhost:7233"),
    ),
    artifactStorageType,
    artifactLocalBasePath: envString(
      env,
      "ARTIFACT_LOCAL_BASE_PATH",
      defaultArtifactPath(),
    ),
    artifactLocalServeUrl: envString(env, "ARTIFACT_LOCAL_SERVE_URL", ""),
    logLevel: envString(env, "LOG_LEVEL", "info"),
    env: envString(env, "ENV", "local"),
    modelRegistryUpstream: envString(
      env,
      "STIGMER_MODEL_REGISTRY_UPSTREAM",
      DEFAULT_MODEL_REGISTRY_UPSTREAM,
    ),
    // Only the literal "off" disables the refresh — any other value keeps
    // the default-on behavior, exactly as Go tests the variable.
    modelRegistryRefreshEnabled:
      env["STIGMER_MODEL_REGISTRY_REFRESH"] !== "off",
    // A word, like the refresh switch above: the value names where the line
    // goes, and anything else leaves stdout untouched.
    readyLine: env["STIGMER_READY_LINE"] === "stdout" ? "stdout" : undefined,
    dbPath: envString(env, "DB_PATH", defaultDbPath()),
    databaseUrl: envString(env, "DATABASE_URL", ""),
    storagePath: envString(env, "STORAGE_PATH", defaultStoragePath()),
    skillArtifactStorageType,
    skillTransferBaseUrl: envString(env, "SKILL_TRANSFER_BASE_URL", ""),
    operatorEmail,
    operatorName,
    gitHubOAuthClientId: envString(
      env,
      "STIGMER_GITHUB_CLIENT_ID",
      DEFAULT_GITHUB_OAUTH_CLIENT_ID,
    ),
    gitHubOAuthClientSecret: envString(
      env,
      "STIGMER_GITHUB_CLIENT_SECRET",
      DEFAULT_GITHUB_OAUTH_CLIENT_SECRET,
    ),
    oauthRedirectUri: envString(env, "STIGMER_OAUTH_REDIRECT_URI", ""),
    consoleDir: envString(env, "STIGMER_CONSOLE_DIR", ""),
    ...loadOidcConfig(env),
    oidcConsoleClientId: envString(env, "STIGMER_OIDC_CONSOLE_CLIENT_ID", ""),
    sandboxProvisionerType: envString(env, "SANDBOX_PROVISIONER_TYPE", ""),
    sandboxBackendEndpoint: envString(
      env,
      "STIGMER_SANDBOX_BACKEND_ENDPOINT",
      "",
    ),
    sandboxMcpPublicEndpoint: envString(
      env,
      "STIGMER_SANDBOX_MCP_PUBLIC_ENDPOINT",
      "",
    ),
    sandboxTemporalAddress: envString(
      env,
      "STIGMER_SANDBOX_TEMPORAL_ADDRESS",
      envString(env, "TEMPORAL_HOST_PORT", "localhost:7233"),
    ),
    sandboxRunnerImage: envString(
      env,
      "STIGMER_SANDBOX_RUNNER_IMAGE",
      defaultSandboxRunnerImage(),
    ),
    sandboxRunnerCommand: envString(
      env,
      "STIGMER_SANDBOX_RUNNER_COMMAND",
      "stigmer-runner",
    ),
    sandboxKubernetesNamespace: envString(
      env,
      "STIGMER_SANDBOX_K8S_NAMESPACE",
      "stigmer-sandboxes",
    ),
    ...loadSandboxRunnerEnv(env),
  };
}

/**
 * OIDC issuer/audience — boot-FATAL on the two certain
 * misconfigurations, joining the operator-identity and R2 exceptions to
 * the lenient-loader posture: an issuer that is not an http(s) URL can
 * never complete discovery, and an issuer without an audience (or the
 * reverse) is half an auth configuration — silently serving trusted-local
 * when the operator believes authentication is on would be a security
 * failure, not a convenience.
 */
function loadOidcConfig(env: NodeJS.ProcessEnv): {
  oidcIssuer: string;
  oidcAudience: string;
} {
  const issuer = (env["STIGMER_OIDC_ISSUER"] ?? "").trim();
  const audience = (env["STIGMER_OIDC_AUDIENCE"] ?? "").trim();
  if (issuer === "" && audience === "") {
    return { oidcIssuer: "", oidcAudience: "" };
  }
  if (issuer === "" || audience === "") {
    throw new Error(
      "incomplete OIDC configuration: STIGMER_OIDC_ISSUER and STIGMER_OIDC_AUDIENCE must be set together — set both or neither",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(issuer);
  } catch {
    throw new Error(
      `STIGMER_OIDC_ISSUER "${issuer}" is not a valid URL — OIDC discovery requires the issuer's https URL`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `STIGMER_OIDC_ISSUER "${issuer}" must be an http(s) URL — OIDC discovery requires it`,
    );
  }
  return { oidcIssuer: issuer, oidcAudience: audience };
}

/** Go validateR2Config — the four required fields, error copy mirrored. */
function validateR2Config(r2: {
  r2Bucket: string;
  r2Endpoint: string;
  r2AccessKeyId: string;
  r2SecretAccessKey: string;
}): void {
  const requirements: Array<[string, string]> = [
    [r2.r2Bucket, "R2_BUCKET"],
    [r2.r2Endpoint, "R2_ENDPOINT"],
    [r2.r2AccessKeyId, "R2_ACCESS_KEY_ID"],
    [r2.r2SecretAccessKey, "R2_SECRET_ACCESS_KEY"],
  ];
  for (const [value, name] of requirements) {
    if (value === "") {
      throw new Error(
        `invalid R2 configuration: ${name} is required when ARTIFACT_STORAGE_TYPE=r2`,
      );
    }
  }
}

/** Go defaultStoragePath: ~/.stigmer/storage, ./storage without a home. */
function defaultStoragePath(): string {
  try {
    return path.join(os.homedir(), ".stigmer", "storage");
  } catch {
    return "./storage";
  }
}

/** Go defaultDBPath: ~/.stigmer/stigmer.db, ./stigmer.db without a home. */
function defaultDbPath(): string {
  try {
    return path.join(os.homedir(), ".stigmer", "stigmer.db");
  } catch {
    return "./stigmer.db";
  }
}

/** Go defaultArtifactPath: ~/.stigmer/data/artifacts, ./artifacts without a home. */
function defaultArtifactPath(): string {
  try {
    return path.join(os.homedir(), ".stigmer", "data", "artifacts");
  } catch {
    return "./artifacts";
  }
}

/**
 * The two sandbox runner lists — boot-FATAL on the misconfigurations a
 * lenient read would turn into a runner that boots without its key and
 * fails every turn at its first model call: a listed name with no value
 * here, a name on both lists (plain and secret at once), and one of the
 * runner's secrets on the plain list (sandbox/runner-secret-names.ts). Names are
 * environment variable names, and never one a driver sets itself
 * (SANDBOX_DRIVER_OWNED_RUNNER_ENV and the Temporal connection names): a
 * list must not be able to replace a sandbox's queue, token or endpoints.
 * Under a driver that starts a runner image (every driver but
 * SANDBOX_DRIVERS_WITHOUT_RUNNER_IMAGE), nor HOME, which that driver sets
 * (SANDBOX_IMAGE_DRIVER_OWNED_RUNNER_ENV), nor a Node setting the runner
 * layer clears at start (SANDBOX_CLEARED_RUNNER_ENV), which would never
 * reach the runner; `local-process` passes all three through.
 */
function loadSandboxRunnerEnv(env: NodeJS.ProcessEnv): {
  sandboxRunnerEnv: Readonly<Record<string, string>>;
  sandboxRunnerSecretEnv: Readonly<Record<string, string>>;
} {
  const plain = sandboxRunnerList(env, "STIGMER_SANDBOX_RUNNER_ENV");
  const secret = sandboxRunnerList(env, "STIGMER_SANDBOX_RUNNER_SECRETS");
  const driver = envString(env, "SANDBOX_PROVISIONER_TYPE", "");
  if (!SANDBOX_DRIVERS_WITHOUT_RUNNER_IMAGE.includes(driver)) {
    for (const [key, list] of [
      ["STIGMER_SANDBOX_RUNNER_ENV", plain],
      ["STIGMER_SANDBOX_RUNNER_SECRETS", secret],
    ] as const) {
      for (const name of Object.keys(list)) {
        if (SANDBOX_IMAGE_DRIVER_OWNED_RUNNER_ENV.includes(name)) {
          throw new Error(
            `${key} lists ${name}, which the ${driver} sandbox driver sets itself — remove it from the list`,
          );
        }
        if (SANDBOX_CLEARED_RUNNER_ENV.includes(name)) {
          throw new Error(
            `${key} lists ${name}, which the runner layer clears when the runner starts, so the runner's Node and the commands its agents run never see it — remove it from the list`,
          );
        }
      }
    }
  }
  for (const name of Object.keys(plain)) {
    if (RUNNER_SECRET_NAMES.includes(name)) {
      throw new Error(
        `STIGMER_SANDBOX_RUNNER_ENV lists ${name}, one of the runner's secrets — a driver writes plain settings where anyone reading the sandbox's definition sees them; list it in STIGMER_SANDBOX_RUNNER_SECRETS`,
      );
    }
  }
  for (const name of Object.keys(plain)) {
    if (name in secret) {
      throw new Error(
        `${name} is listed in both STIGMER_SANDBOX_RUNNER_ENV and STIGMER_SANDBOX_RUNNER_SECRETS — a sandbox receives it one way; keep it in one list`,
      );
    }
  }
  return { sandboxRunnerEnv: plain, sandboxRunnerSecretEnv: secret };
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function sandboxRunnerList(
  env: NodeJS.ProcessEnv,
  key: string,
): Readonly<Record<string, string>> {
  const values: Record<string, string> = {};
  for (const raw of (env[key] ?? "").split(",")) {
    const name = raw.trim();
    if (name === "") {
      continue;
    }
    if (!ENV_NAME.test(name)) {
      throw new Error(
        `${key} lists "${name}", which is not an environment variable name`,
      );
    }
    if (
      SANDBOX_DRIVER_OWNED_RUNNER_ENV.includes(name) ||
      TEMPORAL_CONNECTION_ENV_NAMES.includes(name)
    ) {
      throw new Error(
        `${key} lists ${name}, which every sandbox driver sets itself — remove it from the list`,
      );
    }
    const value = env[name];
    if (value === undefined || value === "") {
      throw new Error(
        `${key} lists ${name}, but this server's environment does not set it — set it or remove it from the list`,
      );
    }
    values[name] = value;
  }
  return values;
}

/**
 * Go loadOperatorIdentity (#400): boot-FATAL on the two certain
 * misconfigurations, deliberately unlike the lenient loaders above — an
 * email without '@' can never be deliverable (certainly a typo), and a
 * name without an email is incoherent (the email IS the identity). The
 * error copy matches Go's character-for-character.
 */
function loadOperatorIdentity(env: NodeJS.ProcessEnv): {
  operatorEmail: string;
  operatorName: string;
} {
  const email = (env["STIGMER_OPERATOR_EMAIL"] ?? "").trim();
  const name = (env["STIGMER_OPERATOR_NAME"] ?? "").trim();
  if (email !== "" && !email.includes("@")) {
    throw new Error(
      `STIGMER_OPERATOR_EMAIL "${email}" is not an email address (missing '@') — fix or unset it`,
    );
  }
  if (email === "" && name !== "") {
    throw new Error(
      "STIGMER_OPERATOR_NAME is set but STIGMER_OPERATOR_EMAIL is not — the email is the identity; set both or neither",
    );
  }
  return { operatorEmail: email, operatorName: name };
}

function envString(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: string,
): string {
  const value = env[key];
  return value !== undefined && value !== "" ? value : fallback;
}

function envInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  return envOptionalInt(env, key) ?? fallback;
}

/** An integer setting, or undefined when it is unset or malformed. */
function envOptionalInt(
  env: NodeJS.ProcessEnv,
  key: string,
): number | undefined {
  const value = env[key];
  if (value === undefined || value === "") {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  // Go's strconv.Atoi rejects trailing garbage ("7234x"); Number.parseInt
  // would accept it, so the round-trip check keeps the two loaders aligned.
  return Number.isSafeInteger(parsed) && String(parsed) === value.trim()
    ? parsed
    : undefined;
}
