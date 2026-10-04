/**
 * The substrate driver's own settings (STIGMER_SANDBOX_SUBSTRATE_*), read
 * only when the driver is selected: an unselected driver reads nothing
 * (provisioner.ts, "factories, not instances"). The generic sandbox
 * settings every driver shares (the endpoints a sandbox dials, the runner
 * image, the runner lists) stay on SandboxDriverConfig; what is here is
 * where Agent Substrate is and how this server's sandboxes live on it.
 *
 * Every endpoint and credential is configuration, never a constant: the
 * Control API's address, its CA and server name, and the bearer token's
 * file (a projected ServiceAccount token in a cluster, a token minted for
 * Substrate's `ate-client` account elsewhere). A missing required value is
 * one boot throw naming the variable.
 *
 * The idle windows default to a pause after 5 idle minutes and a suspend
 * to storage at 5.5, chosen from measurements on a local Agent Substrate
 * cluster (kind, Substrate v0.3.0, 2026-10-03), timed from the server
 * accepting a message to the runner starting on it: a wake from storage
 * took 1.73 s at the 95th percentile and never more than 1.76 s, while a
 * sandbox paused for 1 to 25 minutes woke in 3.79 s at the 95th percentile
 * and once in 12 s, its paused state's restore growing with the pause. So
 * a sandbox stays paused only briefly before it is suspended, and the
 * sweep runs every 30 s, because a suspend lands on the pass after the
 * pause and the interval is what bounds how long a sandbox stays paused. Boot refuses
 * windows that would keep a sandbox paused for longer than
 * MAX_IN_PLACE_PAUSE_SECONDS, the longest a paused runner may sleep and
 * still renew its credential on waking (driver.ts).
 */
import { MAX_IN_PLACE_PAUSE_SECONDS } from "./limits.js";

/** Whether every actor may reach any HTTPS host through the egress gateway. */
export type SubstrateHttpsEgress = "all" | "none";

/** One cleartext destination an operator adds to every actor's policy. */
export interface SubstrateHttpDestination {
  readonly host: string;
  readonly port: number;
}

export interface SubstrateDriverSettings {
  /** The Control API, `https://host:port` (in a cluster, `https://api.ate-system.svc:443`). */
  readonly apiEndpoint: string;
  /** The name the Control API's certificate is checked against; "" uses the endpoint's host. */
  readonly apiServerName: string;
  /** PEM file of the CA the Control API's certificate chains to; "" uses the system roots. */
  readonly apiCaFile: string;
  /** File holding the bearer token, re-read when it changes (a projected token rotates). */
  readonly apiTokenFile: string;
  /** Substrate's router as this server reaches it, `http(s)://host[:port]`. */
  readonly routerUrl: string;
  /** The atespace this server's actors and templates live in; the server owns it. */
  readonly atespace: string;
  /** The base object-storage prefix the template's snapshots are written under. */
  readonly storageLocation: string;
  /** The labels of the WorkerPool the actors run on. */
  readonly workerSelector: Readonly<Record<string, string>>;
  /** The gVisor sandbox configuration name. */
  readonly sandboxConfigName: string;
  readonly httpsEgress: SubstrateHttpsEgress;
  readonly extraHttpEgress: readonly SubstrateHttpDestination[];
  readonly pauseAfterSeconds: number;
  readonly suspendAfterSeconds: number;
  readonly sweepIntervalSeconds: number;
}

const PREFIX = "STIGMER_SANDBOX_SUBSTRATE_";

