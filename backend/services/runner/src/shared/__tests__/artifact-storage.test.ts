import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LocalArtifactStorage,
  ProxyArtifactStorage,
  createArtifactStorage,
  resolveUsableArtifactStorage,
  loadArtifactStorageConfig,
  type ArtifactStorageConfig,
} from "../artifact-storage.js";
import { deriveCaptureMode } from "../filereview/capture.js";

// ── LocalArtifactStorage ─────────────────────────────────────────────

describe("LocalArtifactStorage", () => {
  let tempDir: string;
  let storage: LocalArtifactStorage;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "artifact-test-"));
    storage = new LocalArtifactStorage(tempDir, "http://localhost:7235");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uploads a file and creates intermediate directories", async () => {
    const content = Buffer.from("hello world");
    const key = "artifacts/exec-123/report.txt";

    const returnedKey = await storage.upload(key, content);

    expect(returnedKey).toBe(key);
    const written = await readFile(join(tempDir, key));
    expect(written.toString()).toBe("hello world");
  });

  it("returns a direct download URL using serve base", async () => {
    const url = await storage.getDownloadUrl("artifacts/exec-123/report.txt");
    expect(url).toBe("http://localhost:7235/artifacts/exec-123/report.txt");
  });

  it("strips trailing slashes from serve URL base", async () => {
    const s = new LocalArtifactStorage(tempDir, "http://localhost:7235/");
    const url = await s.getDownloadUrl("artifacts/file.txt");
    expect(url).toBe("http://localhost:7235/artifacts/file.txt");
  });

  it("returns true for existing keys", async () => {
    const key = "artifacts/exec-1/file.bin";
    await storage.upload(key, Buffer.from("data"));
    expect(await storage.exists(key)).toBe(true);
  });

  it("returns false for missing keys", async () => {
    expect(await storage.exists("nonexistent/file.bin")).toBe(false);
  });

  it("overwrites existing files on re-upload", async () => {
    const key = "artifacts/exec-1/file.txt";
    await storage.upload(key, Buffer.from("v1"));
    await storage.upload(key, Buffer.from("v2"));

    const written = await readFile(join(tempDir, key));
    expect(written.toString()).toBe("v2");
  });

  it("downloads uploaded text bytes byte-exact (inverse of upload)", async () => {
    const key = "artifacts/exec-1/report.txt";
    await storage.upload(key, Buffer.from("hello world"));
    const got = await storage.download(key);
    expect(got.toString()).toBe("hello world");
  });

  it("downloads binary bytes (incl. NUL) byte-exact", async () => {
    const key = "artifacts/exec-1/blob.bin";
    const bytes = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x00, 0x89, 0x50]);
    await storage.upload(key, bytes);
    const got = await storage.download(key);
    expect(Buffer.compare(got, bytes)).toBe(0);
  });

  it("throws a key-scoped error when downloading a missing key", async () => {
    await expect(storage.download("artifacts/exec-1/missing.bin")).rejects.toThrow(
      /Artifact not found for key 'artifacts\/exec-1\/missing\.bin'/,
    );
  });

  it("reads directly off disk even with an unreachable serve URL (no HTTP dependency)", async () => {
    // A bogus, unroutable serve base: if `download` fetched over HTTP this would
    // hang/throw. Reading straight off disk proves the runner's read-back does
    // not depend on the serve URL being set or reachable.
    const s = new LocalArtifactStorage(tempDir, "http://127.0.0.1:0");
    const key = "artifacts/exec-1/offline.txt";
    await s.upload(key, Buffer.from("served-from-disk"));
    const got = await s.download(key);
    expect(got.toString()).toBe("served-from-disk");
  });
});

// ── ProxyArtifactStorage ─────────────────────────────────────────────

