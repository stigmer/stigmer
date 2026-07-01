/**
 * The single canonical in-memory {@link ArtifactStorage} test double.
 *
 * Every runner test that needs a fake storage should use this — do NOT hand-roll
 * another partial `ArtifactStorage` literal. Before this helper existed, ~16 test
 * files each invented their own fake (and their own `getDownloadUrl` convention:
 * `mem://`, `https://artifacts.local/`, `mock://`, identity, …), which drifted
 * from the real port and from each other. This double is the one place the port
 * is modeled for tests.
 *
 * Design:
 *  - `upload` / `download` / `exists` are backed by one shared `Map`, so a key
 *    that was uploaded reads back byte-exact — the double behaves like a real
 *    content store, not a set of disconnected stubs.
 *  - Every method is a `vi.fn`, so call assertions still work
 *    (`expect(storage.download).toHaveBeenCalledWith(key)`), and any method can
 *    be overridden per-test to force a failure
 *    (`storage.download.mockRejectedValueOnce(new Error("… HTTP 404 …"))`).
 *  - `getDownloadUrl` returns `${urlBase}${key}`; tests that assert on the URL
 *    string pass their own `urlBase`.
 */

import { vi } from "vitest";
import type { ArtifactStorage } from "../shared/artifact-storage.js";

/** An {@link ArtifactStorage} whose methods are `vi.fn` spies over a shared Map. */
export type InMemoryArtifactStorage = {
  [K in keyof ArtifactStorage]: ReturnType<typeof vi.fn>;
} & ArtifactStorage;

export interface InMemoryArtifactStorageOptions {
  /** Prefix for the URLs `getDownloadUrl` returns. Defaults to `mem://`. */
  readonly urlBase?: string;
}

export interface InMemoryArtifactStorageHandle {
  /** The storage double to inject; all methods are spy-able `vi.fn`s. */
  readonly storage: InMemoryArtifactStorage;
  /** The backing store — inspect or seed it directly in a test. */
  readonly blobs: Map<string, Buffer>;
}

/**
 * Build an in-memory {@link ArtifactStorage} backed by a shared `Map`.
 *
 * @example
 * const { storage, blobs } = makeInMemoryArtifactStorage();
 * await storage.upload("k", Buffer.from("hi"));
 * expect((await storage.download("k")).toString()).toBe("hi");
 */
export function makeInMemoryArtifactStorage(
  opts: InMemoryArtifactStorageOptions = {},
): InMemoryArtifactStorageHandle {
  const urlBase = opts.urlBase ?? "mem://";
  const blobs = new Map<string, Buffer>();

  const storage = {
    upload: vi.fn(async (key: string, content: Buffer, _contentType?: string) => {
      blobs.set(key, Buffer.from(content));
      return key;
    }),
    getDownloadUrl: vi.fn(async (key: string) => `${urlBase}${key}`),
    download: vi.fn(async (key: string) => {
      const b = blobs.get(key);
      if (!b) throw new Error(`Artifact not found for key '${key}'`);
      return Buffer.from(b);
    }),
    exists: vi.fn(async (key: string) => blobs.has(key)),
  } as InMemoryArtifactStorage;

  return { storage, blobs };
}
