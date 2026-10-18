/**
 * Pins the host grammar of an Environment's allowed_hosts (../hosts.ts) and
 * the package-manager list `allow_package_managers` opens
 * (../package-manager-hosts.ts).
 *
 * What it pins:
 *   - normalizeHost lower-cases, trims and drops one trailing dot;
 *     normalizeHosts also removes duplicates, keeping the first spelling's
 *     order;
 *   - hostRefusal refuses, naming the host and the rule: an IPv4 or IPv6
 *     address, the shorthand and hex IPv4 forms included (a name whose
 *     top-level label is a number; a number elsewhere is admitted), a single label and localhost, a `*.svc`-style wildcard over
 *     one label, every private suffix (.svc, .cluster.local, .local,
 *     .internal, .localhost, .home.arpa), the cloud metadata name, any
 *     `ate-system` label, and a wildcard that is not the whole first label;
 *     it admits api.github.com and *.example.com;
 *   - hostAdmits: an exact name (in any spelling of the request's host),
 *     and `*.example.com` admits exactly one more label: api.example.com,
 *     never example.com, a.b.example.com or a name that only ends in the
 *     same letters;
 *   - the package-manager list holds Managed Agents' published hosts plus
 *     Debian's archive, each once and each a host the grammar admits, and
 *     APT_ARCHIVE_HOSTS are exactly the cleartext ones.
 */
import { describe, expect, it } from "vitest";

import { hostAdmits, hostRefusal, normalizeHost, normalizeHosts } from "../hosts.js";
import { APT_ARCHIVE_HOSTS, PACKAGE_MANAGER_HOSTS } from "../package-manager-hosts.js";

describe("normalizeHost and normalizeHosts", () => {
  it("stores one spelling: lower case, trimmed, with no trailing dot", () => {
    expect(normalizeHost("API.GitHub.com.")).toBe("api.github.com");
    expect(normalizeHost("  *.Example.COM ")).toBe("*.example.com");
    expect(normalizeHost("api.github.com")).toBe("api.github.com");
  });

  it("removes duplicates after normalizing, keeping the first spelling's order", () => {
    expect(
      normalizeHosts(["B.example.com", "a.example.com.", "b.example.com", "A.EXAMPLE.COM"]),
    ).toEqual(["b.example.com", "a.example.com"]);
    expect(normalizeHosts([])).toEqual([]);
  });
});

describe("hostRefusal", () => {
  it.each([
    ["10.0.0.1", "is an IP address"],
    ["169.254.169.254", "is an IP address"],
    ["*.10.0.0.1", "is an IP address"],
    ["::1", "is an IP address"],
    ["fd00::1", "is an IP address"],
    ["127.1", "is an IP address"],
    ["10.1", "is an IP address"],
    ["169.254.43518", "is an IP address"],
    ["0x7f.0.0.1", "is an IP address"],
    ["10.0.0.0x1", "is an IP address"],
  ])("refuses the address %s", (host, rule) => {
    const refusal = hostRefusal(host);
    expect(refusal).toContain(`'${host}'`);
    expect(refusal).toContain(rule);
  });

  it.each(["cafe.beef", "1password.com", "*.0x1.example.com", "api.123.example.com"])(
    "admits %s: a label may look like a number, the top-level one may not",
    (host) => {
      expect(hostRefusal(host)).toBeUndefined();
    },
  );

  it.each(["localhost", "intranet", "*.svc", "*.internal", "*.local"])(
    "refuses the single label %s",
    (host) => {
      const refusal = hostRefusal(host);
      expect(refusal).toContain(`'${host}'`);
      expect(refusal).toContain("single-label name");
    },
  );

  it.each([
    ["kube-dns.kube-system.svc", ".svc"],
    ["*.default.svc", ".svc"],
    ["api.default.svc.cluster.local", ".cluster.local"],
    ["printer.local", ".local"],
    ["db.corp.internal", ".internal"],
    ["*.corp.internal", ".internal"],
    ["app.localhost", ".localhost"],
    ["router.home.arpa", ".home.arpa"],
    ["home.arpa", ".home.arpa"],
  ])("refuses %s, a private or cluster-internal name (%s)", (host, suffix) => {
    const refusal = hostRefusal(host);
    expect(refusal).toContain(`'${host}'`);
    expect(refusal).toContain(`private name (${suffix})`);
  });

  it("refuses the cloud metadata service by its name", () => {
    const refusal = hostRefusal("metadata.google.internal");
    expect(refusal).toContain("'metadata.google.internal'");
    expect(refusal).toContain("cloud metadata service");
  });

  it.each([
    "ate-system.example.com",
    "gateway.ate-system.svc.cluster.local",
    "*.ate-system.example.com",
  ])("refuses %s, which names the sandbox runtime's own services", (host) => {
    const refusal = hostRefusal(host);
    expect(refusal).toContain(`'${host}'`);
    expect(refusal).toContain("sandbox runtime's own services");
  });

  it.each(["api*.example.com", "*.*.example.com", "*api.example.com"])(
    "refuses %s, a wildcard that is not the whole first label",
    (host) => {
      const refusal = hostRefusal(host);
      expect(refusal).toContain(`'${host}'`);
      expect(refusal).toContain("wildcard that is not its whole first label");
    },
  );

  it.each(["api.github.com", "*.example.com", "registry.npmjs.org", "deb.debian.org", "internal.example.com"])(
    "admits %s",
    (host) => {
      expect(hostRefusal(host)).toBeUndefined();
    },
  );
});

