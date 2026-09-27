/**
 * Temporal connection security: how a Stigmer process authenticates to the
 * Temporal frontend it dials. The server's client and worker connections
 * and the runner's worker connection all read it, so it lives here, in the
 * one library both processes share. Unset means today's plaintext
 * connection, unchanged.
 *
 * The settings (each `_PATH` item has a `_DATA` twin holding the PEM text):
 *
 *   STIGMER_TEMPORAL_API_KEY                    bearer key; implies TLS
 *   STIGMER_TEMPORAL_TLS                        "true" or "1": TLS with the
 *                                               system's trusted roots
 *   STIGMER_TEMPORAL_TLS_SERVER_NAME            SNI / host-name override
 *   STIGMER_TEMPORAL_TLS_SERVER_CA_CERT_PATH    the frontend's CA (implies TLS)
 *   STIGMER_TEMPORAL_TLS_CLIENT_CERT_PATH       mutual TLS: the client's
 *   STIGMER_TEMPORAL_TLS_CLIENT_KEY_PATH          certificate and key, together
 *
 * WHY Stigmer's own names, not Temporal's `TEMPORAL_API_KEY` and
 * `TEMPORAL_TLS_*`: those belong to the user's own Temporal work. A local
 * Stigmer (`stigmer up`) inherits the user's shell, and agents that build
 * Temporal applications export `TEMPORAL_API_KEY` for their own namespaces.
 * Reading it would present the user's key to Stigmer's own Temporal and,
 * through the runner's secret custody, take it away from the agents that
 * need it. The shape follows Temporal's so an operator recognises it.
 *
 * WHY not Temporal's reader (`@temporalio/envconfig`): at the SDK version
 * every Stigmer package pins (1.16.2), it reads `TEMPORAL_TLS=true` as TLS
 * disabled. Releases before 1.22.0 carry that inversion. It also ignores
 * host-verification settings, and it reads the user's own Temporal profile
 * file by default.
 *
 * Misconfiguration fails the boot, the posture of the payload-encryption
 * config beside this module: an operator who set half a client pair, or
 * the same item twice, believes the connection is authenticated, and a
 * silently weaker connection would be a security failure. An empty value
 * means unset, so a blank line in a deployment's environment turns nothing
 * on.
 *
 * Values are read through an injected {@link SecretReader}, as the
 * encryption keys are: secret custody is the consumer's policy. The runner
 * passes its credential store's reader, so the API key and the client key
 * never live in an environment its agent tools can read.
 */

import { readFileSync } from "node:fs";

import type { SecretReader } from "../encryption/config.js";

/**
 * TLS settings in the Temporal SDK's own shape (`TLSConfig` in
 * `@temporalio/common`), declared structurally so this library imports
 * nothing internal. An empty object means TLS with the system's roots.
 */
export interface TemporalTls {
  readonly serverNameOverride?: string;
  readonly serverRootCACertificate?: Uint8Array;
  readonly clientCertPair?: {
    readonly crt: Uint8Array;
    readonly key: Uint8Array;
  };
}

/**
 * What a connection needs beyond its address. Both fields are absent for a
 * plaintext connection; spread it into `Connection.connect` or
 * `NativeConnection.connect` as is.
 */
export interface TemporalConnectionConfig {
  readonly tls?: TemporalTls;
  readonly apiKey?: string;
}

export const TEMPORAL_API_KEY_ENV = "STIGMER_TEMPORAL_API_KEY";
export const TEMPORAL_TLS_ENV = "STIGMER_TEMPORAL_TLS";
export const TEMPORAL_TLS_SERVER_NAME_ENV = "STIGMER_TEMPORAL_TLS_SERVER_NAME";

/** The PEM items, each settable as a file path or as its text. */
const PEM_ITEMS = {
  serverCa: "STIGMER_TEMPORAL_TLS_SERVER_CA_CERT",
  clientCert: "STIGMER_TEMPORAL_TLS_CLIENT_CERT",
  clientKey: "STIGMER_TEMPORAL_TLS_CLIENT_KEY",
} as const;

/**
 * The `_DATA` name of the client key: a credential, which the runner takes
 * into custody beside the API key (its `_PATH` twin names a file, not a
 * secret).
 */
export const TEMPORAL_TLS_CLIENT_KEY_DATA_ENV = `${PEM_ITEMS.clientKey}_DATA`;

/**
 * Every setting name this module reads, exactly. A process that hands its
 * children their own rendered settings ({@link temporalConnectionEnv})
 * removes these from what the child inherits; other `STIGMER_TEMPORAL_*`
 * names (the CLI's own) are not connection settings.
 */
