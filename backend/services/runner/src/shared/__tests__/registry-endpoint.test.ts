import { describe, it, expect } from "vitest";
import {
  resolveRegistryBaseUrl,
  resolveModelRegistryUrl,
  buildRegistryHeaders,
} from "../registry-endpoint.js";

describe("resolveRegistryBaseUrl", () => {
  it("prefers STIGMER_CLOUD_API_URL over everything (explicit override)", () => {
    const env = {
      STIGMER_CLOUD_API_URL: "https://override.example.com",
      STIGMER_PROXY_ENDPOINT: "https://proxy.example.com",
      STIGMER_BACKEND_ENDPOINT: "http://localhost:7234",
    };
    expect(resolveRegistryBaseUrl(env)).toBe("https://override.example.com");
  });

  it("uses the proxy origin in proxy mode (it serves /v1/proxy/model-registry)", () => {
    const env = {
      STIGMER_PROXY_ENDPOINT: "https://api.stigmer.ai",
      STIGMER_BACKEND_ENDPOINT: "http://localhost:7234",
    };
    expect(resolveRegistryBaseUrl(env)).toBe("https://api.stigmer.ai");
  });

  it("uses the backend endpoint in direct/local mode (no proxy, no override)", () => {
    const env = { STIGMER_BACKEND_ENDPOINT: "http://localhost:7234" };
    expect(resolveRegistryBaseUrl(env)).toBe("http://localhost:7234");
  });

  it("defaults to the local stigmer-server when nothing is set", () => {
    expect(resolveRegistryBaseUrl({})).toBe("http://localhost:7234");
  });

  it("normalizes bare host:port endpoints (443 implies TLS)", () => {
    expect(resolveRegistryBaseUrl({ STIGMER_BACKEND_ENDPOINT: "api.stigmer.ai:443" }))
      .toBe("https://api.stigmer.ai:443");
    expect(resolveRegistryBaseUrl({ STIGMER_BACKEND_ENDPOINT: "backend:7234" }))
      .toBe("http://backend:7234");
    expect(resolveRegistryBaseUrl({ STIGMER_PROXY_ENDPOINT: "proxy.internal:443" }))
      .toBe("https://proxy.internal:443");
  });

  it("treats empty-string env values as unset", () => {
    const env = {
      STIGMER_CLOUD_API_URL: "",
      STIGMER_PROXY_ENDPOINT: "",
      STIGMER_BACKEND_ENDPOINT: "http://localhost:9999",
    };
    expect(resolveRegistryBaseUrl(env)).toBe("http://localhost:9999");
  });
});

describe("resolveModelRegistryUrl", () => {
  it("appends the model registry path to the resolved base", () => {
    const env = { STIGMER_BACKEND_ENDPOINT: "http://localhost:7234" };
    expect(resolveModelRegistryUrl(env)).toBe("http://localhost:7234/v1/proxy/model-registry");
  });
});

describe("buildRegistryHeaders", () => {
  it("returns bearer auth when STIGMER_TOKEN is set", () => {
    expect(buildRegistryHeaders({ STIGMER_TOKEN: "tok-1" }))
      .toEqual({ Authorization: "Bearer tok-1" });
  });

  it("falls back to STIGMER_AUTH_TOKEN", () => {
    expect(buildRegistryHeaders({ STIGMER_AUTH_TOKEN: "tok-2" }))
      .toEqual({ Authorization: "Bearer tok-2" });
  });

  it("prefers STIGMER_TOKEN over STIGMER_AUTH_TOKEN", () => {
    expect(buildRegistryHeaders({ STIGMER_TOKEN: "tok-1", STIGMER_AUTH_TOKEN: "tok-2" }))
      .toEqual({ Authorization: "Bearer tok-1" });
  });

  it("returns no headers when tokenless (local server needs none)", () => {
    expect(buildRegistryHeaders({})).toEqual({});
  });
});
