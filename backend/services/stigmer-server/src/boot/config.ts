/**
 * Server configuration — stage 1 of the composition root
 * (config → storage → temporal → controllers → routes → listen, D2 §2).
 *
 * Deliberately covers ONLY the env contract the transport scaffold consumes.
 * Go's full config surface (pkg/config/config.go) is ported alongside the
 * sub-projects that consume each entry — DB_PATH/STORAGE_PATH arrive with
 * storage (#4), Temporal pins with the workers, artifact storage with its
 * domain — so no config entry exists here before the code that reads it.
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
  /** SQLite database file (DB_PATH; Go defaultDBPath ~/.stigmer/stigmer.db). */
  readonly dbPath: string;
  /**
   * Postgres connection URL (DATABASE_URL; DD-010). PRECEDENCE: when set
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
   * TemporalNamespace). Published to embedded runners via the platform
   * domain's getRunnerBootstrapConfig — in OSS the server and its runners
   * are co-located, so the address the server dials is the one runners
   * dial too. The Temporal workers (#18) read the same fields; connection
   * failure is NON-fatal (the server serves with the engine unavailable
   * and the TemporalManager's health monitor keeps retrying — Go
   * server.go InitialConnect posture).
   */
  readonly temporalHostPort: string;
  readonly temporalNamespace: string;
  /**
   * Artifact blob storage (attachments + execution outputs; Go
   * config.ArtifactStorage). "local" is the OSS default; "r2" boot-fails
   * on this server until #13 (the owner-ratified deferral).
   */
  readonly artifactStorageType: string;
  /** The artifact root — shared with the runner's LOCAL_ARTIFACT_PATH (#285). */
  readonly artifactLocalBasePath: string;
  /**
   * Base URL for local artifact download URLs — the port+1 artifact file
   * server (#13); no trailing path segment (the storage key carries the
   * full path).
   */
  readonly artifactLocalServeUrl: string;
  /**
   * The artifact file server's own port (ARTIFACT_HTTP_PORT, default
   * grpcPort+1). Only bound when artifact storage is local.
   */
  readonly artifactHttpPort: number;
  /**
   * The artifact file server's bind host (ARTIFACT_HTTP_HOST, DD-013;
   * shipped with the Docker image, Phase-2 P4). Defaults to 127.0.0.1 —
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
   * (STIGMER_OAUTH_REDIRECT_URI; Go config.go OAuthRedirectURI). Unset is
   * a WARN at wiring time, not a boot failure — every RPC except
   * initiateOAuthConnect works without it, and initiate refuses with a
   * FailedPrecondition naming the variable (the pinned copy).
   */
  readonly oauthRedirectUri: string;
  /**
   * Skill artifact storage root (STORAGE_PATH; Go defaultStoragePath
   * ~/.stigmer/storage). Artifacts live at {storagePath}/skills/,
   * upload staging at {storagePath}/skills-staging/ — byte-identical to
   * Go's layout, so a Go-written directory is served in place at cutover.
   */
  readonly storagePath: string;
  /**
   * Skill artifact storage backend (SKILL_ARTIFACT_STORAGE_TYPE) — the
   * per-domain opt-in of §6b/O5, deliberately SEPARATE from
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
   * capability URLs (#675). Defaults to the server's own port on
   * localhost; SKILL_TRANSFER_BASE_URL overrides when the server is
   * reached through a tunnel or reverse proxy (the ARTIFACT_LOCAL_SERVE_URL
   * idiom, Go config.go:52-58).
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
   * (O3, 20260827.06, gate ruling Q1): non-empty registers the OSS
   * identity verifiers (API tokens + OIDC) on the chassis and turns on
   * the require-authentication posture (absent token → UNAUTHENTICATED
   * except is_public methods, ruling Q2 — the Java interceptor's
   * posture). Empty — the default — is the trusted-local single-operator
   * state, byte-identical to the pre-O3 wire behavior. For Stigmer Cloud
   * this is the Auth0 issuer URL: DD-003's "Auth0 is configuration, not
   * code", literally this field.
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const { operatorEmail, operatorName } = loadOperatorIdentity(env);
  const grpcPort = envInt(env, "GRPC_PORT", DEFAULT_GRPC_PORT);
  // Go: ARTIFACT_HTTP_PORT defaults to the gRPC port + 1.
  const artifactHttpPort = envInt(env, "ARTIFACT_HTTP_PORT", grpcPort + 1);
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
  // Skill's per-domain knob (O5) shares the settings, so its r2 arm gets
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
    artifactStorageType,
    artifactLocalBasePath: envString(
      env,
      "ARTIFACT_LOCAL_BASE_PATH",
      defaultArtifactPath(),
    ),
    artifactLocalServeUrl: envString(
      env,
      "ARTIFACT_LOCAL_SERVE_URL",
      `http://localhost:${artifactHttpPort}`,
    ),
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
    dbPath: envString(env, "DB_PATH", defaultDbPath()),
    databaseUrl: envString(env, "DATABASE_URL", ""),
    storagePath: envString(env, "STORAGE_PATH", defaultStoragePath()),
    skillArtifactStorageType,
    skillTransferBaseUrl: envString(
      env,
      "SKILL_TRANSFER_BASE_URL",
      `http://localhost:${grpcPort}`,
    ),
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
  };
}

/**
 * OIDC issuer/audience (O3 ruling Q1) — boot-FATAL on the two certain
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
  const value = env[key];
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  // Go's strconv.Atoi rejects trailing garbage ("7234x"); Number.parseInt
  // would accept it, so the round-trip check keeps the two loaders aligned.
  return Number.isSafeInteger(parsed) && String(parsed) === value.trim()
    ? parsed
    : fallback;
}
