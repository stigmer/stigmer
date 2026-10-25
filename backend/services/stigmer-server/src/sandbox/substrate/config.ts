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
 * Substrate's `ate-client` account elsewhere); the router's address, and
 * its CA, server name and the client certificate it asks for since
 * Substrate 0.5 when it is reached over https:// (push.ts). A missing
 * required value is one boot throw naming the variable, and so is a router
 * CA, server name or client certificate given for an http:// router, where
 * it would do nothing.
 *
 * A sandbox sleeps once, after 5 idle minutes: Substrate suspends it on
 * its node and copies its workspace to storage in the background
 * (gateway.ts), so one window does what a pause and a later suspend did
 * before Substrate 0.6. The sweep runs every 30 s, which bounds how late
 * past its window a sandbox sleeps.
 *
 * Settings that Substrate 0.6 left with nothing to do are refused at boot
 * with where their job went (RETIRED_SETTINGS): a setting that silently
 * did nothing would leave an operator believing it in force.
 */

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
  /**
   * Substrate's router as this server reaches it, `http(s)://host[:port]`
   * (in a cluster, `https://atenet-router.ate-system.svc`). The attach push
   * carries the runner's secrets, so over http:// they cross the cluster
   * in cleartext.
   */
  readonly routerUrl: string;
  /**
   * PEM file of the CA the router's certificate chains to, re-read when it
   * changes; "" uses the system roots. Only for an https:// router.
   */
  readonly routerCaFile: string;
  /**
   * The name the router's certificate is checked against; "" uses the
   * URL's host. Only for an https:// router; needed when the router is
   * reached by another name than its certificate's (a port-forward).
   */
  readonly routerServerName: string;
  /**
   * PEM file holding this server's client key and certificate chain for
   * the router (a podCertificate projection's credential bundle), re-read
   * when it changes; "" presents none. Only for an https:// router, whose
   * TLS listener asks for one since Substrate 0.5.
   */
  readonly routerClientCertFile: string;
  /** The atespace this server's actors and templates live in; the server owns it. */
  readonly atespace: string;
  /** The base object-storage prefix the template's snapshots are written under. */
  readonly storageLocation: string;
  /** The labels of the WorkerPool the actors run on. */
  readonly workerSelector: Readonly<Record<string, string>>;
  readonly httpsEgress: SubstrateHttpsEgress;
  readonly extraHttpEgress: readonly SubstrateHttpDestination[];
  /**
   * HTTPS hosts a sandbox whose Environment limits networking keeps open
   * beside the ones derived from the runner's configuration
   * (sandbox/runner-lanes.ts): a Vertex or Foundry endpoint, a proxy.
   * `host,host`, from EGRESS_HTTPS_PLATFORM; unused under `unrestricted`.
   */
  readonly platformHttpsHosts: readonly string[];
  /** How long a session's sandbox stays idle before it is suspended. */
  readonly suspendAfterSeconds: number;
  readonly sweepIntervalSeconds: number;
}

const PREFIX = "STIGMER_SANDBOX_SUBSTRATE_";

/** Settings Substrate 0.6 left with nothing to do, each with where its job went (module header). */
const RETIRED_SETTINGS: ReadonlyMap<string, string> = new Map([
  [
    "PAUSE_AFTER_SECONDS",
    `a sandbox now sleeps once, suspended on its node and copied to storage in the background, after ${PREFIX}SUSPEND_AFTER_SECONDS (300 by default)`,
  ],
  [
    "SANDBOX_CONFIG",
    "since Substrate 0.6 the WorkerPool's sandboxClasses entry chooses a sandbox's configuration; set it there",
  ],
  [
    "NODE_AGENT_PRINCIPAL",
    "since Substrate 0.6 the node agent reads each actor's egress policy through a system role of its own, so the server grants it nothing",
  ],
]);

export function newSubstrateSettingsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SubstrateDriverSettings {
  for (const [name, home] of RETIRED_SETTINGS) {
    if ((env[PREFIX + name] ?? "").trim() !== "") {
      throw new Error(
        `${PREFIX}${name} is retired and nothing reads it: ${home}. Remove it from the environment.`,
      );
    }
  }
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
  const routerCaFile = optional("ROUTER_CA_FILE", "");
  const routerServerName = optional("ROUTER_SERVER_NAME", "");
  const routerClientCertFile = optional("ROUTER_CLIENT_CERT_FILE", "");
  if (!routerUrl.startsWith("https://")) {
    for (const [name, value] of [
      ["ROUTER_CA_FILE", routerCaFile],
      ["ROUTER_SERVER_NAME", routerServerName],
      ["ROUTER_CLIENT_CERT_FILE", routerClientCertFile],
    ] as const) {
      if (value !== "") {
        throw new Error(
          `${PREFIX}${name} applies only to an https:// router; ${PREFIX}ROUTER_URL is ${routerUrl}`,
        );
      }
    }
  }
  const httpsEgress = optional("EGRESS_HTTPS", "all");
  if (httpsEgress !== "all" && httpsEgress !== "none") {
    throw new Error(
      `${PREFIX}EGRESS_HTTPS must be all or none; got ${httpsEgress}`,
    );
  }

  return {
    apiEndpoint,
    apiServerName: optional("API_SERVER_NAME", ""),
    apiCaFile: optional("API_CA_FILE", ""),
    apiTokenFile: required("API_TOKEN_FILE"),
    routerUrl: withoutTrailingSlashes(routerUrl),
    routerCaFile,
    routerServerName,
    routerClientCertFile,
    atespace: required("ATESPACE"),
    storageLocation: required("STORAGE_LOCATION"),
    workerSelector: parseSelector(required("WORKER_SELECTOR")),
    httpsEgress,
    extraHttpEgress: parseDestinations(optional("EGRESS_HTTP", "")),
    platformHttpsHosts: parseHosts(optional("EGRESS_HTTPS_PLATFORM", "")),
    suspendAfterSeconds: seconds("SUSPEND_AFTER_SECONDS", 300),
    sweepIntervalSeconds: seconds("SWEEP_INTERVAL_SECONDS", 30),
  };
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

/** `host,host2` into lower-case hosts; a scheme, port or path is refused. */
export function parseHosts(raw: string): readonly string[] {
  const hosts: string[] = [];
  for (const part of raw.split(",")) {
    const host = part.trim().toLowerCase().replace(/\.$/, "");
    if (host === "") continue;
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
      throw new Error(
        `${PREFIX}EGRESS_HTTPS_PLATFORM entries are host names, with no scheme, port, path or pattern; got ${part.trim()}`,
      );
    }
    hosts.push(host);
  }
  return [...new Set(hosts)];
}

/** `url` without the slashes it ends with (a loop: no regular expression to backtrack). */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}