describe("ProxyArtifactStorage", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("uploads via presigned URL flow", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];

    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, method: init?.method ?? "GET" });

      if (url.includes("presigned-upload-url")) {
        return new Response(
          JSON.stringify({ url: "https://r2.example.com/presigned-put", headers: {} }),
          { status: 200 },
        );
      }
      if (url === "https://r2.example.com/presigned-put") {
        return new Response(null, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const storage = new ProxyArtifactStorage("https://proxy.example.com", "token-123");
    const key = await storage.upload("artifacts/exec-1/f.txt", Buffer.from("data"), "text/plain");

    expect(key).toBe("artifacts/exec-1/f.txt");
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("presigned-upload-url");
    expect(calls[0].method).toBe("POST");
    expect(calls[1].url).toBe("https://r2.example.com/presigned-put");
    expect(calls[1].method).toBe("PUT");
  });

  // ── Signed-header contract (regression for SignatureDoesNotMatch) ──────
  //
  // The proxy presigns `content-type` (and `host`). The runner must replay the
  // signed set verbatim: duplicating `content-type` corrupts the signed value
  // and the store returns 403 SignatureDoesNotMatch. These tests drive a
  // NON-empty signed-header response (the prior tests mocked `headers: {}`,
  // which is exactly why this bug went uncaught) and assert what fetch sends.

  function captureUploadHeaders(signedHeaders: Record<string, unknown>): Promise<Headers> {
    return new Promise((resolve) => {
      globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("presigned-upload-url")) {
          return new Response(
            JSON.stringify({ url: "https://r2.example.com/put", headers: signedHeaders }),
            { status: 200 },
          );
        }
        // Build a real Headers from what the runner passed, so concatenation /
        // case-folding behavior matches a live PUT.
        resolve(new Headers(init?.headers as ConstructorParameters<typeof Headers>[0]));
        return new Response(null, { status: 200 });
      }) as typeof fetch;
    });
  }

  it("replays the signed content-type exactly once (no duplication)", async () => {
    const headersPromise = captureUploadHeaders({
      "content-type": "text/markdown",
      "host": "test-bucket.localhost:9000",
    });
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    await storage.upload("artifacts/exec-1/plan.md", Buffer.from("# Plan"), "text/markdown");

    const sent = await headersPromise;
    expect(sent.get("content-type")).toBe("text/markdown");
  });

  it("does not forward the signed host header (fetch sets it from the URL)", async () => {
    const headersPromise = captureUploadHeaders({
      "content-type": "text/markdown",
      "host": "test-bucket.localhost:9000",
    });
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    await storage.upload("artifacts/exec-1/plan.md", Buffer.from("# Plan"), "text/markdown");

    const sent = await headersPromise;
    expect(sent.has("host")).toBe(false);
  });

  it("tolerates legacy array-valued signed headers without duplicating", async () => {
    // Older proxy builds return Map<String,List<String>> -> JSON arrays.
    const headersPromise = captureUploadHeaders({
      "content-type": ["text/markdown"],
      "host": ["test-bucket.localhost:9000"],
    });
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    await storage.upload("artifacts/exec-1/plan.md", Buffer.from("# Plan"), "text/markdown");

    const sent = await headersPromise;
    expect(sent.get("content-type")).toBe("text/markdown");
  });

  it("sets content-type itself only when the presigner did not sign it", async () => {
    const headersPromise = captureUploadHeaders({
      "host": "test-bucket.localhost:9000",
    });
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    await storage.upload("artifacts/exec-1/f.bin", Buffer.from("x"), "application/octet-stream");

    const sent = await headersPromise;
    expect(sent.get("content-type")).toBe("application/octet-stream");
  });

  it("throws on presign failure", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("forbidden", { status: 403 }),
    ) as typeof fetch;

    const storage = new ProxyArtifactStorage("https://proxy.example.com", "bad-token");
    await expect(
      storage.upload("key", Buffer.from("x")),
    ).rejects.toThrow("Failed to get presigned upload URL (HTTP 403)");
  });

  it("throws on PUT failure", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("presigned-upload-url")) {
        return new Response(
          JSON.stringify({ url: "https://r2.example.com/put" }),
          { status: 200 },
        );
      }
      return new Response("server error", { status: 500 });
    }) as typeof fetch;

    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    await expect(
      storage.upload("key", Buffer.from("x")),
    ).rejects.toThrow("Presigned upload failed (HTTP 500)");
  });

  it("gets download URL via proxy", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ url: "https://r2.example.com/dl" }), { status: 200 }),
    ) as typeof fetch;

    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    const url = await storage.getDownloadUrl("key");
    expect(url).toBe("https://r2.example.com/dl");
  });

  it("downloads by resolving a presigned URL then fetching it", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("presigned-download-url")) {
        return new Response(JSON.stringify({ url: "https://r2.example.com/dl" }), { status: 200 });
      }
      if (url === "https://r2.example.com/dl") {
        return new Response(Buffer.from("payload-bytes"), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    const got = await storage.download("artifacts/exec-1/f.txt");
    expect(got.toString()).toBe("payload-bytes");
  });

  it("throws with the HTTP status and key when the download fetch fails", async () => {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("presigned-download-url")) {
        return new Response(JSON.stringify({ url: "https://r2.example.com/dl" }), { status: 200 });
      }
      return new Response("gone", { status: 404 });
    }) as typeof fetch;

    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    await expect(storage.download("artifacts/exec-1/missing.txt")).rejects.toThrow(
      /Artifact download failed \(HTTP 404\) for key 'artifacts\/exec-1\/missing\.txt'/,
    );
  });

  // exists() is a TWO-step probe: presign the download URL, then a 1-byte ranged
  // GET against the object. The presign endpoint mints a URL for ANY key, so the
  // OBJECT fetch — not the presign — is the source of truth for existence.
  function mockProxyFetch(objectResponse: () => Response) {
    globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("presigned-download-url")) {
        return new Response(JSON.stringify({ url: "https://r2.example.com/obj" }), { status: 200 });
      }
      return objectResponse();
    }) as typeof fetch;
  }

  it("exists returns true when the object GET is 200", async () => {
    mockProxyFetch(() => new Response(Buffer.from("x"), { status: 200 }));
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    expect(await storage.exists("key")).toBe(true);
  });

  it("exists returns true when the object GET is 206 (ranged)", async () => {
    mockProxyFetch(() => new Response(Buffer.from("x"), { status: 206 }));
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    expect(await storage.exists("key")).toBe(true);
  });

  it("exists returns true on 416 (0-byte object, range unsatisfiable but present)", async () => {
    mockProxyFetch(() => new Response("", { status: 416 }));
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    expect(await storage.exists("key")).toBe(true);
  });

  it("exists returns false when presign succeeds but the object 404s (regression: presign != existence)", async () => {
    // The exact proxy bug: the presign endpoint mints a URL for a nonexistent key;
    // only the object fetch reveals it is absent. The old exists() returned true
    // here (presign.ok), which crashed the file-review reconcile on the R2 404.
    mockProxyFetch(() => new Response("<Error><Code>NoSuchKey</Code></Error>", { status: 404 }));
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    expect(await storage.exists("key")).toBe(false);
  });

  it("exists probes the object with a 1-byte ranged GET (never a HEAD, which breaks the presign signature)", async () => {
    const seen: Array<{ url: string; range: string | null; method: string }> = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("presigned-download-url")) {
        return new Response(JSON.stringify({ url: "https://r2.example.com/obj" }), { status: 200 });
      }
      seen.push({
        url,
        range: new Headers(init?.headers).get("range"),
        method: (init?.method ?? "GET").toUpperCase(),
      });
      return new Response(Buffer.from("x"), { status: 206 });
    }) as typeof fetch;
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    await storage.exists("key");
    expect(seen).toEqual([{ url: "https://r2.example.com/obj", range: "bytes=0-0", method: "GET" }]);
  });

  it("exists returns false when the presign endpoint is unreachable", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network unreachable");
    }) as typeof fetch;
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    expect(await storage.exists("key")).toBe(false);
  });

  it("exists throws on an unexpected object status (a fault, not an existence answer)", async () => {
    mockProxyFetch(() => new Response("boom", { status: 500 }));
    const storage = new ProxyArtifactStorage("https://proxy.example.com", "tok");
    await expect(storage.exists("key")).rejects.toThrow(
      /Artifact existence check failed \(HTTP 500\) for key 'key'/,
    );
  });
});

