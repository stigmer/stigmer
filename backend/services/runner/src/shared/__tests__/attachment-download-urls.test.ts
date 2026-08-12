/**
 * Tests for the attachment download-URL hand-off policy (issue #532):
 * the branch-independent mint rule, the non-fatal degrade, and the
 * per-kind disclosure wording both harnesses embed.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mintAttachmentDownloadUrl,
  downloadUrlDisclosureLine,
} from "../attachment-download-urls.js";
import { makeInMemoryArtifactStorage } from "../../__test-utils__/fake-artifact-storage.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mintAttachmentDownloadUrl", () => {
  it("mints a URL for a storage key", async () => {
    const { storage } = makeInMemoryArtifactStorage();

    const url = await mintAttachmentDownloadUrl(storage, "attachments/01A/lease.pdf", "lease.pdf");

    expect(url).toBe("mem://attachments/01A/lease.pdf");
  });

  it("returns undefined when the attachment has no storage key", async () => {
    const { storage } = makeInMemoryArtifactStorage();

    const url = await mintAttachmentDownloadUrl(storage, "", "local.csv");

    expect(url).toBeUndefined();
    expect(storage.getDownloadUrl).not.toHaveBeenCalled();
  });

  it("returns undefined when no storage is available", async () => {
    const url = await mintAttachmentDownloadUrl(undefined, "attachments/01A/lease.pdf", "lease.pdf");

    expect(url).toBeUndefined();
  });

  it("degrades to undefined on a mint failure and logs the degrade (never throws)", async () => {
    const { storage } = makeInMemoryArtifactStorage();
    storage.getDownloadUrl.mockRejectedValueOnce(new Error("presign endpoint unreachable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const url = await mintAttachmentDownloadUrl(storage, "attachments/01A/lease.pdf", "lease.pdf");

    expect(url).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("lease.pdf");
  });
});

describe("downloadUrlDisclosureLine", () => {
  it("promises time-limited single-object access for presigned URLs", () => {
    const line = downloadUrlDisclosureLine("presigned");

    expect(line).toContain("time-limited");
    expect(line).toContain("single file");
    expect(line).not.toContain("this machine");
  });

  it("is honest about local-serve reach — same machine only, no expiry claim", () => {
    const line = downloadUrlDisclosureLine("local-serve");

    expect(line).toContain("reachable only from this machine");
    expect(line).not.toContain("time-limited");
  });
});
