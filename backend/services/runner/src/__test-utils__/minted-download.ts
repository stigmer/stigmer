/**
 * The transfer lane's answer for a test that serves an archive without a
 * server: a mint stub resolves to a `data:` URL that holds the bytes, which
 * `fetch` reads with no network (the hermetic `fetch` stub,
 * `model-registry-fixture.ts`, lets `data:` through for that reason). So a
 * test drives the lane every server offers, mint then fetch, end to end.
 */

/** A `data:` URL holding `bytes`, and their size, as a mint answers them. */
export function mintedDownload(bytes: Uint8Array): { readonly url: string; readonly sizeBytes: bigint } {
  return {
    url: `data:application/zip;base64,${Buffer.from(bytes).toString("base64")}`,
    sizeBytes: BigInt(bytes.length),
  };
}
