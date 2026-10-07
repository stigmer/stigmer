/**
 * Tests for the attachment download-URL hand-off policy (issue #532):
 * the branch-independent mint rule, that a storage with no presigned links
 * (the local backend) mints none, the non-fatal degrade, and the disclosure
 * wording both harnesses embed.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  mintAttachmentDownloadUrl,
  DOWNLOAD_URL_DISCLOSURE,
} from "../attachment-download-urls.js";
import { LocalArtifactStorage } from "../artifact-storage.js";
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
    expect(storage.presignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("mints nothing from a storage that offers no presigned links, as the local backend offers none", async () => {
    const { storage } = makeInMemoryArtifactStorage({ presigned: false });
    expect(await mintAttachmentDownloadUrl(storage, "attachments/01A/lease.pdf", "lease.pdf")).toBeUndefined();

    const local = new LocalArtifactStorage("/nonexistent-artifact-root");
    expect("presignedDownloadUrl" in local).toBe(false);
    expect(await mintAttachmentDownloadUrl(local, "attachments/01A/lease.pdf", "lease.pdf")).toBeUndefined();
  });

  it("returns undefined when no storage is available", async () => {
    const url = await mintAttachmentDownloadUrl(undefined, "attachments/01A/lease.pdf", "lease.pdf");

    expect(url).toBeUndefined();
  });

  it("degrades to undefined on a mint failure and logs the degrade (never throws)", async () => {
    const { storage } = makeInMemoryArtifactStorage();
    storage.presignedDownloadUrl?.mockRejectedValueOnce(new Error("presign endpoint unreachable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const url = await mintAttachmentDownloadUrl(storage, "attachments/01A/lease.pdf", "lease.pdf");

    expect(url).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("lease.pdf");
  });
});

describe("DOWNLOAD_URL_DISCLOSURE", () => {
  it("promises time-limited single-object access, and nothing about this machine", () => {
    expect(DOWNLOAD_URL_DISCLOSURE).toContain("time-limited");
    expect(DOWNLOAD_URL_DISCLOSURE).toContain("single file");
    expect(DOWNLOAD_URL_DISCLOSURE).not.toContain("this machine");
  });
});
