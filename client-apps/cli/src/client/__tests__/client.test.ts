import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  GetServerInfoOutputSchema,
  PlatformQueryController,
  ServerEdition,
} from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../config/index.js";
import { CliExitError, ExitCode } from "../../errors/index.js";
import { dialedServerAddress, setServerAddress } from "../../runtime.js";
import { createBackendClient } from "../client.js";

function cloud(token?: string): Config {
  return {
    backend: {},
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
      config: { backend: {} },
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

describe("BackendClient — the server's edition and what it serves", () => {
  it("answers the tier question against the server's REPORTED edition, not the config's backend type", async () => {
    // The config says "cloud"; the server says it is the open-source edition.
    // The server wins: a cloud-only kind is not served, a core kind is.
    const oss = serverAnswering(ServerEdition.oss);
    const client = createBackendClient({
      config: cloud("t"),
      transport: oss.transport,
    });
    expect(await client.isResourceAvailable(ApiResourceKind.subscription)).toBe(
      false,
    );
    expect(await client.isResourceAvailable(ApiResourceKind.agent)).toBe(true);

    const cloudServer = serverAnswering(ServerEdition.cloud);
    const onCloud = createBackendClient({
      config: cloud("t"),
      transport: cloudServer.transport,
    });
    expect(
      await onCloud.isResourceAvailable(ApiResourceKind.subscription),
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
    await client.isResourceAvailable(ApiResourceKind.subscription);
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
    expect(await client.isResourceAvailable(ApiResourceKind.subscription)).toBe(
      true,
    );
    expect(server.asked(), "the rejection was not cached").toBe(2);
  });
});

describe("CLI-04 the client records the address it dials, and where that came from", () => {
  afterEach(() => {
    setServerAddress(undefined);
    vi.useRealTimers();
  });

  const cases: ReadonlyArray<readonly [string, Config, string, string]> = [
    ["the local daemon", { backend: {} }, "localhost:7234", "local"],
    ["a cloud backend's own endpoint", { backend: {}, backends: { c: { type: "cloud", endpoint: "api.example.com:443" } }, current_backend: "c" }, "api.example.com:443", "cloud"],
    ["Stigmer Cloud's endpoint for a cloud backend with none", { backend: {}, backends: { c: { type: "cloud" } }, current_backend: "c" }, "api.stigmer.ai:443", "cloud"],
    ["a self-hosted backend", { backend: {}, backends: { s: { type: "selfhost", endpoint: "stigmer.acme.internal:7234" } }, current_backend: "s" }, "stigmer.acme.internal:7234", "selfhost"],
  ];

  it.each(cases)("records %s", (_name, config, address, source) => {
    createBackendClient({ config });
    expect(dialedServerAddress()).toEqual({ address, source });
  });

  it("records STIGMER_SERVER_ADDRESS as the source when it overrides the backend", () => {
    process.env.STIGMER_SERVER_ADDRESS = "10.0.0.5:7234";
    createBackendClient({ config: cloud("t") });
    expect(dialedServerAddress()).toEqual({ address: "10.0.0.5:7234", source: "environment" });
  });

  it("words the connect timeout as an unreachable server at that address, with how long it waited", async () => {
    vi.useFakeTimers();
    const silent = createRouterTransport(({ service }) => {
      service(PlatformQueryController, { getServerInfo: () => new Promise<never>(() => undefined) });
    });
    const client = createBackendClient({ config: cloud("t"), transport: silent });
    const failure = client.connect(2_500).catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(2_500);
    const error = await failure;
    expect(error).toBeInstanceOf(CliExitError);
    expect(error).toMatchObject({
      exitCode: ExitCode.Connection,
      message: "Could not reach the Stigmer server at api.stigmer.ai:443",
      hints: ["It did not answer within 2.5 seconds.", "Check the backend: stigmer config backend status"],
    });
  });
});
