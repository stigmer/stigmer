import { describe, expect, it } from "vitest";
import { normalizeEndpoint } from "./node";

describe("normalizeEndpoint", () => {
  it.each([
    // Loopback hosts stay plaintext (the local daemon default).
    ["localhost:7234", "http://localhost:7234"],
    ["127.0.0.1:7234", "http://127.0.0.1:7234"],
    ["[::1]:7234", "http://[::1]:7234"],
    // Explicit :443 is TLS; any other explicit port is plaintext.
    ["api.stigmer.ai:443", "https://api.stigmer.ai:443"],
    ["internal:8080", "http://internal:8080"],
    // No port on a public host → assume TLS on :443.
    ["api.stigmer.ai", "https://api.stigmer.ai:443"],
    // Loopback without a port stays plaintext and is left as-is.
    ["localhost", "http://localhost"],
  ])("normalizes %s → %s", (input, expected) => {
    expect(normalizeEndpoint(input)).toBe(expected);
  });

  it("strips a URL scheme and derives TLS from the port, not the scheme", () => {
    // Mirrors the Go rule's quirk: the port is authoritative for TLS.
    expect(normalizeEndpoint("https://api.stigmer.ai")).toBe("https://api.stigmer.ai:443");
    expect(normalizeEndpoint("http://internal:8080")).toBe("http://internal:8080");
    expect(normalizeEndpoint("https://internal:8080")).toBe("http://internal:8080");
  });

  it("trims whitespace and trailing slashes", () => {
    expect(normalizeEndpoint("  api.stigmer.ai:443/  ")).toBe("https://api.stigmer.ai:443");
    expect(normalizeEndpoint("https://api.stigmer.ai/")).toBe("https://api.stigmer.ai:443");
  });

  it("throws on empty input", () => {
    expect(() => normalizeEndpoint("")).toThrow(/must not be empty/);
    expect(() => normalizeEndpoint("   ")).toThrow(/must not be empty/);
    expect(() => normalizeEndpoint("https://")).toThrow(/no host/);
  });
});
