/**
 * The variables a sandbox's processes trust its egress gateway by.
 *
 * A sandbox with HTTPS egress reaches the internet through a gateway that
 * re-signs every connection with its own CA, so every tool the agent starts
 * must trust that CA, and each common tool reads its CA file from a
 * different variable: Node (`NODE_EXTRA_CA_CERTS`), OpenSSL-based tools and
 * Go (`SSL_CERT_FILE`), git (`GIT_SSL_CAINFO`), curl (`CURL_CA_BUNDLE`), and
 * Python's requests, under pip among others (`REQUESTS_CA_BUNDLE`). Measured
 * on Debian bookworm, the sandbox image's base: pip 23.0 (the system's and a
 * venv's) and git, whose HTTPS is on GnuTLS, ignore `SSL_CERT_FILE` and
 * trust the gateway only through their own variable; curl, on OpenSSL there,
 * reads either. wget, also on GnuTLS, reads none of them (stigmer#3509).
 *
 * One list, because three copies drifted (stigmer#3392): the control
 * plane's sandbox template sets every name to the gateway's CA; the runner
 * lets every name into a separating agent host's allow-list, hands them to
 * the Environment install's root commands, and gives them to each local
 * (stdio) MCP server (stigmer#3506). Each value is a path to a public CA
 * bundle, never a secret, which is why every one of those may carry them.
 */
export const GATEWAY_TRUST_VARIABLES = [
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "GIT_SSL_CAINFO",
  "CURL_CA_BUNDLE",
  "REQUESTS_CA_BUNDLE",
] as const;

/** One of {@link GATEWAY_TRUST_VARIABLES}. */
export type GatewayTrustVariable = (typeof GATEWAY_TRUST_VARIABLES)[number];
