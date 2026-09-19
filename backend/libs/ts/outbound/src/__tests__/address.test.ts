/**
 * Pins the address classification under both postures: the runner's cases,
 * moved here byte for byte when the rule became shared, plus the policy
 * shape a consumer composes.
 */
import { describe, expect, it } from "vitest";

import { blockedReason, egressPolicyForPosture } from "../egress/address.js";

describe("blockedReason, strict posture", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.255.255.255", "loopback"],
    ["0.0.0.0", "unspecified"],
    ["10.0.0.1", "private (RFC 1918)"],
    ["172.16.0.1", "private (RFC 1918)"],
    ["172.31.255.255", "private (RFC 1918)"],
    ["192.168.1.1", "private (RFC 1918)"],
    ["169.254.169.254", "link-local (cloud metadata)"],
    ["169.254.0.1", "link-local (cloud metadata)"],
  ])("blocks %s as %s", (address, reason) => {
    expect(blockedReason(address, "strict")).toBe(reason);
  });

  it.each(["8.8.8.8", "104.16.0.1", "172.15.0.1", "172.32.0.1", "192.169.0.1"])("allows public IPv4 %s", (address) => {
    expect(blockedReason(address, "strict")).toBeNull();
  });

  it.each([
    ["::1", "loopback"],
    ["::", "unspecified"],
    ["fc00::1", "private (unique local)"],
    ["fd12:3456::1", "private (unique local)"],
    ["fe80::1", "link-local (cloud metadata)"],
    ["febf::1", "link-local (cloud metadata)"],
  ])("blocks IPv6 %s as %s", (address, reason) => {
    expect(blockedReason(address, "strict")).toBe(reason);
  });

  it("allows public IPv6", () => {
    expect(blockedReason("2606:4700::6810:1", "strict")).toBeNull();
  });

  it("blocks IPv4-mapped IPv6 carrying a blocked v4 (dotted form)", () => {
    expect(blockedReason("::ffff:127.0.0.1", "strict")).toBe("loopback");
    expect(blockedReason("::ffff:10.0.0.1", "strict")).toBe("private (RFC 1918)");
  });

  it("blocks IPv4-mapped IPv6 carrying a blocked v4 (hex form)", () => {
    expect(blockedReason("::ffff:7f00:1", "strict")).toBe("loopback");
    expect(blockedReason("::ffff:a9fe:a9fe", "strict")).toBe("link-local (cloud metadata)");
  });

  it("allows IPv4-mapped IPv6 carrying a public v4", () => {
    expect(blockedReason("::ffff:8.8.8.8", "strict")).toBeNull();
  });

  it("ignores a zone suffix when classifying", () => {
    expect(blockedReason("fe80::1%eth0", "strict")).toBe("link-local (cloud metadata)");
  });

  it("fails closed on garbage", () => {
    expect(blockedReason("not-an-ip", "strict")).toBe("unrecognized");
  });
});

describe("blockedReason, relaxed posture", () => {
  it.each(["127.0.0.1", "10.0.0.1", "192.168.1.1", "::1", "fd00::1"])("allows private/loopback %s (the machine belongs to the user)", (address) => {
    expect(blockedReason(address, "relaxed")).toBeNull();
  });

  it("still blocks the cloud metadata range", () => {
    expect(blockedReason("169.254.169.254", "relaxed")).toBe("link-local (cloud metadata)");
    expect(blockedReason("fe80::1", "relaxed")).toBe("link-local (cloud metadata)");
    expect(blockedReason("::ffff:169.254.169.254", "relaxed")).toBe("link-local (cloud metadata)");
  });
});

describe("egressPolicyForPosture", () => {
  it("names the posture and applies its classification", () => {
    const strict = egressPolicyForPosture("strict");
    const relaxed = egressPolicyForPosture("relaxed");
    expect(strict.name).toBe("strict");
    expect(relaxed.name).toBe("relaxed");
    expect(strict.blockedReason("10.0.0.1")).toBe("private (RFC 1918)");
    expect(relaxed.blockedReason("10.0.0.1")).toBeNull();
  });
});
