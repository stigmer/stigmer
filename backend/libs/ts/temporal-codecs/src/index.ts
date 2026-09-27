/**
 * @stigmer/temporal-codecs — the Temporal plumbing Stigmer's TypeScript
 * Temporal processes (the server and the runner) share: payload codecs,
 * and the connection-security settings every Temporal connection reads
 * (`connection/config.ts`). The encryption envelope is a cross-language
 * wire contract (the Java decode-only codec in stigmer-cloud's
 * temporal-starter must match it byte-for-byte, pinned by the fixture in
 * src/__tests__/fixtures/), and the connection settings must mean the same
 * on every connection, which is why both live in one library instead of
 * per-consumer copies that could fork.
 *
 * This is the package's ONLY public boundary. Codec order at the consumer
 * is a correctness property: install [encryption, claimcheck] so encode
 * encrypts before relocating (object storage only ever sees ciphertext)
 * and decode restores the blob before decrypting.
 *
 * Dependency policy: @temporalio/common and @temporalio/proto are pinned
 * exact and identical to the runner's pins, bumped in lockstep with it —
 * the runner's consumer-install gate (stigmer#786) fails any version mix
 * because a split @temporalio/proto tree registers the core-sdk protobuf
 * namespace twice and crashes worker init.
 */

export { EncryptionPayloadCodec } from "./encryption/payload-codec.js";
export { loadPayloadEncryptionConfig } from "./encryption/config.js";
export type {
  BootstrapKeyMaterial,
  EncryptionKey,
  PayloadEncryptionConfig,
  PayloadKeyResolver,
  SecretReader,
} from "./encryption/config.js";

export {
  loadTemporalConnectionConfig,
  temporalConnectionEnv,
  TEMPORAL_API_KEY_ENV,
  TEMPORAL_CONNECTION_ENV_NAMES,
  TEMPORAL_TLS_CLIENT_KEY_DATA_ENV,
} from "./connection/config.js";
export type {
  TemporalConnectionConfig,
  TemporalTls,
} from "./connection/config.js";

export { ClaimcheckPayloadCodec } from "./claimcheck/payload-codec.js";
export { loadClaimcheckConfig } from "./claimcheck/config.js";
export type { ClaimcheckConfig } from "./claimcheck/config.js";
export type { ClaimcheckStorage } from "./claimcheck/storage.js";