export const TEMPORAL_CONNECTION_ENV_NAMES: readonly string[] = [
  TEMPORAL_API_KEY_ENV,
  TEMPORAL_TLS_ENV,
  TEMPORAL_TLS_SERVER_NAME_ENV,
  ...Object.values(PEM_ITEMS).flatMap((item) => [`${item}_PATH`, `${item}_DATA`]),
];

/**
 * Loads the connection settings.
 *
 * @throws when a setting is contradictory or unreadable: a client
 *   certificate without its key (or the reverse), both the `_PATH` and the
 *   `_DATA` form of one item, a path that cannot be read, or a
 *   `STIGMER_TEMPORAL_TLS` that is neither true nor false.
 */
export function loadTemporalConnectionConfig(
  read: SecretReader,
): TemporalConnectionConfig {
  const value = (name: string): string | undefined => {
    const raw = read(name);
    return raw === undefined || raw.trim() === "" ? undefined : raw;
  };

  const apiKey = value(TEMPORAL_API_KEY_ENV)?.trim();
  const tlsFlag = parseFlag(value(TEMPORAL_TLS_ENV));
  const serverName = value(TEMPORAL_TLS_SERVER_NAME_ENV)?.trim();
  const serverCa = readPem(PEM_ITEMS.serverCa, value);
  const clientCert = readPem(PEM_ITEMS.clientCert, value);
  const clientKey = readPem(PEM_ITEMS.clientKey, value);

  if ((clientCert === undefined) !== (clientKey === undefined)) {
    throw new Error(
      `Temporal connection misconfigured: mutual TLS needs both ` +
        `${PEM_ITEMS.clientCert}_* and ${PEM_ITEMS.clientKey}_* — set both or neither`,
    );
  }

  const tlsRequested =
    tlsFlag === true ||
    apiKey !== undefined ||
    serverName !== undefined ||
    serverCa !== undefined ||
    clientCert !== undefined;
  if (tlsFlag === false && tlsRequested) {
    throw new Error(
      `Temporal connection misconfigured: ${TEMPORAL_TLS_ENV} is false while ` +
        `an API key, a server name, a CA or a client certificate is set — ` +
        `each of those needs TLS`,
    );
  }
  if (!tlsRequested) return {};

  const tls: TemporalTls = {
    ...(serverName !== undefined ? { serverNameOverride: serverName } : {}),
    ...(serverCa !== undefined ? { serverRootCACertificate: serverCa } : {}),
    ...(clientCert !== undefined && clientKey !== undefined
      ? { clientCertPair: { crt: clientCert, key: clientKey } }
      : {}),
  };
  return { tls, ...(apiKey !== undefined ? { apiKey } : {}) };
}

/**
 * Renders loaded settings back as the environment a child runner reads,
 * every PEM item in its `_DATA` form, so that no file has to exist where
 * the child runs. The server's sandbox drivers pass this to the runners
 * they start. Round-trips: loading the rendered environment yields the
 * same settings.
 */
export function temporalConnectionEnv(
  config: TemporalConnectionConfig,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (config.tls === undefined) return env;
  env[TEMPORAL_TLS_ENV] = "true";
  const text = (bytes: Uint8Array): string => Buffer.from(bytes).toString("utf8");
  const { serverNameOverride, serverRootCACertificate, clientCertPair } = config.tls;
  if (serverNameOverride !== undefined) env[TEMPORAL_TLS_SERVER_NAME_ENV] = serverNameOverride;
  if (serverRootCACertificate !== undefined) {
    env[`${PEM_ITEMS.serverCa}_DATA`] = text(serverRootCACertificate);
  }
  if (clientCertPair !== undefined) {
    env[`${PEM_ITEMS.clientCert}_DATA`] = text(clientCertPair.crt);
    env[TEMPORAL_TLS_CLIENT_KEY_DATA_ENV] = text(clientCertPair.key);
  }
  if (config.apiKey !== undefined) env[TEMPORAL_API_KEY_ENV] = config.apiKey;
  return env;
}

function parseFlag(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const flag = raw.trim().toLowerCase();
  if (flag === "true" || flag === "1") return true;
  if (flag === "false" || flag === "0") return false;
  throw new Error(
    `Temporal connection misconfigured: ${TEMPORAL_TLS_ENV} must be true, 1, false or 0, got "${raw}"`,
  );
}

function readPem(
  item: string,
  value: (name: string) => string | undefined,
): Uint8Array | undefined {
  const path = value(`${item}_PATH`);
  const data = value(`${item}_DATA`);
  if (path !== undefined && data !== undefined) {
    throw new Error(
      `Temporal connection misconfigured: set ${item}_PATH or ${item}_DATA, not both`,
    );
  }
  if (data !== undefined) return Buffer.from(data, "utf8");
  if (path === undefined) return undefined;
  try {
    return readFileSync(path.trim());
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Temporal connection misconfigured: ${item}_PATH "${path.trim()}" cannot be read (${reason})`,
    );
  }
}
