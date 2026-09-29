/**
 * Pins the rule for the server's public base URL, the address every copy
 * surface builds its URLs from (stigmer/stigmer#1335): the host's
 * `publicBaseUrl` wins, the client's `baseUrl` stands in when it is
 * absolute, and nothing is guessed. A relative `baseUrl` with no host answer
 * is unknown (`null`), never resolved against the page, and a `publicBaseUrl`
 * that is not an absolute `http(s)` URL counts for nothing. Also pins that
 * `StigmerProvider`'s prop reaches the hook.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerProvider } from "../provider";
import { resolvePublicBaseUrl, usePublicBaseUrl } from "../public-base-url-context";

afterEach(cleanup);

describe("resolvePublicBaseUrl", () => {
  it("uses an absolute client baseUrl when the host names none, exactly as before", () => {
    expect(resolvePublicBaseUrl(undefined, "https://api.stigmer.ai")).toBe(
      "https://api.stigmer.ai",
    );
  });

  it("prefers the host's public base URL over the client's", () => {
    expect(
      resolvePublicBaseUrl("https://api.example.com", "http://localhost:7234"),
    ).toBe("https://api.example.com");
  });

  it("trims trailing slashes", () => {
    expect(resolvePublicBaseUrl("https://api.example.com///", "/")).toBe(
      "https://api.example.com",
    );
    expect(resolvePublicBaseUrl(undefined, "https://stigmer.acme.internal:8443/")).toBe(
      "https://stigmer.acme.internal:8443",
    );
  });

  it("answers null for a relative client baseUrl with no host answer, never the page's origin", () => {
    expect(resolvePublicBaseUrl(undefined, "/")).toBeNull();
    expect(resolvePublicBaseUrl(undefined, "")).toBeNull();
    expect(resolvePublicBaseUrl(undefined, "/api")).toBeNull();
  });

  it("ignores a host value that is not an absolute http(s) URL", () => {
    expect(resolvePublicBaseUrl("/api", "/")).toBeNull();
    expect(resolvePublicBaseUrl("/api", "https://api.stigmer.ai")).toBe(
      "https://api.stigmer.ai",
    );
    // `new URL` parses these, with `localhost:` and `ftp:` as schemes.
    expect(resolvePublicBaseUrl("localhost:7234", "/")).toBeNull();
    expect(resolvePublicBaseUrl("ftp://files.example.com", "/")).toBeNull();
  });
});

// A minimal client: the provider eagerly fetches the model/task-kind
// registries on mount; a null credential keeps that work non-blocking.
function makeClient(baseUrl: string): Stigmer {
  return {
    baseUrl,
    getAuthCredential: async () => null,
    fetch: (async () => {
      throw new Error("network disabled in test");
    }) as unknown as typeof globalThis.fetch,
  } as unknown as Stigmer;
}

function Probe() {
  return <output>{usePublicBaseUrl() ?? "unknown"}</output>;
}

describe("usePublicBaseUrl under StigmerProvider", () => {
  it("reads the provider's publicBaseUrl", () => {
    render(
      <StigmerProvider client={makeClient("/")} publicBaseUrl="https://api.example.com/">
        <Probe />
      </StigmerProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("https://api.example.com");
  });

  it("falls back to the client's absolute baseUrl when the prop is omitted", () => {
    render(
      <StigmerProvider client={makeClient("http://localhost:7234")}>
        <Probe />
      </StigmerProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("http://localhost:7234");
  });

  it("is unknown for a relative client baseUrl with the prop omitted", () => {
    render(
      <StigmerProvider client={makeClient("/")}>
        <Probe />
      </StigmerProvider>,
    );
    expect(screen.getByRole("status").textContent).toBe("unknown");
  });
});