// ── Factory ──────────────────────────────────────────────────────────

describe("createArtifactStorage", () => {
  it("creates local storage", () => {
    const cfg: ArtifactStorageConfig = {
      type: "local",
      localPath: "/tmp/artifacts",
      localServeUrl: "http://localhost:7235",
      proxyEndpoint: null,
      proxyAuthToken: null,
    };
    const storage = createArtifactStorage(cfg);
    expect(storage).toBeInstanceOf(LocalArtifactStorage);
  });

  it("creates proxy storage", () => {
    const cfg: ArtifactStorageConfig = {
      type: "proxy",
      localPath: "/tmp/artifacts",
      localServeUrl: "http://localhost:7235",
      proxyEndpoint: "https://proxy.example.com",
      proxyAuthToken: "token-123",
    };
    const storage = createArtifactStorage(cfg);
    expect(storage).toBeInstanceOf(ProxyArtifactStorage);
  });

  it("throws when proxy endpoint is missing", () => {
    const cfg: ArtifactStorageConfig = {
      type: "proxy",
      localPath: "/tmp/artifacts",
      localServeUrl: "http://localhost:7235",
      proxyEndpoint: null,
      proxyAuthToken: "token",
    };
    expect(() => createArtifactStorage(cfg)).toThrow("STIGMER_PROXY_ENDPOINT");
  });

  it("throws when proxy auth token is missing", () => {
    const cfg: ArtifactStorageConfig = {
      type: "proxy",
      localPath: "/tmp/artifacts",
      localServeUrl: "http://localhost:7235",
      proxyEndpoint: "https://proxy.example.com",
      proxyAuthToken: null,
    };
    expect(() => createArtifactStorage(cfg)).toThrow("STIGMER_TOKEN");
  });
});

