import { describe, it, expect } from "vitest";
import { validateConfig, type StigmerConfig } from "../config";

describe("validateConfig", () => {
  const validApiKeyConfig: StigmerConfig = {
    baseUrl: "https://api.stigmer.io",
    apiKey: "sk_live_abc123",
  };

  const validTokenProviderConfig: StigmerConfig = {
    baseUrl: "https://api.stigmer.io",
    getAccessToken: () => "token",
  };

  it("accepts a valid config with apiKey", () => {
    expect(() => validateConfig(validApiKeyConfig)).not.toThrow();
  });

  it("accepts a valid config with getAccessToken", () => {
    expect(() => validateConfig(validTokenProviderConfig)).not.toThrow();
  });

  it("rejects missing baseUrl", () => {
    expect(() =>
      validateConfig({ baseUrl: "", apiKey: "key" }),
    ).toThrow("stigmer: baseUrl is required");
  });

  it("rejects missing both apiKey and getAccessToken", () => {
    expect(() =>
      validateConfig({ baseUrl: "https://api.stigmer.io" }),
    ).toThrow("stigmer: either apiKey or getAccessToken must be provided");
  });

  it("rejects empty apiKey without getAccessToken", () => {
    expect(() =>
      validateConfig({ baseUrl: "https://api.stigmer.io", apiKey: "" }),
    ).toThrow("stigmer: either apiKey or getAccessToken must be provided");
  });

  it("rejects providing both apiKey and getAccessToken", () => {
    expect(() =>
      validateConfig({
        baseUrl: "https://api.stigmer.io",
        apiKey: "sk_live_abc123",
        getAccessToken: () => "token",
      }),
    ).toThrow(
      "stigmer: apiKey and getAccessToken are mutually exclusive — provide one, not both",
    );
  });
});
