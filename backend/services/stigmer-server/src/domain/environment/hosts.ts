/**
 * The host grammar of an Environment's `allowed_hosts`: one module that the
 * write check, the expansion into a sandbox's facts and the Substrate
 * driver's rules all read, so a host the server admits is a host the
 * gateway can enforce, with the meaning the server states.
 *
 * Admitted: a lower-case DNS name of at least two labels, or `*.` and one,
 * with no scheme, port, path or trailing dot. That is Agent Substrate's own
 * HTTPS-rule syntax (its `HTTPSRule.hostnames`), so every admitted host is
 * a valid gateway pattern. The wildcard is the gateway's meaning: exactly
 * one label (`*.example.com` admits `api.example.com`, not `example.com`
 * and not `a.b.example.com`, measured on Substrate v0.3.0, 2026-10-18).
 * That is narrower than Claude Managed Agents' any-depth wildcard, so a
 * list written for that standard admits less here, never more.
 *
 * Refused at write, naming the rule: an IP address (any name whose
 * top-level label is a number, which covers the shorthand and hex forms a
 * resolver reads as IPv4), a single label and
 * localhost, the cluster and private suffixes, the cloud metadata name, and
 * any `ate-system` label (Substrate's own services). The proto pattern has
 * already refused a scheme, a port, a path and a pattern anywhere but the
 * leftmost label; it admits upper case and a trailing dot, which
 * {@link normalizeHost} removes first. Address-level refusal (a public name
 * that resolves to a private address) stays the gateway's and the
 * network's.
 */

/** Suffixes that name a cluster's or a private network's own hosts. */
const PRIVATE_SUFFIXES: readonly string[] = [
  ".svc",
  ".cluster.local",
  ".local",
  ".internal",
  ".localhost",
  ".home.arpa",
];

/** The label Substrate's own services carry, in any qualification. */
const SUBSTRATE_NAMESPACE_LABEL = "ate-system";

/** Lower case, no trailing dot: the one spelling hosts are stored and compared in. */
export function normalizeHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.$/, "");
}

/** The hosts normalized, duplicates removed, first spelling's order kept. */
export function normalizeHosts(raw: readonly string[]): string[] {
  return [...new Set(raw.map(normalizeHost))];
}

/**
 * Why a normalized host may not be listed, or `undefined` when it may.
 * Each sentence names the host and the rule.
 */
export function hostRefusal(host: string): string | undefined {
  const name = host.startsWith("*.") ? host.slice(2) : host;
  // No top-level label is a number: a name ending in one is an address in
  // one of the forms a resolver reads as IPv4 (127.1, 0x7f.0.0.1).
  const top = name.slice(name.lastIndexOf(".") + 1);
  if (/^(\d+|0x[0-9a-f]*)$/.test(top) || name.includes(":")) {
    return `allowed host '${host}' is an IP address; list the host's DNS name`;
  }
  if (name.includes("*")) {
    return `allowed host '${host}' has a wildcard that is not its whole first label; a wildcard is written *.example.com`;
  }
  const labels = name.split(".");
  if (labels.length < 2 || name === "localhost") {
    return `allowed host '${host}' is a single-label name, which would name a host inside the sandbox's own network; list a fully qualified name`;
  }
  if (labels.includes(SUBSTRATE_NAMESPACE_LABEL)) {
    return `allowed host '${host}' names the sandbox runtime's own services, which no sandbox may reach`;
  }
  if (name === "metadata.google.internal") {
    return `allowed host '${host}' is a cloud metadata service, which no sandbox may reach`;
  }
  for (const suffix of PRIVATE_SUFFIXES) {
    if (name.endsWith(suffix) || `.${name}` === suffix) {
      return `allowed host '${host}' is a cluster-internal or private name (${suffix}); list a public host`;
    }
  }
  return undefined;
}

/**
 * Whether a listed host admits a request's host, with the gateway's
 * meaning: an exact name, or `*.` matching exactly one more label.
 */
export function hostAdmits(pattern: string, host: string): boolean {
  const name = normalizeHost(host);
  if (!pattern.startsWith("*.")) {
    return pattern === name;
  }
  const suffix = pattern.slice(1);
  if (!name.endsWith(suffix)) {
    return false;
  }
  const label = name.slice(0, name.length - suffix.length);
  return label.length > 0 && !label.includes(".");
}
