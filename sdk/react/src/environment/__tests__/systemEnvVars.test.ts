import { describe, it, expect } from "vitest";
import {
  toGrpcAddress,
  buildSystemEnvVars,
  SYSTEM_ENV_VAR_KEYS,
} from "../systemEnvVars";

// ---------------------------------------------------------------------------
// toGrpcAddress
// ---------------------------------------------------------------------------

describe("toGrpcAddress", () => {
  it("extracts host and explicit port from http URL", () => {
    expect(toGrpcAddress("http://localhost:7234")).toBe("localhost:7234");
  });

  it("defaults to port 443 for https without explicit port", () => {
    expect(toGrpcAddress("https://api.stigmer.ai")).toBe(
      "api.stigmer.ai:443",
    );
  });

  it("preserves explicit port on https URL", () => {
    expect(toGrpcAddress("https://api.stigmer.ai:8443")).toBe(
      "api.stigmer.ai:8443",
    );
  });

  it("defaults to port 80 for http without explicit port", () => {
    expect(toGrpcAddress("http://api.local")).toBe("api.local:80");
  });

  it("handles IPv6 localhost", () => {
    expect(toGrpcAddress("http://[::1]:7234")).toBe("[::1]:7234");
  });

  it("returns input unchanged for non-URL strings", () => {
    expect(toGrpcAddress("not-a-url")).toBe("not-a-url");
  });

  it("handles trailing slash", () => {
    expect(toGrpcAddress("http://localhost:7234/")).toBe("localhost:7234");
  });

  it("strips path components", () => {
    expect(toGrpcAddress("https://api.stigmer.ai/v1/rpc")).toBe(
      "api.stigmer.ai:443",
    );
  });
});

// ---------------------------------------------------------------------------
// buildSystemEnvVars
// ---------------------------------------------------------------------------

describe("buildSystemEnvVars", () => {
  it("returns both system env vars", () => {
    const result = buildSystemEnvVars(
      "http://localhost:7234",
      "test-token",
    );

    expect(Object.keys(result)).toHaveLength(2);
    expect(result).toHaveProperty("STIGMER_SERVER_ADDRESS");
    expect(result).toHaveProperty("STIGMER_API_KEY");
  });

  it("derives gRPC address from baseUrl", () => {
    const result = buildSystemEnvVars(
      "https://api.stigmer.ai",
      "tok",
    );

    expect(result.STIGMER_SERVER_ADDRESS.value).toBe(
      "api.stigmer.ai:443",
    );
    expect(result.STIGMER_SERVER_ADDRESS.isSecret).toBe(false);
  });

  it("uses credential as API key value", () => {
    const result = buildSystemEnvVars(
      "http://localhost:7234",
      "my-api-key",
    );

    expect(result.STIGMER_API_KEY.value).toBe("my-api-key");
    expect(result.STIGMER_API_KEY.isSecret).toBe(true);
  });

  it('uses "unused" placeholder when credential is null', () => {
    const result = buildSystemEnvVars("http://localhost:7234", null);

    expect(result.STIGMER_API_KEY.value).toBe("unused");
  });

  it('uses "unused" placeholder when credential is empty string', () => {
    const result = buildSystemEnvVars("http://localhost:7234", "");

    expect(result.STIGMER_API_KEY.value).toBe("unused");
  });

  it("keys match SYSTEM_ENV_VAR_KEYS constant", () => {
    const result = buildSystemEnvVars("http://localhost:7234", "tok");
    const resultKeys = new Set(Object.keys(result));

    expect(resultKeys).toEqual(SYSTEM_ENV_VAR_KEYS);
  });
});

// ---------------------------------------------------------------------------
// SYSTEM_ENV_VAR_KEYS
// ---------------------------------------------------------------------------

describe("SYSTEM_ENV_VAR_KEYS", () => {
  it("contains exactly the two expected keys", () => {
    expect(SYSTEM_ENV_VAR_KEYS.size).toBe(2);
    expect(SYSTEM_ENV_VAR_KEYS.has("STIGMER_SERVER_ADDRESS")).toBe(true);
    expect(SYSTEM_ENV_VAR_KEYS.has("STIGMER_API_KEY")).toBe(true);
  });
});
