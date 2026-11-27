/**
 * Pins the egress gateway's trust variables by their literal names: the
 * sandbox template sets these and the runner passes these, so dropping one
 * from the list breaks a tool's trust of the gateway (stigmer#3392), and
 * must fail here rather than read the list back.
 */
import { describe, expect, it } from "vitest";

import { GATEWAY_TRUST_VARIABLES } from "../egress/index.js";

describe("GATEWAY_TRUST_VARIABLES", () => {
  it("names the CA variable of Node, OpenSSL, git, curl and Python's requests", () => {
    expect([...GATEWAY_TRUST_VARIABLES]).toEqual([
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
      "GIT_SSL_CAINFO",
      "CURL_CA_BUNDLE",
      "REQUESTS_CA_BUNDLE",
    ]);
  });
});