export function newSubstrateSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SubstrateDriverSettings {
  const required = (name: string): string => {
    const value = (env[PREFIX + name] ?? "").trim();
    if (value === "") {
      throw new Error(
        `sandbox provisioner 'substrate' requires ${PREFIX}${name}`,
      );
    }
    return value;
  };
  const optional = (name: string, fallback: string): string => {
    const value = (env[PREFIX + name] ?? "").trim();
    return value === "" ? fallback : value;
  };
  const seconds = (name: string, fallback: number): number => {
    const raw = optional(name, String(fallback));
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `${PREFIX}${name} must be a positive whole number of seconds; got ${raw}`,
      );
    }
    return value;
  };

  const apiEndpoint = required("API_ENDPOINT");
  if (!apiEndpoint.startsWith("https://")) {
    throw new Error(
      `${PREFIX}API_ENDPOINT must be an https:// URL (Substrate's Control API serves gRPC over TLS only); got ${apiEndpoint}`,
    );
  }
  const routerUrl = required("ROUTER_URL");
  if (!/^https?:\/\//.test(routerUrl)) {
    throw new Error(
      `${PREFIX}ROUTER_URL must be an http:// or https:// URL; got ${routerUrl}`,
    );
  }
  const httpsEgress = optional("EGRESS_HTTPS", "all");
  if (httpsEgress !== "all" && httpsEgress !== "none") {
    throw new Error(
      `${PREFIX}EGRESS_HTTPS must be all or none; got ${httpsEgress}`,
    );
  }

  const settings: SubstrateDriverSettings = {
    apiEndpoint,
    apiServerName: optional("API_SERVER_NAME", ""),
    apiCaFile: optional("API_CA_FILE", ""),
    apiTokenFile: required("API_TOKEN_FILE"),
    routerUrl: withoutTrailingSlashes(routerUrl),
    atespace: required("ATESPACE"),
    storageLocation: required("STORAGE_LOCATION"),
    workerSelector: parseSelector(required("WORKER_SELECTOR")),
    sandboxConfigName: optional("SANDBOX_CONFIG", "gvisor-default"),
    httpsEgress,
    extraHttpEgress: parseDestinations(optional("EGRESS_HTTP", "")),
    pauseAfterSeconds: seconds("PAUSE_AFTER_SECONDS", 300),
    suspendAfterSeconds: seconds("SUSPEND_AFTER_SECONDS", 330),
    sweepIntervalSeconds: seconds("SWEEP_INTERVAL_SECONDS", 30),
  };
  validateWindows(settings);
  return settings;
}

/**
 * The windows' two rules: a sandbox pauses before it is suspended, and it
 * stays paused no longer than a paused runner can sleep and still renew
 * its credential (MAX_IN_PLACE_PAUSE_SECONDS).
 */
export function validateWindows(
  settings: Pick<
    SubstrateDriverSettings,
    "pauseAfterSeconds" | "suspendAfterSeconds"
  >,
): void {
  if (settings.pauseAfterSeconds >= settings.suspendAfterSeconds) {
    throw new Error(
      `${PREFIX}PAUSE_AFTER_SECONDS (${settings.pauseAfterSeconds}) must be less than ${PREFIX}SUSPEND_AFTER_SECONDS (${settings.suspendAfterSeconds})`,
    );
  }
  const paused = settings.suspendAfterSeconds - settings.pauseAfterSeconds;
  if (paused > MAX_IN_PLACE_PAUSE_SECONDS) {
    throw new Error(
      `the idle windows would keep a sandbox paused for ${paused} s; a paused runner may sleep at most ${MAX_IN_PLACE_PAUSE_SECONDS} s and still renew its credential on waking — bring ${PREFIX}SUSPEND_AFTER_SECONDS within ${MAX_IN_PLACE_PAUSE_SECONDS} s of ${PREFIX}PAUSE_AFTER_SECONDS`,
    );
  }
}

/** `k=v,k2=v2` into labels. */
export function parseSelector(raw: string): Readonly<Record<string, string>> {
  const labels: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const pair = part.trim();
    if (pair === "") continue;
    const eq = pair.indexOf("=");
    const key = eq < 0 ? "" : pair.slice(0, eq).trim();
    const value = eq < 0 ? "" : pair.slice(eq + 1).trim();
    if (key === "" || value === "") {
      throw new Error(
        `${PREFIX}WORKER_SELECTOR entries are key=value; got ${pair}`,
      );
    }
    labels[key] = value;
  }
  if (Object.keys(labels).length === 0) {
    throw new Error(`${PREFIX}WORKER_SELECTOR names no label`);
  }
  return labels;
}

/** `host:port,host2:port2` into destinations. */
export function parseDestinations(
  raw: string,
): readonly SubstrateHttpDestination[] {
  const destinations: SubstrateHttpDestination[] = [];
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (entry === "") continue;
    const colon = entry.lastIndexOf(":");
    const host = colon < 0 ? "" : entry.slice(0, colon);
    const port = Number(colon < 0 ? "" : entry.slice(colon + 1));
    if (host === "" || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(
        `${PREFIX}EGRESS_HTTP entries are host:port; got ${entry}`,
      );
    }
    destinations.push({ host: host.toLowerCase(), port });
  }
  return destinations;
}

/** `url` without the slashes it ends with (a loop: no regular expression to backtrack). */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}
