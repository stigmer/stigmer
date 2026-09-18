/**
 * Pins the outboundEgress driver point in the single-instance shape the
 * registry already enforces for policyGrantScope and licenseStatus:
 *
 *   - `drivers.outboundEgress` — the address policy the composition root
 *     builds the McpServer slice's one guarded fetch from; single instance;
 *     absent = open source's relaxed posture installs at the compose.ts
 *     consumption site.
 *
 * And the two exported postures: relaxed refuses only the link-local
 * (cloud metadata) range, strict refuses loopback, private and unspecified
 * too, and neither owns a copy of the ranges (both read the shared table).
 */
import { describe, expect, it } from "vitest";

import { relaxedEgressPolicy, strictEgressPolicy } from "../outbound-egress.js";
import { resolveExtensions } from "../registry.js";

describe("the outboundEgress driver point", () => {
  it("is undefined with no extensions — the relaxed posture installs at the consumption site", () => {
    expect(resolveExtensions([]).drivers.outboundEgress).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const policy = strictEgressPolicy();
    const resolved = resolveExtensions([{ name: "cloud-core", drivers: { outboundEgress: policy } }]);
    expect(resolved.drivers.outboundEgress).toBe(policy);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "egress-a", drivers: { outboundEgress: strictEgressPolicy() } },
        { name: "egress-b", drivers: { outboundEgress: relaxedEgressPolicy() } },
      ]),
    ).toThrowError(/extension 'egress-b' registers an OutboundEgressPolicy, but 'egress-a' already did/);
  });
});

describe("the two postures", () => {
  it("relaxed refuses only the link-local range, so a local MCP server stays reachable", () => {
    const relaxed = relaxedEgressPolicy();
    expect(relaxed.name).toBe("relaxed");
    expect(relaxed.blockedReason("127.0.0.1")).toBeNull();
    expect(relaxed.blockedReason("10.0.0.1")).toBeNull();
    expect(relaxed.blockedReason("169.254.169.254")).toBe("link-local (cloud metadata)");
  });

  it("strict refuses loopback, private, link-local and unspecified addresses", () => {
    const strict = strictEgressPolicy();
    expect(strict.name).toBe("strict");
    expect(strict.blockedReason("127.0.0.1")).toBe("loopback");
    expect(strict.blockedReason("10.0.0.1")).toBe("private (RFC 1918)");
    expect(strict.blockedReason("169.254.169.254")).toBe("link-local (cloud metadata)");
    expect(strict.blockedReason("0.0.0.0")).toBe("unspecified");
    expect(strict.blockedReason("104.16.0.1")).toBeNull();
  });
});
