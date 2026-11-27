// Tests for the model-registry read's answers: a refused read throws a
// typed error that carries the HTTP status, so a caller tells a refused
// credential (401) from a server that failed without reading the message,
// and a read sends the bearer only when it has one.

import { describe, it, expect, vi } from "vitest";
import { fetchModelRegistryDocument, ModelRegistryFetchError } from "../registry";

const DOCUMENT = {
  models: [{ id: "claude-sonnet-4-6", displayName: "Claude Sonnet 4.6", provider: "anthropic", harness: "stigmer", costTier: "standard" }],
};

function answering(status: number, body: unknown = {}) {
  return vi.fn(async (_url: string, _init?: { headers?: Record<string, string> }) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof globalThis.fetch & ReturnType<typeof vi.fn>;
}

describe("fetchModelRegistryDocument", () => {
  it("throws a ModelRegistryFetchError carrying the status when the read is refused", async () => {
    const fetch = answering(401);
    const failure = await fetchModelRegistryDocument("https://example.test", null, fetch).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ModelRegistryFetchError);
    expect(failure).toMatchObject({ name: "ModelRegistryFetchError", status: 401, message: "Model registry fetch failed: 401" });
  });

  it("tells a server failure from a refused credential by its status", async () => {
    const failure = await fetchModelRegistryDocument("https://example.test", "token", answering(503)).catch((e: unknown) => e);
    expect((failure as ModelRegistryFetchError).status).toBe(503);
  });

  it("sends the bearer only when there is a credential, and parses the document", async () => {
    const withToken = answering(200, DOCUMENT);
    const doc = await fetchModelRegistryDocument("https://example.test", "t0k", withToken);
    expect(doc.models.map((m) => m.modelId)).toEqual(["claude-sonnet-4-6"]);
    expect(withToken).toHaveBeenCalledWith("https://example.test/v1/proxy/model-registry", { headers: { Authorization: "Bearer t0k" } });

    const without = answering(200, DOCUMENT);
    await fetchModelRegistryDocument("https://example.test", null, without);
    expect(without).toHaveBeenCalledWith("https://example.test/v1/proxy/model-registry", { headers: {} });
  });
});