describe("loadArtifactStorageConfig", () => {
  const baseConfig = {
    mode: "local" as const,
    proxyEndpoint: null,
    stigmerToken: null,
    taskQueue: "q",
    temporalAddress: "localhost:7233",
    temporalNamespace: "default",
    stigmerBackendEndpoint: "http://localhost:7234",
    cursorApiKey: "",
    workspaceRootDir: "/tmp",
    maxConcurrentActivities: 5,
    idleTimeoutSeconds: null,
    cloudModeEnabled: false,
    runnerId: null,
    checkpointerType: "memory" as const,
    checkpointerProxyEndpoint: null,
    primaryModel: "gpt-4.1",
    cursorStreamStallTimeoutMs: 180000,
  };

  afterEach(() => {
    delete process.env.ARTIFACT_STORAGE_TYPE;
    delete process.env.LOCAL_ARTIFACT_PATH;
    delete process.env.LOCAL_ARTIFACT_SERVE_URL;
  });

  it("defaults to local in local mode", () => {
    const cfg = loadArtifactStorageConfig(baseConfig);
    expect(cfg.type).toBe("local");
  });

  it("defaults to proxy in cloud mode", () => {
    const cfg = loadArtifactStorageConfig({
      ...baseConfig,
      mode: "cloud",
      proxyEndpoint: "https://proxy.example.com",
      stigmerToken: "tok",
    });
    expect(cfg.type).toBe("proxy");
    expect(cfg.proxyEndpoint).toBe("https://proxy.example.com");
  });

  it("uses proxy in local mode when a proxy endpoint is set (desktop case)", () => {
    // The desktop runner executes locally yet proxies its artifacts: storage
    // follows transport (proxyEndpoint), not execution location (mode).
    const cfg = loadArtifactStorageConfig({
      ...baseConfig,
      mode: "local",
      proxyEndpoint: "https://localhost:9090",
      stigmerToken: "tok",
    });
    expect(cfg.type).toBe("proxy");
    expect(cfg.proxyEndpoint).toBe("https://localhost:9090");
    expect(cfg.proxyAuthToken).toBe("tok");
  });

  it("respects ARTIFACT_STORAGE_TYPE override", () => {
    process.env.ARTIFACT_STORAGE_TYPE = "proxy";
    const cfg = loadArtifactStorageConfig({
      ...baseConfig,
      proxyEndpoint: "https://proxy.example.com",
      stigmerToken: "tok",
    });
    expect(cfg.type).toBe("proxy");
  });
});

