// Pins CloudTarget.modelRegistryDocument: the billing suite's catalog arm
// reads the registry the composition serves on its authenticated proxy lane,
// so the target fetches /v1/proxy/model-registry from the CLOUD_ENV proxy
// address with the primary user's bearer, and parses what it answers. fetch
// is stubbed; nothing here starts a server.
import { afterEach, describe, expect, it, vi } from "vitest";

import { CLOUD_ENV } from "../../harness/cloud-env";
import { CloudTarget } from "../cloud";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("CloudTarget.modelRegistryDocument", () => {
  it("fetches the proxy lane's registry with the primary user's bearer and parses its rows", async () => {
    vi.stubEnv(CLOUD_ENV.proxyAddress, "http://127.0.0.1:52999/");
    vi.stubEnv(CLOUD_ENV.token, "primary-token");
    const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ models: [{ id: "stepped", pricing: { longContext: { thresholdTokens: 100000 } } }] }), { status: 200 }),
    );

    const document = await new CloudTarget().modelRegistryDocument();

    expect(fetched).toHaveBeenCalledWith("http://127.0.0.1:52999/v1/proxy/model-registry", {
      headers: { authorization: "Bearer primary-token" },
    });
    expect(document.models.map((row) => [row.id, row.longContext])).toEqual([["stepped", { thresholdTokens: 100000 }]]);
  });
});
