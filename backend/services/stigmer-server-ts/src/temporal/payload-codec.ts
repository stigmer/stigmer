/**
 * Decode-only Temporal payload codec — ports
 * pkg/encryption/payloadcodec (Go DecryptionCodec; stigmer-cloud#227,
 * stigmer#398).
 *
 * The runner encrypts its Temporal payloads (activity results, workflow
 * results) under STIGMER_PAYLOAD_ENCRYPTION_KEY. The server must DECRYPT
 * those payloads when it reads them — but its own payloads (workflow
 * inputs, signals, its activities' results) stay plaintext, so encode is
 * the identity. Installing the codec on the client at dial time is the
 * single choke point that covers every worker and every client-side read,
 * exactly the Go shape (temporal_manager.go dialTemporal).
 *
 * @stigmer/temporal-codecs exports only the SYMMETRIC EncryptionPayloadCodec
 * (the runner encrypts with it). This wrapper delegates decode to it and
 * passes encode through untouched — the decode path only ever consults the
 * codec's accepted-keys set, so a symmetric inner codec is safe to hold.
 * Ratified decision (sub-project 20260824.03 plan, brief #1): a server-local
 * wrapper mirrors Go's server-local DecryptionCodec; the published lib stays
 * untouched.
 *
 * Enabled-iff-configured: no key in the environment means the codec is not
 * installed at all; a present-but-malformed key is a boot error (an operator
 * who set the key intended runner history to be encrypted — failing on the
 * first runner payload read would be strictly worse than failing the boot).
 */
import type { Payload, PayloadCodec } from "@temporalio/common";
import {
  EncryptionPayloadCodec,
  loadPayloadEncryptionConfig,
} from "@stigmer/temporal-codecs";

export class ServerDecryptionPayloadCodec implements PayloadCodec {
  constructor(private readonly inner: EncryptionPayloadCodec) {}

  /**
   * Identity: the server never encrypts its own payloads, so its workflow
   * histories stay readable in the Temporal UI (Go DecryptionCodec.Encode).
   */
  async encode(payloads: Payload[]): Promise<Payload[]> {
    return payloads;
  }

  /**
   * Delegates to the shared codec: payloads the runner encrypted are
   * decrypted (unknown/missing key ids and tampering fail closed);
   * payloads nobody encrypted pass through untouched.
   */
  async decode(payloads: Payload[]): Promise<Payload[]> {
    return this.inner.decode(payloads);
  }
}

/**
 * Loads the server's payload codecs from the environment.
 *
 * Returns [] when payload encryption is not configured — the caller then
 * installs no dataConverter, matching Go's "codec not installed" posture.
 * Reads process.env directly (no injectable env): the lib's SecretReader
 * seam exists for the runner's boot-capture credential custody
 * (stigmer#508 — agent shells inherit its process env), but the lib reads
 * the *_KEY_ID companions from process.env unconditionally, so a partial
 * env override here would be honored for values and ignored for ids — a
 * trap. The server runs no agent shells; plain env reads are its custody
 * policy, the same source Go's LoadConfigFromEnv reads.
 *
 * @throws when a key is present but malformed or missing its id (boot
 *   error, never a silent plaintext downgrade).
 */
export function loadServerPayloadCodecs(): PayloadCodec[] {
  const config = loadPayloadEncryptionConfig((name) => process.env[name]);
  if (config === undefined) {
    return [];
  }
  return [new ServerDecryptionPayloadCodec(new EncryptionPayloadCodec(config))];
}
