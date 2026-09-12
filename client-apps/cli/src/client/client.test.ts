import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
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

// An in-memory server that answers getServerInfo with one edition and counts
// how often it was asked. `answers` is consumed in order; the last entry
// repeats, so a single-entry list is a steady server and a two-entry list is
// "fails once, then recovers".
function serverAnswering(...answers: Array<ServerEdition | ConnectError>): {
  transport: ReturnType<typeof createRouterTransport>;
  asked: () => number;
} {
  let asked = 0;
  const transport = createRouterTransport(({ service }) => {
    service(PlatformQueryController, {
      getServerInfo: () => {
        const answer = answers[Math.min(asked, answers.length - 1)]!;
        asked += 1;
        if (answer instanceof ConnectError) throw answer;
        return create(GetServerInfoOutputSchema, {
          edition: answer,
          version: "1.2.3",
        });
      },
    });
  });
  return { transport, asked: () => asked };
}

describe("BackendClient — the server's edition and what it serves (20260911.11 A3)", () => {
  it("answers the tier question against the server's REPORTED edition, not the config's backend type", async () => {
    // The config says "cloud"; the server says it is the open-source edition.
    // The server wins: a cloud-only kind is not served, a core kind is.
    const oss = serverAnswering(ServerEdition.oss);
    const client = createBackendClient({
      config: cloud("t"),
      transport: oss.transport,
    });
    expect(
      await client.isResourceAvailable(ApiResourceKind.platform_client),
    ).toBe(false);
    expect(await client.isResourceAvailable(ApiResourceKind.agent)).toBe(true);

    const cloudServer = serverAnswering(ServerEdition.cloud);
    const onCloud = createBackendClient({
      config: cloud("t"),
      transport: cloudServer.transport,
    });
    expect(
      await onCloud.isResourceAvailable(ApiResourceKind.platform_client),
    ).toBe(true);
  });

  it("asks the server once per process: connect() and every availability question share the answer", async () => {
    const server = serverAnswering(ServerEdition.oss);
    const client = createBackendClient({
      config: cloud("t"),
      transport: server.transport,
    });
    await client.connect();
    await client.isResourceAvailable(ApiResourceKind.agent);
    await client.isResourceAvailable(ApiResourceKind.platform_client);
    const info = await client.serverInfo();
    expect(info.deploymentMode).toBe("local");
    expect(info.version).toBe("1.2.3");
    expect(server.asked(), "one getServerInfo for the whole process").toBe(1);
  });

  it("a failed probe propagates and is not remembered — the next question asks again", async () => {
    const server = serverAnswering(
      new ConnectError("server warming up", Code.Unavailable),
      ServerEdition.cloud,
    );
    const client = createBackendClient({
      config: cloud("t"),
      transport: server.transport,
    });
    await expect(client.serverInfo()).rejects.toThrow("server warming up");
    expect(
      await client.isResourceAvailable(ApiResourceKind.platform_client),
    ).toBe(true);
    expect(server.asked(), "the rejection was not cached").toBe(2);
  });
});
