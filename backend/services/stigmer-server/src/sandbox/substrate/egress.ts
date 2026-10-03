/**
 * The egress policy every actor of this server gets: what a sandbox may
 * reach. Substrate denies everything a policy does not allow, and an
 * actor without a policy reaches nothing.
 *
 * Allowed: the lanes the runner needs (this server's backend endpoint,
 * Temporal, and this server's public MCP address, which stdio MCP
 * servers inside the sandbox may dial), each as a cleartext rule; the
 * operator's extra cleartext destinations; and, unless HTTPS egress is off,
 * HTTPS to every name (`"*"`), intercepted by Substrate's egress gateway,
 * so an agent can fetch from the web while every tool trusts the gateway's
 * CA (template.ts). Nothing else: no SSH, no database protocol, no HTTP/3,
 * no TLS that is not HTTP.
 *
 * A runner lane over TLS is a boot throw. Substrate's gateway can carry
 * TLS only by intercepting it: its `tls_passthrough` rule, which would
 * forward TLS untouched, is accepted by Substrate 0.3.0 but matches nothing
 * in its gateway yet, so those names are denied. An intercepted lane
 * cannot carry a Temporal client certificate or a pinned Temporal CA, and
 * it needs the gateway's CA in the sandbox even with HTTPS egress off. So
 * the runner's lanes are cleartext addresses the gateway can reach, inside
 * the cluster; when passthrough works, a TLS lane becomes a passthrough
 * rule and this refusal goes.
 *
 * Never allowed: Substrate's own services. Its router addresses any actor
 * by a header alone and the attach push trusts whoever reaches it, so
 * the router must be reachable by this server and by no sandbox. A
 * destination naming the router, the Control API or anything under
 * `ate-system` is a boot throw. The HTTPS wildcard does not reach them on
 * a standard install because the gateway verifies every upstream
 * certificate against public roots and Substrate's services present
 * certificates from the cluster's own CA (measured on kind, 2026-10-03:
 * the router, the Control API and the Kubernetes API all refused with
 * "unable to get local issuer certificate", while the gateway did resolve
 * and dial their cluster addresses). That holds only while neither is
 * served under a publicly trusted certificate at an address the gateway
 * can reach; the operator guide states it as a requirement.
 *
 * A named destination is one host, so it may not be a pattern: Substrate
 * reads `*` as every name and `*.suffix` as every name under it (`*.svc`
 * would hold the router), and a pattern in a cleartext rule would open
 * Substrate's services over plain HTTP, where no certificate check stands
 * in the way. Nor may it be a single label: the gateway resolves a name in
 * its own namespace, Substrate's, so a short name (`atenet-router`, `api`,
 * `localhost`) reaches Substrate's own services or the gateway itself, and
 * never this server. Substrate's rules name hosts, never addresses, so an
 * endpoint given as an IP address is a boot throw too.
 */
import { create } from "@bufbuild/protobuf";

import type { SandboxDriverConfig } from "../provisioner.js";
import type { SubstrateDriverSettings } from "./config.js";
import { EgressRuleSchema, type EgressRule } from "./gen/ateapipb/ateapi_pb.js";

interface Destination {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  /** The setting the destination came from, for refusals. */
  readonly source: string;
}

/**
 * The namespace Substrate's own services run in: a name with this label,
 * however it is qualified (`atenet-router.ate-system`, `….svc`,
 * `….svc.cluster.local`), is one of them.
 */
const SUBSTRATE_NAMESPACE_LABEL = "ate-system";

/** The rules of every actor's policy; throws on a forbidden or unusable destination. */
export function buildEgressRules(
  config: SandboxDriverConfig,
  settings: SubstrateDriverSettings,
): EgressRule[] {
  const destinations: Destination[] = [
    urlDestination(config.backendEndpoint, "STIGMER_SANDBOX_BACKEND_ENDPOINT"),
    // Temporal's TLS is its connection settings', which the driver
    // refuses (driver.ts); its address is plain host:port.
    urlDestination(config.temporalAddress, "STIGMER_SANDBOX_TEMPORAL_ADDRESS"),
    ...(config.mcpPublicEndpoint !== ""
      ? [
          urlDestination(
            config.mcpPublicEndpoint,
            "STIGMER_SANDBOX_MCP_PUBLIC_ENDPOINT",
          ),
        ]
      : []),
    ...settings.extraHttpEgress.map((d) => ({
      ...d,
      tls: false,
      source: "STIGMER_SANDBOX_SUBSTRATE_EGRESS_HTTP",
    })),
  ];

  const forbidden = new Set([
    hostOf(settings.routerUrl),
    hostOf(settings.apiEndpoint),
  ]);
  const rules: EgressRule[] = [];
  const seen = new Set<string>();
  for (const given of destinations) {
    // A trailing dot names the same host (an absolute DNS name).
    const destination = { ...given, host: given.host.replace(/\.$/, "") };
    if (destination.tls) {
      throw new Error(
        `${destination.source} is a TLS lane (${destination.host}:${destination.port}); the substrate driver needs the runner's lanes in cleartext inside the cluster, because Substrate's egress gateway can carry TLS only by intercepting it (its tls_passthrough rule is not served yet), which breaks a Temporal client certificate or a pinned CA and needs the gateway's CA in every sandbox`,
      );
    }
    if (isIpAddress(destination.host)) {
      throw new Error(
        `${destination.source} names the address ${destination.host}; Substrate's egress rules name hosts, so give it a DNS name`,
      );
    }
    if (destination.host.includes("*")) {
      throw new Error(
        `${destination.source} names the pattern ${destination.host}; a named destination is one host, because a pattern would admit Substrate's own services`,
      );
    }
    const labels = destination.host.split(".");
    if (labels.length < 2) {
      throw new Error(
        `${destination.source} names ${destination.host}, a single-label name, which Substrate's egress gateway resolves in its own namespace; give the host's fully qualified name`,
      );
    }
    if (
      forbidden.has(destination.host) ||
      labels.includes(SUBSTRATE_NAMESPACE_LABEL)
    ) {
      throw new Error(
        `${destination.source} names ${destination.host}, one of Substrate's own services; no sandbox may reach them, because whoever reaches the router can push to any sandbox`,
      );
    }
    const key = `${destination.host}:${destination.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rule = {
      hostnames: [destination.host],
      ports: { numbers: [destination.port] },
    };
    rules.push(create(EgressRuleSchema, { http: rule }));
  }
  if (settings.httpsEgress === "all") {
    rules.push(create(EgressRuleSchema, { https: { hostnames: ["*"] } }));
  }
  return rules;
}

function urlDestination(raw: string, source: string): Destination {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new Error(`${source} is not a URL or host:port: ${raw}`);
  }
  const tls = url.protocol === "https:";
  const port = url.port !== "" ? Number(url.port) : tls ? 443 : 80;
  return { host: url.hostname.toLowerCase(), port, tls, source };
}

function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
}

function isIpAddress(host: string): boolean {
  return (
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.includes(":") ||
    host.startsWith("[")
  );
}
