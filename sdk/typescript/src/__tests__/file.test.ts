// Wire-shape tests for RoutedFileClient's size-routed upload, the File
// twin of skill.test.ts. A router transport fakes the File service
// in-process, so the routing runs through the real generated client; a
// loopback HTTP server plays the upload URL wherever the test must see the
// PUT as a server does (its Content-Length, its headers, its bytes).
// Pins: inline at or below the threshold, staged above it with the exact
// bytes and no Authorization header, `upload` itself routing large inline
// data, a Blob handed to fetch unread, uploadFileFromPath streaming a file
// on disk, a rejected PUT reported without the URL or its query, and
// Stigmer.file being the routed client.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRouterTransport, type Transport } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import {
  FileUploadUrlSchema,
  UploadFileInputSchema,
  type CreateFileUploadUrlInput,
  type UploadFileInput,
} from "@stigmer/apis/ai/stigmer/agentic/file/v1/io_pb";
import { MAX_INLINE_ARTIFACT_BYTES } from "../artifact-routing.js";
import { RoutedFileClient } from "../file.js";
import { StigmerError } from "../gen/errors.js";
import { uploadFileFromPath } from "../node.js";
import { Stigmer } from "../stigmer.js";

interface Captured {
  uploads: UploadFileInput[];
  mints: CreateFileUploadUrlInput[];
}

function fakeTransport(captured: Captured, uploadUrl: string): Transport {
  return createRouterTransport(({ service }) => {
    service(FileCommandController, {
      upload: (req) => {
        captured.uploads.push(req);
        return create(FileSchema, {});
      },
      createUploadUrl: (req) => {
        captured.mints.push(req);
        return create(FileUploadUrlSchema, { url: uploadUrl, uploadRef: "fup_t", ttlSeconds: 900 });
      },
    });
  });
}

interface ReceivedPut {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  bytes: Buffer;
}

const servers: Server[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((done) => s.close(() => done()))));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A loopback upload URL that records the one request it receives. */
async function uploadServer(
  status = 200,
  body = "",
): Promise<{ baseUrl: string; received: ReceivedPut[] }> {
  const received: ReceivedPut[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      received.push({
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        bytes: Buffer.concat(chunks),
      });
      res.writeHead(status, { "content-type": body.startsWith("<") ? "application/xml" : "text/plain" });
      res.end(body);
    });
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, received };
}

function patterned(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 251;
  return bytes;
}