describe("hostAdmits", () => {
  it("admits an exact name, in any spelling of the request's host", () => {
    expect(hostAdmits("api.github.com", "api.github.com")).toBe(true);
    expect(hostAdmits("api.github.com", "API.GitHub.com.")).toBe(true);
    expect(hostAdmits("api.github.com", "github.com")).toBe(false);
    expect(hostAdmits("api.github.com", "uploads.api.github.com")).toBe(false);
  });

  it("admits exactly one more label under a wildcard, as the gateway does", () => {
    expect(hostAdmits("*.example.com", "api.example.com")).toBe(true);
    expect(hostAdmits("*.example.com", "API.Example.com")).toBe(true);
    expect(hostAdmits("*.example.com", "example.com")).toBe(false);
    expect(hostAdmits("*.example.com", "a.b.example.com")).toBe(false);
    expect(hostAdmits("*.example.com", "badexample.com")).toBe(false);
    expect(hostAdmits("*.example.com", ".example.com")).toBe(false);
  });
});

describe("the package-manager hosts", () => {
  const hosts = PACKAGE_MANAGER_HOSTS.map((entry) => entry.host);

  it("holds Managed Agents' published list plus Debian's archive", () => {
    for (const host of [
      "github.com",
      "api.github.com",
      "codeload.github.com",
      "raw.githubusercontent.com",
      "objects.githubusercontent.com",
      "registry.npmjs.org",
      "registry.yarnpkg.com",
      "pypi.org",
      "files.pythonhosted.org",
      "crates.io",
      "index.crates.io",
      "static.crates.io",
      "proxy.golang.org",
      "sum.golang.org",
      "repo1.maven.org",
      "rubygems.org",
      "packagist.org",
      "archive.ubuntu.com",
      "security.ubuntu.com",
      "registry-1.docker.io",
      "ghcr.io",
      "deb.debian.org",
    ]) {
      expect(hosts, host).toContain(host);
    }
  });

  it("lists each host once, every one a host the grammar admits", () => {
    expect(new Set(hosts).size).toBe(hosts.length);
    for (const host of hosts) {
      expect(hostRefusal(host), host).toBeUndefined();
      expect(normalizeHost(host), host).toBe(host);
    }
  });

  it("names the apt archives, and only them, for plain HTTP", () => {
    expect([...APT_ARCHIVE_HOSTS].sort()).toEqual(
      ["archive.ubuntu.com", "deb.debian.org", "ppa.launchpad.net", "security.ubuntu.com"],
    );
    expect(PACKAGE_MANAGER_HOSTS.filter((entry) => entry.cleartext).map((entry) => entry.host)).toEqual(
      [...APT_ARCHIVE_HOSTS],
    );
    expect(PACKAGE_MANAGER_HOSTS.find((entry) => entry.host === "registry.npmjs.org")?.cleartext).toBe(false);
  });
});
