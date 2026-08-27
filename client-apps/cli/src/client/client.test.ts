import { PlatformQueryController } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { afterEach, describe, expect, it } from "vitest";
import type { Config } from "../config/index.js";
import { createBackendClient } from "./client.js";

function cloud(token?: string): Config {
  return {
    backend: { type: "cloud" },
    backends: {
      cloud: { type: "cloud", endpoint: "api.stigmer.ai:443", token },
    },
    current_backend: "cloud",
  };
}

afterEach(() => {
  delete process.env.STIGMER_API_KEY;
  delete process.env.STIGMER_SERVER_ADDRESS;
});

describe("createBackendClient — endpoint normalization", () => {
  it("normalizes the cloud endpoint to an https base URL", () => {
    const client = createBackendClient({ config: cloud("t") });
    expect(client.stigmer.baseUrl).toBe("https://api.stigmer.ai:443");
  });

  it("normalizes the local endpoint to a plaintext base URL", () => {
    const client = createBackendClient({
      config: { backend: { type: "local" } },
    });
    expect(client.stigmer.baseUrl).toBe("http://localhost:7234");
  });
});

describe("createBackendClient — token precedence", () => {
  it("prefers STIGMER_API_KEY over the config token", async () => {
    process.env.STIGMER_API_KEY = "env-key";
    const client = createBackendClient({ config: cloud("config-token") });
    expect(await client.stigmer.getAuthCredential()).toBe("env-key");
  });

  it("falls back to the config token", async () => {
    const client = createBackendClient({ config: cloud("config-token") });
    expect(await client.stigmer.getAuthCredential()).toBe("config-token");
  });
});

describe("createBackendClient — controller factory", () => {
  it("creates a raw Connect client for a service controller", () => {
    const client = createBackendClient({ config: cloud("t") });
    const platform = client.controller(PlatformQueryController);
    expect(typeof platform.getServerInfo).toBe("function");
  });
});
