/**
 * Unit tests for the SDK's system env vars: the dial-target rule (the same
 * table as the runner's `grpcTarget`), the address included only when it
 * can be dialled, and the public address taking precedence over the
 * client's base URL (stigmer/stigmer#1433).
 */
import { describe, it, expect } from "vitest";
import type { Stigmer } from "@stigmer/sdk";
import {
  toGrpcAddress,
  buildSystemEnvVars,
  resolveSystemEnvVarValues,
  resolveDeclaredSystemEnvVars,
  SYSTEM_ENV_VAR_KEYS,
} from "../systemEnvVars";

function stigmerAt(baseUrl: string): Stigmer {
  return { baseUrl, getAuthCredential: async () => "tok" } as unknown as Stigmer;
}

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

  it("keeps an explicit default port", () => {
    expect(toGrpcAddress("http://stigmer.lan:80")).toBe("stigmer.lan:80");
  });

  it.each([
    ["localhost:7234"],
    ["stigmer-server.stigmer-prod.svc.cluster.local:80"],
    ["api.stigmer.ai"],
    ["/"],
  ])("returns a value that is not an http(s) URL unchanged: %s", (input) => {
    expect(toGrpcAddress(input)).toBe(input);
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

  it.each([["/"], ["/api"], ["localhost:7234"]])(
    "leaves the address out for a base URL nothing outside the page can dial: %s",
    (baseUrl) => {
      const result = buildSystemEnvVars(baseUrl, "tok");

      expect(result).not.toHaveProperty("STIGMER_SERVER_ADDRESS");
      expect(result.STIGMER_API_KEY.value).toBe("tok");
    },
  );

  it("leaves the address out when the base URL is unknown", () => {
    expect(buildSystemEnvVars(null, "tok")).not.toHaveProperty(
      "STIGMER_SERVER_ADDRESS",
    );
  });

  it("keys match SYSTEM_ENV_VAR_KEYS constant", () => {
    const result = buildSystemEnvVars("http://localhost:7234", "tok");
    const resultKeys = new Set(Object.keys(result));

    expect(resultKeys).toEqual(SYSTEM_ENV_VAR_KEYS);
  });
});

// ---------------------------------------------------------------------------
// resolveSystemEnvVarValues / resolveDeclaredSystemEnvVars
// ---------------------------------------------------------------------------

describe("resolveSystemEnvVarValues", () => {
  it("derives the address from an absolute client base URL", async () => {
    const result = await resolveSystemEnvVarValues(stigmerAt("https://api.example.com"));

    expect(result.STIGMER_SERVER_ADDRESS.value).toBe("api.example.com:443");
  });

  it("prefers the host's public base URL over the client's", async () => {
    const result = await resolveSystemEnvVarValues(stigmerAt("/"), {
      publicBaseUrl: "https://api.example.com",
    });

    expect(result.STIGMER_SERVER_ADDRESS.value).toBe("api.example.com:443");
  });

  it("leaves the address out for a relative client base URL and no public one", async () => {
    const result = await resolveSystemEnvVarValues(stigmerAt("/"));

    expect(result).not.toHaveProperty("STIGMER_SERVER_ADDRESS");
    expect(result.STIGMER_API_KEY.value).toBe("tok");
  });

  it("ignores a public base URL that is not absolute", async () => {
    const result = await resolveSystemEnvVarValues(stigmerAt("/"), {
      publicBaseUrl: "api.example.com",
    });

    expect(result).not.toHaveProperty("STIGMER_SERVER_ADDRESS");
  });
});

describe("resolveDeclaredSystemEnvVars", () => {
  it("passes the public base URL through to the declared address", async () => {
    const result = await resolveDeclaredSystemEnvVars(
      stigmerAt("/"),
      ["STIGMER_SERVER_ADDRESS"],
      { publicBaseUrl: "https://api.example.com" },
    );

    expect(result).toEqual({
      STIGMER_SERVER_ADDRESS: expect.objectContaining({ value: "api.example.com:443" }),
    });
  });

  it("answers nothing for a declared address it cannot resolve", async () => {
    const result = await resolveDeclaredSystemEnvVars(stigmerAt("/"), [
      "STIGMER_SERVER_ADDRESS",
    ]);

    expect(result).toEqual({});
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
