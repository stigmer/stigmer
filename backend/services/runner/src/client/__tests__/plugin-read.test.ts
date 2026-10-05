import { describe, it, expect, vi } from "vitest";

/**
 * Pins the client's four plugin reads, what the runtime mounts an agent's
 * hooks from: `getPlugin` and `getPluginByReference` on
 * PluginQueryController's `get` and `getByReference`, and the archive by its
 * storage key through `getArtifact` and `getArtifactDownloadUrl`, each with
 * the values as given and its answer unchanged. The transport and the
 * generated clients are replaced at their module seams.
 */

const get = vi.fn();
const getByReference = vi.fn();
const getArtifact = vi.fn();
const getArtifactDownloadUrl = vi.fn();

vi.mock("@connectrpc/connect-node", () => ({
  createGrpcTransport: () => ({}),
}));

vi.mock("@connectrpc/connect", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@connectrpc/connect")>();
  return {
    ...actual,
    createClient: (service: { typeName: string }) =>
      service.typeName === "ai.stigmer.agentic.plugin.v1.PluginQueryController"
        ? { get, getByReference, getArtifact, getArtifactDownloadUrl }
        : {},
  };
});

import { StigmerClient } from "../stigmer-client.js";

describe("StigmerClient plugin reads", () => {
  const client = new StigmerClient({ endpoint: "localhost:7234", token: null });

  it("reads a plugin by id and by reference", async () => {
    get.mockResolvedValue({ metadata: { id: "plg_1" } });
    getByReference.mockResolvedValue({ metadata: { slug: "safety" } });
    const ref = { org: "acme", slug: "safety", kind: 58, version: "" };

    expect(await client.getPlugin("plg_1")).toEqual({ metadata: { id: "plg_1" } });
    expect(get).toHaveBeenCalledWith({ value: "plg_1" });
    expect(await client.getPluginByReference(ref as never)).toEqual({ metadata: { slug: "safety" } });
    expect(getByReference).toHaveBeenCalledWith(ref);
  });

  it("reads a plugin's archive by its storage key, inline or by a download URL", async () => {
    getArtifact.mockResolvedValue({ artifact: new Uint8Array([1]) });
    getArtifactDownloadUrl.mockResolvedValue({ url: "http://x/plugins/a.zip", sizeBytes: 1n });

    expect(await client.getPluginArtifact("plugins/a.zip")).toEqual({ artifact: new Uint8Array([1]) });
    expect(getArtifact).toHaveBeenCalledWith({ artifactStorageKey: "plugins/a.zip" });
    expect(await client.getPluginArtifactDownloadUrl("plugins/a.zip")).toEqual({ url: "http://x/plugins/a.zip", sizeBytes: 1n });
    expect(getArtifactDownloadUrl).toHaveBeenCalledWith({ artifactStorageKey: "plugins/a.zip" });
  });
});
