/**
 * The blob-store contract the claim-check codec needs — nothing more.
 *
 * Deliberately minimal (upload + download by key) so any consumer's
 * storage client satisfies it structurally: the runner's ArtifactStorage
 * (a richer interface with presigned-URL minting) matches as-is, and the
 * TS server brings its own. Widening this port widens the wire contract's
 * dependency surface for every consumer — do not add methods the codec
 * itself does not call.
 */
export interface ClaimcheckStorage {
  /** Store `content` under `key`; resolves once the blob is durable. */
  upload(key: string, content: Buffer, contentType?: string): Promise<string>;
  /**
   * Return the exact bytes stored under `key`, or throw a descriptive,
   * key-scoped `Error` when the object is missing or the transport fails.
   */
  download(key: string): Promise<Buffer>;
}
