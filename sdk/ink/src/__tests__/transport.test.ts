import { describe, it, expect } from "vitest";
import { createNodeClient, createNodeTransport } from "../transport.js";

describe("createNodeTransport", () => {
  it("creates a transport with a base URL", () => {
    const transport = createNodeTransport({
      baseUrl: "https://api.stigmer.ai",
      apiKey: "sk_test_123",
    });
    expect(transport).toBeDefined();
  });

  it("creates a transport with a token provider", () => {
    const transport = createNodeTransport({
      baseUrl: "https://api.stigmer.ai",
      getAccessToken: () => "token_abc",
    });
    expect(transport).toBeDefined();
  });

  it("creates a transport without auth", () => {
    const transport = createNodeTransport({
      baseUrl: "https://api.stigmer.ai",
    });
    expect(transport).toBeDefined();
  });
});

describe("createNodeClient", () => {
  it("creates a Stigmer client with API key", () => {
    const client = createNodeClient({
      baseUrl: "https://api.stigmer.ai",
      apiKey: "sk_test_123",
    });
    expect(client).toBeDefined();
    expect(client.baseUrl).toBe("https://api.stigmer.ai");
  });

  it("creates a Stigmer client with token provider", () => {
    const client = createNodeClient({
      baseUrl: "https://api.stigmer.ai",
      getAccessToken: () => "token_abc",
    });
    expect(client).toBeDefined();
    expect(client.baseUrl).toBe("https://api.stigmer.ai");
  });

  it("exposes resource sub-clients", () => {
    const client = createNodeClient({
      baseUrl: "https://api.stigmer.ai",
      apiKey: "sk_test_123",
    });
    expect(client.agent).toBeDefined();
    expect(client.session).toBeDefined();
    expect(client.agentExecution).toBeDefined();
  });
});
