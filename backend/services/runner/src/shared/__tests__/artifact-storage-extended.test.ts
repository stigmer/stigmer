/**
 * Extended artifact storage tests — ported from Python test_local_storage.py.
 *
 * Adds download URL construction, upload/download round-trip, exists for
 * missing keys, and proxy backend URL formatting.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalArtifactStorage, ProxyArtifactStorage, createArtifactStorage } from "../artifact-storage.js";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "as-test-"));
}

describe("LocalArtifactStorage", () => {
  let basePath: string;
  let storage: LocalArtifactStorage;

  beforeEach(() => {
    basePath = makeTempDir();
    storage = new LocalArtifactStorage(basePath, "http://localhost:7235");
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  describe("upload", () => {
    it("writes content to the correct path", async () => {
      await storage.upload("exec-1/file.txt", Buffer.from("hello"));
      const content = readFileSync(join(basePath, "exec-1/file.txt"), "utf-8");
      expect(content).toBe("hello");
    });

    it("creates nested directories automatically", async () => {
      await storage.upload("deep/nested/dir/file.txt", Buffer.from("deep"));
      const content = readFileSync(join(basePath, "deep/nested/dir/file.txt"), "utf-8");
      expect(content).toBe("deep");
    });

    it("returns the key on success", async () => {
      const key = await storage.upload("key.txt", Buffer.from("data"));
      expect(key).toBe("key.txt");
    });

    it("overwrites existing files", async () => {
      await storage.upload("overwrite.txt", Buffer.from("first"));
      await storage.upload("overwrite.txt", Buffer.from("second"));
      const content = readFileSync(join(basePath, "overwrite.txt"), "utf-8");
      expect(content).toBe("second");
    });
  });

  describe("getDownloadUrl", () => {
    it("constructs URL without double slashes", async () => {
      const url = await storage.getDownloadUrl("exec-1/file.txt");
      expect(url).toBe("http://localhost:7235/exec-1/file.txt");
    });

    it("strips trailing slash from serve URL base", async () => {
      const s = new LocalArtifactStorage(basePath, "http://localhost:7235/");
      const url = await s.getDownloadUrl("file.txt");
      expect(url).toBe("http://localhost:7235/file.txt");
    });
  });

  describe("download", () => {
    it("round-trips uploaded content byte-exact", async () => {
      await storage.upload("exec-1/file.txt", Buffer.from("round-trip"));
      const got = await storage.download("exec-1/file.txt");
      expect(got.toString("utf-8")).toBe("round-trip");
    });

    it("throws a key-scoped error for a missing key", async () => {
      await expect(storage.download("missing.txt")).rejects.toThrow(
        /Artifact not found for key 'missing\.txt'/,
      );
    });
  });

  describe("exists", () => {
    it("returns true after upload", async () => {
      await storage.upload("present.txt", Buffer.from("data"));
      expect(await storage.exists("present.txt")).toBe(true);
    });

    it("returns false for non-existent key", async () => {
      expect(await storage.exists("missing.txt")).toBe(false);
    });

    it("returns false for nested non-existent key", async () => {
      expect(await storage.exists("deep/path/missing.txt")).toBe(false);
    });
  });
});

describe("ProxyArtifactStorage", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls presigned-upload-url endpoint on upload", async () => {
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "https://r2.example.com/presigned", headers: {} }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        text: async () => "",
      } as any);

    await storage.upload("key.txt", Buffer.from("content"), "text/plain");

    expect(fetch).toHaveBeenCalledTimes(2);
    const firstCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(firstCall[0]).toBe("https://proxy.example.com/v1/proxy/artifacts/presigned-upload-url");
  });

  it("throws on presign failure", async () => {
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    } as any);

    await expect(
      storage.upload("key.txt", Buffer.from("data")),
    ).rejects.toThrow("HTTP 403");
  });

  it("calls presigned-download-url for getDownloadUrl", async () => {
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: "https://r2.example.com/download/key.txt" }),
    } as any);

    const url = await storage.getDownloadUrl("key.txt");
    expect(url).toBe("https://r2.example.com/download/key.txt");
  });

  it("download resolves a presigned URL then fetches the bytes", async () => {
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "https://r2.example.com/dl/key.txt" }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("proxy-bytes").buffer,
      } as any);

    const got = await storage.download("key.txt");
    expect(got.toString("utf-8")).toBe("proxy-bytes");
  });

  it("download throws with HTTP status and key on a failed fetch", async () => {
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");

    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "https://r2.example.com/dl/missing.txt" }),
      } as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "not found",
      } as any);

    await expect(storage.download("missing.txt")).rejects.toThrow(
      /Artifact download failed \(HTTP 404\) for key 'missing\.txt'/,
    );
  });

  it("exists returns true when the object is present (presign + ranged GET)", async () => {
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");

    // Two-step probe: presign mints the URL, then a ranged GET hits the object.
    // Presign success alone is NOT existence — the object fetch is authoritative.
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("presigned-download-url")) {
        return new Response(JSON.stringify({ url: "https://r2.example.com/dl" }), { status: 200 });
      }
      return new Response(Buffer.from("x"), { status: 206 });
    }) as typeof fetch;

    expect(await storage.exists("key.txt")).toBe(true);
  });

  it("exists returns false when the presign endpoint fails", async () => {
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");

    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 404 })) as typeof fetch;

    expect(await storage.exists("missing.txt")).toBe(false);
  });
});

describe("createArtifactStorage", () => {
  it("creates LocalArtifactStorage for local type", () => {
    const storage = createArtifactStorage({
      type: "local",
      localPath: "/var/artifacts",
      localServeUrl: "http://localhost:7235",
      proxyEndpoint: null,
      proxyAuthToken: null,
    });
    expect(storage).toBeInstanceOf(LocalArtifactStorage);
  });

  it("creates ProxyArtifactStorage for proxy type", () => {
    const storage = createArtifactStorage({
      type: "proxy",
      localPath: "/var/artifacts",
      localServeUrl: "http://localhost:7235",
      proxyEndpoint: "https://proxy.example.com",
      proxyAuthToken: "token",
    });
    expect(storage).toBeInstanceOf(ProxyArtifactStorage);
  });

  it("throws when proxy type lacks endpoint", () => {
    expect(() => createArtifactStorage({
      type: "proxy",
      localPath: "/var/artifacts",
      localServeUrl: "http://localhost:7235",
      proxyEndpoint: null,
      proxyAuthToken: "token",
    })).toThrow("STIGMER_PROXY_ENDPOINT");
  });

  it("throws when proxy type lacks auth token", () => {
    expect(() => createArtifactStorage({
      type: "proxy",
      localPath: "/var/artifacts",
      localServeUrl: "http://localhost:7235",
      proxyEndpoint: "https://proxy.example.com",
      proxyAuthToken: null,
    })).toThrow("STIGMER_TOKEN");
  });
});
