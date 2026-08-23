/**
 * The canonical in-memory {@link ClaimcheckStorage} test double — the
 * lib-scoped sibling of the runner's fake-artifact-storage.ts (which
 * models the runner's richer ArtifactStorage port and stays there).
 *
 * Design, mirrored from that double:
 *  - `upload` / `download` are backed by one shared `Map`, so a key that
 *    was uploaded reads back byte-exact — the double behaves like a real
 *    content store, not a pair of disconnected stubs.
 *  - Both methods are `vi.fn`s, so call assertions work and either can be
 *    overridden per-test to force a failure
 *    (`storage.download.mockRejectedValueOnce(new Error("… HTTP 404 …"))`).
 */

import { vi } from "vitest";
import type { ClaimcheckStorage } from "../claimcheck/storage.js";

/** A {@link ClaimcheckStorage} whose methods are `vi.fn` spies over a shared Map. */
export type InMemoryClaimcheckStorage = {
  [K in keyof ClaimcheckStorage]: ReturnType<typeof vi.fn>;
} & ClaimcheckStorage;

export interface InMemoryClaimcheckStorageHandle {
  /** The storage double to inject; both methods are spy-able `vi.fn`s. */
  readonly storage: InMemoryClaimcheckStorage;
  /** The backing store — inspect or seed it directly in a test. */
  readonly blobs: Map<string, Buffer>;
}

/**
 * Build an in-memory {@link ClaimcheckStorage} backed by a shared `Map`.
 *
 * @example
 * const { storage, blobs } = makeInMemoryClaimcheckStorage();
 * await storage.upload("k", Buffer.from("hi"));
 * expect((await storage.download("k")).toString()).toBe("hi");
 */
export function makeInMemoryClaimcheckStorage(): InMemoryClaimcheckStorageHandle {
  const blobs = new Map<string, Buffer>();

  const storage = {
    upload: vi.fn(async (key: string, content: Buffer, _contentType?: string) => {
      blobs.set(key, Buffer.from(content));
      return key;
    }),
    download: vi.fn(async (key: string) => {
      const b = blobs.get(key);
      if (!b) throw new Error(`Artifact not found for key '${key}'`);
      return Buffer.from(b);
    }),
  } as InMemoryClaimcheckStorage;

  return { storage, blobs };
}