describe("RoutedFileClient.uploadFile size routing", () => {
  it("keeps content at the threshold inline: no mint, the bytes in the request", async () => {
    const captured: Captured = { uploads: [], mints: [] };
    const client = new RoutedFileClient(fakeTransport(captured, "http://unused.invalid/"));
    const content = patterned(MAX_INLINE_ARTIFACT_BYTES);

    await client.uploadFile({ org: "acme", sessionId: "ses_1", filename: "a.bin", mimeType: "image/png", content });

    expect(captured.mints).toHaveLength(0);
    expect(captured.uploads).toHaveLength(1);
    const sent = captured.uploads[0];
    expect(sent.org).toBe("acme");
    expect(sent.sessionId).toBe("ses_1");
    expect(sent.filename).toBe("a.bin");
    expect(sent.mimeType).toBe("image/png");
    expect(sent.source.case).toBe("data");
    // Buffer.equals, not toEqual: a deep compare walks 10 MiB element by element.
    expect(sent.source.case === "data" && Buffer.from(sent.source.value).equals(Buffer.from(content))).toBe(true);
  });

  it("uploads an empty Blob inline", async () => {
    const captured: Captured = { uploads: [], mints: [] };
    const client = new RoutedFileClient(fakeTransport(captured, "http://unused.invalid/"));

    await client.uploadFile({ org: "acme", filename: "empty.txt", content: new Blob([]) });

    expect(captured.mints).toHaveLength(0);
    expect(captured.uploads[0].source).toEqual({ case: "data", value: new Uint8Array(0) });
  });

  it("stages content above the threshold: exact bytes, no Authorization, upload by reference", async () => {
    const { baseUrl, received } = await uploadServer();
    const captured: Captured = { uploads: [], mints: [] };
    const client = new RoutedFileClient(fakeTransport(captured, `${baseUrl}/v1/file-uploads/fup_t?sig=s3cret`));
    const content = patterned(MAX_INLINE_ARTIFACT_BYTES + 1);

    await client.uploadFile({ org: "acme", sessionId: "ses_1", filename: "big.bin", content });

    expect(captured.mints).toHaveLength(1);
    expect(captured.mints[0].org).toBe("acme");
    expect(captured.mints[0].sessionId).toBe("ses_1");
    expect(captured.mints[0].sizeBytes).toBe(BigInt(content.byteLength));
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe("PUT");
    expect(received[0].path).toBe("/v1/file-uploads/fup_t?sig=s3cret");
    expect(received[0].headers["content-length"]).toBe(String(content.byteLength));
    expect(received[0].headers.authorization).toBeUndefined();
    expect(received[0].bytes.equals(Buffer.from(content))).toBe(true);
    expect(captured.uploads).toHaveLength(1);
    const sent = captured.uploads[0];
    expect(sent.source).toEqual({ case: "uploadRef", value: "fup_t" });
    expect(sent.filename).toBe("big.bin");
    expect(sent.sessionId).toBe("ses_1");
  });

  it("hands a large Blob to fetch as it is, never reading it", async () => {
    const captured: Captured = { uploads: [], mints: [] };
    let putBody: unknown;
    const recordingFetch: typeof globalThis.fetch = async (_url, init) => {
      putBody = init?.body;
      return new Response(null, { status: 200 });
    };
    const client = new RoutedFileClient(fakeTransport(captured, "http://stage.invalid/u"), recordingFetch);
    const blob = new Blob([patterned(MAX_INLINE_ARTIFACT_BYTES + 1)]);
    const read = (): never => {
      throw new Error("the Blob was read whole");
    };
    Object.assign(blob, { arrayBuffer: read, bytes: read, text: read });

    await client.uploadFile({ org: "acme", filename: "big.bin", content: blob });

    expect(putBody).toBe(blob);
    expect(captured.uploads[0].source).toEqual({ case: "uploadRef", value: "fup_t" });
  });

  it("routes upload() itself when its inline data is above the threshold", async () => {
    const { baseUrl, received } = await uploadServer();
    const captured: Captured = { uploads: [], mints: [] };
    const client = new RoutedFileClient(fakeTransport(captured, `${baseUrl}/u`));
    const data = patterned(MAX_INLINE_ARTIFACT_BYTES + 1);

    await client.upload(
      create(UploadFileInputSchema, { org: "acme", filename: "big.bin", mimeType: "text/csv", source: { case: "data", value: data } }),
    );

    expect(received[0].bytes.byteLength).toBe(data.byteLength);
    expect(captured.uploads[0].source).toEqual({ case: "uploadRef", value: "fup_t" });
    expect(captured.uploads[0].mimeType).toBe("text/csv");
  });

  it("reports a rejected PUT by its status and the bucket's Code and Message, never the URL", async () => {
    const xml =
      "<Error><Code>SignatureDoesNotMatch</Code><Message>The signature does not match.</Message>" +
      "<CanonicalRequest>PUT /b/k X-Amz-Credential=AKIDEXAMPLE&amp;X-Amz-Signature=s3cret</CanonicalRequest></Error>";
    const { baseUrl } = await uploadServer(403, xml);
    const captured: Captured = { uploads: [], mints: [] };
    const client = new RoutedFileClient(
      fakeTransport(captured, `${baseUrl}/b/k?X-Amz-Credential=AKIDEXAMPLE&X-Amz-Signature=s3cret`),
    );

    const err = await client
      .uploadFile({ org: "acme", filename: "big.bin", content: patterned(MAX_INLINE_ARTIFACT_BYTES + 1) })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(StigmerError);
    const message = (err as StigmerError).message;
    expect(message).toBe("file upload rejected with HTTP 403: SignatureDoesNotMatch: The signature does not match.");
    expect(captured.uploads).toHaveLength(0);
  });

  it("redacts a plain-text rejection that echoes the URL or its query", async () => {
    const captured: Captured = { uploads: [], mints: [] };
    const url = "http://stage.invalid/u/fup_t?token=s3cret";
    const echoingFetch: typeof globalThis.fetch = async () =>
      new Response(`no slot at ${url}; query token=s3cret`, { status: 404 });
    const client = new RoutedFileClient(fakeTransport(captured, url), echoingFetch);

    const err = await client
      .uploadFile({ org: "acme", filename: "big.bin", content: patterned(MAX_INLINE_ARTIFACT_BYTES + 1) })
      .catch((e: unknown) => e);

    const message = (err as StigmerError).message;
    expect(message).toMatch(/^file upload rejected with HTTP 404: /);
    expect(message).not.toContain("s3cret");
    expect(message).not.toContain("stage.invalid");
  });

  it("reports an unreachable upload URL without naming it", async () => {
    const captured: Captured = { uploads: [], mints: [] };
    const failingFetch: typeof globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const client = new RoutedFileClient(fakeTransport(captured, "http://stage.invalid/u?sig=s3cret"), failingFetch);

    const err = await client
      .uploadFile({ org: "acme", filename: "big.bin", content: patterned(MAX_INLINE_ARTIFACT_BYTES + 1) })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(StigmerError);
    expect((err as StigmerError).code).toBe("unavailable");
    expect((err as StigmerError).message).not.toContain("s3cret");
    expect(captured.uploads).toHaveLength(0);
  });
});

