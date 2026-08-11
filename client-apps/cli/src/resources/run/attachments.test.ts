// Unit tests for attachment processing: workspace-relative classification vs
// upload, directory zipping, MIME detection, and the size cap. The uploader is
// faked so no network is required.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "@bufbuild/protobuf";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type UploadAttachmentRequest,
  UploadAttachmentResponseSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { type AttachmentUploader, processAttachments } from "./attachments.js";

// Records each upload and returns a deterministic storage key.
class FakeUploader implements AttachmentUploader {
  readonly uploads: UploadAttachmentRequest[] = [];
  async uploadAttachment(req: UploadAttachmentRequest) {
    this.uploads.push(req);
    return create(UploadAttachmentResponseSchema, { storageKey: `attachments/key/${req.filename}` });
  }
}

let dir: string;
let uploader: FakeUploader;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "attach-test-"));
  uploader = new FakeUploader();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("workspace-relative classification", () => {
  it("records a file inside a workspace root as a relative ref (no upload)", async () => {
    const root = join(dir, "repo");
    mkdirSync(join(root, "src"), { recursive: true });
    const file = join(root, "src", "main.ts");
    writeFileSync(file, "x");

    const result = await processAttachments(uploader, [file], [root]);
    expect(result.workspaceFileRefs).toEqual(["src/main.ts"]);
    expect(result.attachments).toHaveLength(0);
    expect(uploader.uploads).toHaveLength(0);
  });

  it("uploads a file outside every workspace root", async () => {
    const root = join(dir, "repo");
    mkdirSync(root, { recursive: true });
    const outside = join(dir, "outside.txt");
    writeFileSync(outside, "data");

    const result = await processAttachments(uploader, [outside], [root]);
    expect(result.workspaceFileRefs).toHaveLength(0);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe("outside.txt");
    expect(result.attachments[0].contentType).toBe("text/plain");
    expect(result.attachments[0].storageKey).toBe("attachments/key/outside.txt");
    expect(result.attachments[0].localPath).toBe(outside);
  });
});

describe("file upload", () => {
  it("uploads with no workspace roots configured", async () => {
    const file = join(dir, "config.yaml");
    writeFileSync(file, "a: 1\n");
    const result = await processAttachments(uploader, [file], []);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].contentType).toBe("application/x-yaml");
    expect(uploader.uploads[0].filename).toBe("config.yaml");
  });

  it("falls back to octet-stream for unknown extensions", async () => {
    const file = join(dir, "blob.unknownext");
    writeFileSync(file, "x");
    const result = await processAttachments(uploader, [file], []);
    expect(result.attachments[0].contentType).toBe("application/octet-stream");
  });

  it("errors on a missing file", async () => {
    await expect(processAttachments(uploader, [join(dir, "nope.txt")], [])).rejects.toThrow(/file not found/);
  });
});

describe("directory zipping", () => {
  it("zips a directory, marks extract, and sets the mount path", async () => {
    const subdir = join(dir, "bundle");
    mkdirSync(join(subdir, "nested"), { recursive: true });
    writeFileSync(join(subdir, "a.txt"), "aaa");
    writeFileSync(join(subdir, "nested", "b.txt"), "bbb");
    writeFileSync(join(subdir, ".hidden"), "secret"); // skipped

    const result = await processAttachments(uploader, [subdir], []);
    expect(result.attachments).toHaveLength(1);
    const att = result.attachments[0];
    expect(att.filename).toBe("bundle.zip");
    expect(att.extract).toBe(true);
    expect(att.mountPath).toBe("inputs/bundle/");
    expect(att.contentType).toBe("application/zip");

    const entries = Object.keys(unzipSync(uploader.uploads[0].content)).sort();
    expect(entries).toEqual(["a.txt", "nested/b.txt"]);
  });

  it("errors when a directory has no attachable files", async () => {
    const empty = join(dir, "empty");
    mkdirSync(empty);
    writeFileSync(join(empty, ".hidden"), "x"); // only hidden -> nothing attachable
    await expect(processAttachments(uploader, [empty], [])).rejects.toThrow(/no attachable files/);
  });

  it("uniquifies duplicate directory basenames so mount paths never contradict (issue #364)", async () => {
    // Two dirs named `data` from different parents would otherwise derive the
    // SAME explicit mount path, which the runner rejects as a contradiction.
    const dirA = join(dir, "a", "data");
    const dirB = join(dir, "b", "data");
    mkdirSync(dirA, { recursive: true });
    mkdirSync(dirB, { recursive: true });
    writeFileSync(join(dirA, "one.txt"), "1");
    writeFileSync(join(dirB, "two.txt"), "2");

    const progress: string[] = [];
    const result = await processAttachments(uploader, [dirA, dirB], [], (l) => progress.push(l));

    expect(result.attachments).toHaveLength(2);
    expect(result.attachments[0].filename).toBe("data.zip");
    expect(result.attachments[0].mountPath).toBe("inputs/data/");
    expect(result.attachments[1].filename).toBe("data-2.zip");
    expect(result.attachments[1].mountPath).toBe("inputs/data-2/");
    // The rename is disclosed to the user on the progress sink.
    expect(progress.some((l) => l.includes("'data/'") && l.includes("'data-2/'"))).toBe(true);
  });
});
