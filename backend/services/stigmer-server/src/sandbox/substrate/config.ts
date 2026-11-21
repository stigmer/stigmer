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
 * (gateway.ts). The sweep runs every 30 s, which bounds how late past its
 * window a sandbox sleeps.
 *
 * Each sandbox's CPU and memory are settings too, and they decide how many
 * sandboxes a worker holds: Substrate refuses a template without both
 * limits and books them against the capacity its worker reports, so a
 * worker holds its CPU divided by the CPU setting, or its memory divided by
 * the memory setting plus the runtime's overhead, whichever is fewer. The
 * defaults are the container drivers' 2 CPU and 2 GiB
 * (agent-sandbox/manifest.ts), so a server that sets neither keeps the
 * template it had.
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
  /**
   * PEM file of the CA the Control API's certificate chains to, re-read
   * when it changes; "" uses the system roots.
   */
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
  /**
   * Each sandbox's CPU in millicores (1000 is one core): what Substrate
   * books against its worker's CPU and, under gVisor, the sandbox's hard
   * ceiling (its cgroup's cpu.max), so a smaller value fits more sandboxes
   * on a worker and makes a busy turn, and a wake, slower. Never 0:
   * Substrate requires a CPU limit on every template.
   */
  readonly cpuMillicores: number;
  /**
   * Each sandbox's memory in MiB: what Substrate books against its worker's
   * memory, beside the runtime's overhead, and the sandbox's ceiling. A
   * sandbox that reaches the ceiling is stopped whole by Substrate, not one
   * command in it; the driver reverts it to its last snapshot in storage
   * (a sleep's snapshot is copied there in the background) and leaves it
   * asleep, and the turn that ran the command ends as
   * `sandbox_out_of_memory` rather than run it again (#3347).
   */
  readonly memoryMib: number;
}

const PREFIX = "STIGMER_SANDBOX_SUBSTRATE_";

/** The container drivers' sizes (agent-sandbox/manifest.ts): 2 CPU, 2 GiB. */
const DEFAULT_CPU_MILLICORES = 2000;
const DEFAULT_MEMORY_MIB = 2048;
/** Substrate's own bound on a CPU limit (its Resources.cpu_millicores): under 1000 cores. */
const MAX_CPU_MILLICORES = 999_999;
/** The most MiB whose bytes are still a whole number JavaScript holds exactly. */
const MAX_MEMORY_MIB = Math.floor(Number.MAX_SAFE_INTEGER / 1024 ** 2);

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
  // A positive whole number of `unit`, no larger than `max`.
  const positiveWhole = (
    name: string,
    fallback: number,
    unit: string,
    max: number = Number.MAX_SAFE_INTEGER,
  ): number => {
    const raw = optional(name, String(fallback));
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(
        `${PREFIX}${name} must be a positive whole number of ${unit}; got ${raw}`,
      );
    }
    if (value > max) {
      throw new Error(
        `${PREFIX}${name} must be at most ${max} ${unit}; got ${raw}`,
      );
    }
    return value;
  };
  const seconds = (name: string, fallback: number): number =>
    positiveWhole(name, fallback, "seconds");

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
  // 0 is said apart from any other bad value: Substrate's own field reads
  // "0 means none", which holds for a container's limits but not for the
  // template's, the one this setting writes.
  const cpuRaw = optional("CPU_MILLICORES", "");
  if (cpuRaw !== "" && Number(cpuRaw) === 0) {
    throw new Error(
      `${PREFIX}CPU_MILLICORES must not be 0: Substrate requires a CPU limit on every sandbox; got ${cpuRaw}`,
    );
  }
  const cpuMillicores = positiveWhole(
    "CPU_MILLICORES",
    DEFAULT_CPU_MILLICORES,
    "millicores",
    MAX_CPU_MILLICORES,
  );

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
    workerSelector: parseSelector(required("WORKER_SELECTOR")),
    httpsEgress,
    extraHttpEgress: parseDestinations(optional("EGRESS_HTTP", "")),
    platformHttpsHosts: parseHosts(optional("EGRESS_HTTPS_PLATFORM", "")),
    suspendAfterSeconds: seconds("SUSPEND_AFTER_SECONDS", 300),
    sweepIntervalSeconds: seconds("SWEEP_INTERVAL_SECONDS", 30),
    cpuMillicores,
    memoryMib: positiveWhole(
      "MEMORY_MIB",
      DEFAULT_MEMORY_MIB,
      "MiB",
      MAX_MEMORY_MIB,
    ),
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
