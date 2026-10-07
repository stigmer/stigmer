/**
 * Pins the download-URL signer: the query it mints (filename, expiry,
 * signature), the 7-day clamp, and that verify accepts exactly what it
 * minted while it is live and nothing else: no expiry, a malformed or past
 * one, no signature, a signature of the wrong length or over different
 * fields, and another key's. Also pins where the key comes from: the env
 * var, else the key file it persists at 0600 on first use; and that a
 * composition with no local store reads and writes no key file and refuses
 * every link.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DOWNLOAD_URL_KEY_ENV_VAR,
  DOWNLOAD_URL_KEY_FILE_NAME,
  DownloadUrlSigner,
  downloadUrlSignerFor,
  encodeKeyPath,
  loadDownloadUrlSigner,
  MAX_SIGNED_URL_TTL_MS,
} from "../url-signer.js";
import { TEST_URL_SIGNING_KEY, testUrlSigner } from "../__test-utils__/url-signer.js";

const NOW = Date.UTC(2026, 9, 7, 12, 0, 0);
const KEY = "artifacts/aex_1/plan.md";

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("DownloadUrlSigner", () => {
  let now: number;
  let signer: DownloadUrlSigner;

  beforeEach(() => {
    now = NOW;
    signer = testUrlSigner(() => now);
  });

  it("mints the filename, the expiry and a base64url signature, and verifies them", () => {
    const query = signer.signedQuery(KEY, 3_600_000, "my plan.md");
    expect(query).toMatch(/^download=my\+plan\.md&exp=\d+&sig=[A-Za-z0-9_-]{43}$/);
    expect(params(query).get("exp")).toBe(String(NOW / 1000 + 3600));
    expect(signer.verify(KEY, params(query))).toBe(true);
    expect(signer.signedQuery(KEY, 3_600_000, "")).toMatch(/^exp=\d+&sig=/);
  });

  it("clamps the lifetime to MAX_SIGNED_URL_TTL_MS and refuses a non-positive one", () => {
    const query = signer.signedQuery(KEY, MAX_SIGNED_URL_TTL_MS * 4, "");
    expect(Number(params(query).get("exp"))).toBe((NOW + MAX_SIGNED_URL_TTL_MS) / 1000);
    expect(() => signer.signedQuery(KEY, 0, "")).toThrow("positive TTL");
    expect(() => signer.signedQuery(KEY, Number.NaN, "")).toThrow("positive TTL");
  });

  it("accepts a link until its expiry and refuses it from then on", () => {
    const query = params(signer.signedQuery(KEY, 60_000, ""));
    now = NOW + 59_000;
    expect(signer.verify(KEY, query)).toBe(true);
    now = NOW + 60_000;
    expect(signer.verify(KEY, query)).toBe(false);
  });

  it("refuses what it did not mint", () => {
    const minted = params(signer.signedQuery(KEY, 60_000, "a.md"));
    const without = (name: string) => {
      const copy = new URLSearchParams(minted);
      copy.delete(name);
      return copy;
    };
    const with_ = (name: string, value: string) => {
      const copy = new URLSearchParams(minted);
      copy.set(name, value);
      return copy;
    };
    expect(signer.verify(KEY, without("exp"))).toBe(false);
    expect(signer.verify(KEY, without("sig"))).toBe(false);
    expect(signer.verify(KEY, without("download"))).toBe(false);
    expect(signer.verify(KEY, with_("download", "b.md"))).toBe(false);
    expect(signer.verify(KEY, with_("exp", `${minted.get("exp")}0`))).toBe(false);
    expect(signer.verify(KEY, with_("exp", "1e12"))).toBe(false);
    expect(signer.verify(KEY, with_("sig", "AAAA"))).toBe(false);
    expect(signer.verify(`${KEY}.bak`, minted)).toBe(false);
    expect(new DownloadUrlSigner(Buffer.alloc(32, 9), () => now).verify(KEY, minted)).toBe(false);
  });

  it("refuses a key that is not 32 bytes", () => {
    expect(() => new DownloadUrlSigner(Buffer.alloc(16))).toThrow("32 bytes");
  });

  it("encodes each key segment and keeps the slashes", () => {
    expect(encodeKeyPath("attachments/01A/my file#1?.pdf")).toBe(
      "attachments/01A/my%20file%231%3F.pdf",
    );
  });
});

describe("loadDownloadUrlSigner", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "download-url-key-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("takes the key from the env var when set", () => {
    const signer = loadDownloadUrlSigner({
      env: { [DOWNLOAD_URL_KEY_ENV_VAR]: TEST_URL_SIGNING_KEY.toString("base64") },
      homeDir: home,
    });
    const query = params(signer.signedQuery(KEY, 60_000, ""));
    expect(testUrlSigner().verify(KEY, query)).toBe(true);
  });

  it("reads the ladder only for a composition with a local store; with none it writes no key file and refuses every link", () => {
    const keyFile = path.join(home, ".stigmer", DOWNLOAD_URL_KEY_FILE_NAME);
    const envOnly = { env: { [DOWNLOAD_URL_KEY_ENV_VAR]: TEST_URL_SIGNING_KEY.toString("base64") }, homeDir: home };
    const minted = params(testUrlSigner().signedQuery(KEY, 60_000, ""));

    const buckets = downloadUrlSignerFor(false, envOnly);
    expect(buckets.verify(KEY, minted)).toBe(false);
    expect(downloadUrlSignerFor(false, { env: {}, homeDir: home }).verify(KEY, minted)).toBe(false);
    expect(existsSync(keyFile)).toBe(false);

    expect(downloadUrlSignerFor(true, envOnly).verify(KEY, minted)).toBe(true);
  });

  it("generates a key on first use, persists it at 0600, and reads it back", () => {
    const first = loadDownloadUrlSigner({ env: {}, homeDir: home });
    const file = path.join(home, ".stigmer", DOWNLOAD_URL_KEY_FILE_NAME);
    expect(readFileSync(file)).toHaveLength(32);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const second = loadDownloadUrlSigner({ env: {}, homeDir: home });
    expect(second.verify(KEY, params(first.signedQuery(KEY, 60_000, "")))).toBe(true);
  });
});
