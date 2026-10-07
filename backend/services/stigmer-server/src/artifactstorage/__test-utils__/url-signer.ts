/**
 * A download-URL signer for the suites that build a local blob store or a
 * lane serving one: a fixed key, so two signers built here verify each
 * other's links, and a clock a suite may pin to cross an expiry.
 */
import { DownloadUrlSigner } from "../url-signer.js";

/** The fixed 32-byte key every test signer shares. */
export const TEST_URL_SIGNING_KEY = Buffer.alloc(32, 7);

export function testUrlSigner(now: () => number = Date.now): DownloadUrlSigner {
  return new DownloadUrlSigner(TEST_URL_SIGNING_KEY, now);
}