describe("Stigmer.file", () => {
  it("is the routed client", () => {
    const stigmer = new Stigmer({ baseUrl: "http://localhost:1", apiKey: "sk_test" });
    expect(stigmer.file).toBeInstanceOf(RoutedFileClient);
  });
});

describe("uploadFileFromPath", () => {
  function tempFile(name: string, bytes: Uint8Array): string {
    const dir = mkdtempSync(join(tmpdir(), "stigmer-file-test-"));
    tempDirs.push(dir);
    const path = join(dir, name);
    writeFileSync(path, bytes);
    return path;
  }

  it("streams a large file from disk with its exact length, named by its path", async () => {
    const { baseUrl, received } = await uploadServer();
    const captured: Captured = { uploads: [], mints: [] };
    const client = new RoutedFileClient(fakeTransport(captured, `${baseUrl}/u`));
    const content = patterned(MAX_INLINE_ARTIFACT_BYTES + 4096);
    const path = tempFile("ledger.xlsx", content);

    await uploadFileFromPath(client, { org: "acme", path });

    expect(received[0].headers["content-length"]).toBe(String(content.byteLength));
    expect(received[0].bytes.equals(Buffer.from(content))).toBe(true);
    expect(captured.uploads[0].filename).toBe("ledger.xlsx");
    expect(captured.uploads[0].source).toEqual({ case: "uploadRef", value: "fup_t" });
  });

  it("uploads a small file inline under the name given", async () => {
    const captured: Captured = { uploads: [], mints: [] };
    const client = new RoutedFileClient(fakeTransport(captured, "http://unused.invalid/"));
    const path = tempFile("notes.txt", new TextEncoder().encode("hello"));

    await uploadFileFromPath(client, { org: "acme", path, filename: "renamed.txt" });

    expect(captured.mints).toHaveLength(0);
    expect(captured.uploads[0].filename).toBe("renamed.txt");
    expect(captured.uploads[0].source).toEqual({ case: "data", value: new TextEncoder().encode("hello") });
  });
});
