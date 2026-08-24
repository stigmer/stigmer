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
   * dial too. The Temporal workers (#18) read the same fields.
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
   * GitHub OAuth credentials for workspace repo selection (the github
   * broker domain). Override via STIGMER_GITHUB_CLIENT_ID /
   * STIGMER_GITHUB_CLIENT_SECRET — an empty value is treated as unset
   * (Go getEnvString), so no configuration can blank the bundled
   * defaults on OSS.
   */
  readonly gitHubOAuthClientId: string;
  readonly gitHubOAuthClientSecret: string;
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
  return {
    grpcPort,
    temporalHostPort: envString(env, "TEMPORAL_HOST_PORT", "localhost:7233"),
    temporalNamespace: envString(env, "TEMPORAL_NAMESPACE", "default"),
    artifactStorageType: envString(env, "ARTIFACT_STORAGE_TYPE", "local"),
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
  };
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