// ── resolveUsableArtifactStorage (DD-26 follow-up #1) ─────────────────
//
// The shared construct-or-degrade seam: it must return `undefined` (never throw)
// for every "no working substrate" condition so both harnesses fall to the
// deny-gate up front, instead of flowing file writes then crashing at the
// turn-boundary upload.

describe("resolveUsableArtifactStorage", () => {
  const ctx = { executionId: "exec-test" };
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "resolve-artifact-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const localCfg = (localPath: string): ArtifactStorageConfig => ({
    type: "local",
    localPath,
    localServeUrl: "http://localhost:7235",
    proxyEndpoint: null,
    proxyAuthToken: null,
  });

  it("returns a LocalArtifactStorage for a writable path and leaves no residue", async () => {
    const base = join(tempDir, "artifacts");
    const storage = await resolveUsableArtifactStorage(localCfg(base), ctx);

    expect(storage).toBeInstanceOf(LocalArtifactStorage);
    // The write-probe file must be cleaned up; the base dir may be created.
    const entries = await readdir(base);
    expect(entries).toEqual([]);
  });

  it("returns undefined for an unwritable local path (mkdir ENOTDIR)", async () => {
    // Deterministic, cross-platform: point localPath at a child of a regular
    // FILE, so the resolver's recursive mkdir fails with ENOTDIR.
    const filePath = join(tempDir, "not-a-dir");
    await writeFile(filePath, "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const storage = await resolveUsableArtifactStorage(
      localCfg(join(filePath, "sub")),
      ctx,
    );

    expect(storage).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("local path not writable"),
    );
  });

  it("returns undefined when proxy config is a misconfig (construct throws)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cfg: ArtifactStorageConfig = {
      type: "proxy",
      localPath: "/tmp/artifacts",
      localServeUrl: "http://localhost:7235",
      proxyEndpoint: "https://proxy.example.com",
      proxyAuthToken: null, // missing token
    };

    const storage = await resolveUsableArtifactStorage(cfg, ctx);

    expect(storage).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unavailable"));
  });

  it("returns a ProxyArtifactStorage for a valid proxy config without any network call", async () => {
    // Proxy is never probed at the network layer — assert no fetch happens.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const cfg: ArtifactStorageConfig = {
      type: "proxy",
      localPath: "/tmp/artifacts",
      localServeUrl: "http://localhost:7235",
      proxyEndpoint: "https://proxy.example.com",
      proxyAuthToken: "token-123",
    };

    const storage = await resolveUsableArtifactStorage(cfg, ctx);

    expect(storage).toBeInstanceOf(ProxyArtifactStorage);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("wires through to deriveCaptureMode: an unwritable local store degrades a non-git turn to the deny-gate", async () => {
    const filePath = join(tempDir, "not-a-dir");
    await writeFile(filePath, "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const storage = await resolveUsableArtifactStorage(
      localCfg(join(filePath, "sub")),
      ctx,
    );

    // Non-git workspace + no usable storage => no capture substrate => deny-gate.
    expect(deriveCaptureMode("/some/workspace", false, !!storage)).toBe(false);
    // A git workspace still captures (git substrate needs no storage), but its
    // gitignored->CAS edits and offload are off because the store is absent.
    expect(deriveCaptureMode("/some/workspace", true, !!storage)).toBe(true);
  });
});
