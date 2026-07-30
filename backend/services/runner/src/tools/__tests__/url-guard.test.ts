import { describe, it, expect } from "vitest";
import {
  blockedReason,
  resolveGuardPosture,
  validateFetchUrl,
  UrlGuardError,
} from "../url-guard.js";

describe("resolveGuardPosture", () => {
  it("defaults to strict on cloud runners", () => {
    expect(resolveGuardPosture("cloud", {})).toBe("strict");
  });

  it("defaults to relaxed on local runners", () => {
    expect(resolveGuardPosture("local", {})).toBe("relaxed");
  });

  it("override=true relaxes a cloud runner", () => {
    expect(resolveGuardPosture("cloud", { STIGMER_WEB_FETCH_ALLOW_PRIVATE: "true" })).toBe("relaxed");
  });

  it("override=false hardens a local runner", () => {
    expect(resolveGuardPosture("local", { STIGMER_WEB_FETCH_ALLOW_PRIVATE: "false" })).toBe("strict");
  });

  it("ignores malformed override values", () => {
    expect(resolveGuardPosture("cloud", { STIGMER_WEB_FETCH_ALLOW_PRIVATE: "yes" })).toBe("strict");
  });
});

describe("blockedReason — strict posture", () => {
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

  it.each(["8.8.8.8", "104.16.0.1", "172.15.0.1", "172.32.0.1", "192.169.0.1"])(
    "allows public IPv4 %s",
    (address) => {
      expect(blockedReason(address, "strict")).toBeNull();
    },
  );

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
    // ::ffff:7f00:1 is 127.0.0.1 — the hex spelling must not bypass the guard.
    expect(blockedReason("::ffff:7f00:1", "strict")).toBe("loopback");
    expect(blockedReason("::ffff:a9fe:a9fe", "strict")).toBe("link-local (cloud metadata)");
  });

  it("allows IPv4-mapped IPv6 carrying a public v4", () => {
    expect(blockedReason("::ffff:8.8.8.8", "strict")).toBeNull();
  });

  it("fails closed on garbage", () => {
    expect(blockedReason("not-an-ip", "strict")).toBe("unrecognized");
  });
});

describe("blockedReason — relaxed posture", () => {
  it.each(["127.0.0.1", "10.0.0.1", "192.168.1.1", "::1", "fd00::1"])(
    "allows private/loopback %s (the machine belongs to the user)",
    (address) => {
      expect(blockedReason(address, "relaxed")).toBeNull();
    },
  );

  it("still blocks the cloud metadata range", () => {
    expect(blockedReason("169.254.169.254", "relaxed")).toBe("link-local (cloud metadata)");
    expect(blockedReason("fe80::1", "relaxed")).toBe("link-local (cloud metadata)");
    expect(blockedReason("::ffff:169.254.169.254", "relaxed")).toBe("link-local (cloud metadata)");
  });
});

describe("validateFetchUrl", () => {
  it("rejects malformed URLs", async () => {
    await expect(validateFetchUrl("not a url", "strict")).rejects.toThrow(UrlGuardError);
  });

  it.each(["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com"])(
    "rejects non-http(s) scheme %s",
    async (url) => {
      await expect(validateFetchUrl(url, "strict")).rejects.toThrow(/only http and https/);
    },
  );

  it("rejects literal blocked IPs without a DNS lookup", async () => {
    await expect(validateFetchUrl("http://127.0.0.1:8080/x", "strict")).rejects.toThrow(/loopback/);
    await expect(validateFetchUrl("http://169.254.169.254/latest/meta-data", "strict"))
      .rejects.toThrow(/cloud metadata/);
    await expect(validateFetchUrl("http://[::1]/", "strict")).rejects.toThrow(/loopback/);
  });

  it("allows literal loopback under the relaxed posture", async () => {
    const url = await validateFetchUrl("http://127.0.0.1:3000/api", "relaxed");
    expect(url.hostname).toBe("127.0.0.1");
  });

  it("rejects hostnames that resolve to blocked addresses", async () => {
    // localhost resolves to 127.0.0.1 / ::1 everywhere.
    await expect(validateFetchUrl("http://localhost:9999/", "strict")).rejects.toThrow(UrlGuardError);
  });

  it("rejects unresolvable hostnames", async () => {
    await expect(
      validateFetchUrl("http://definitely-not-a-real-host.stigmer.invalid/", "strict"),
    ).rejects.toThrow(/Could not resolve/);
  });
});
