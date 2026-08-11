/**
 * Temporal PayloadCodec that encrypts payloads at rest in workflow
 * history (stigmer-cloud#227).
 *
 * Why: the workflow engine runs inside the Temporal deterministic
 * sandbox, so decrypted execution-context values cross the history
 * boundary in many places — the hydrate activity result, the runtime
 * env passed as an input to every per-task activity, and expression
 * results recorded as local-activity markers. Encrypting at the payload
 * codec layer closes the entire class with one mechanism instead of
 * chasing each crossing.
 *
 * Envelope (cross-SDK contract — the Java decode-only codec in
 * stigmer-cloud's temporal-starter must match it byte-for-byte, pinned
 * by the conformance fixture in __tests__/fixtures/):
 *
 *   metadata: encoding            = "binary/encrypted"
 *             encryption-key-id   = <key id that encrypted this payload>
 *   data:     iv (12 bytes) ‖ AES-256-GCM(ciphertext ‖ tag (16 bytes))
 *
 * The plaintext is the serialized ORIGINAL Payload proto (metadata AND
 * data), so decode restores the payload exactly — including its
 * original encoding — with no side channel.
 *
 * Decode passes through payloads it did not encode. This is what keeps
 * plaintext signals from the Java/Go orchestrators and pre-rollout
 * in-flight histories working with zero migration. Everything else
 * fails closed: unknown key id, missing key id, and ciphertext tampering
 * all throw rather than surfacing bogus payloads.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Payload, PayloadCodec } from "@temporalio/common";
import { temporal } from "@temporalio/proto";
import type { EncryptionKey, PayloadEncryptionConfig } from "./config.js";

const ENCODING_METADATA_KEY = "encoding";
const ENCRYPTED_ENCODING_VALUE = "binary/encrypted";
const KEY_ID_METADATA_KEY = "encryption-key-id";

/** AES-GCM parameters shared with the Java implementation. */
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export class EncryptionPayloadCodec implements PayloadCodec {
  private readonly decryptKeysById: Map<string, Buffer>;

  constructor(private readonly config: PayloadEncryptionConfig) {
    this.decryptKeysById = new Map([[config.primary.keyId, config.primary.key]]);
    if (config.secondary) {
      this.decryptKeysById.set(config.secondary.keyId, config.secondary.key);
    }
  }

  async encode(payloads: Payload[]): Promise<Payload[]> {
    return payloads.map((p) => this.encodePayload(p));
  }

  async decode(payloads: Payload[]): Promise<Payload[]> {
    return payloads.map((p) => this.decodePayload(p));
  }

  private encodePayload(payload: Payload): Payload {
    // Data-less payloads (binary/null from void results) stay as-is:
    // there is nothing to protect, and the cross-language parents that
    // await our workflows as void must be able to read them without a key.
    if (!payload.data || payload.data.length === 0) {
      return payload;
    }

    const plaintext = temporal.api.common.v1.Payload.encode(payload).finish();
    return {
      metadata: {
        [ENCODING_METADATA_KEY]: Buffer.from(ENCRYPTED_ENCODING_VALUE),
        [KEY_ID_METADATA_KEY]: Buffer.from(this.config.primary.keyId),
      },
      data: encrypt(plaintext, this.config.primary),
    };
  }

  private decodePayload(payload: Payload): Payload {
    if (!isEncryptedPayload(payload)) {
      return payload;
    }

    const keyIdBytes = payload.metadata?.[KEY_ID_METADATA_KEY];
    if (!keyIdBytes) {
      throw new Error(
        "Encrypted payload is missing its encryption-key-id metadata — refusing to decode",
      );
    }
    const keyId = Buffer.from(keyIdBytes).toString("utf-8");
    const key = this.decryptKeysById.get(keyId);
    if (!key) {
      throw new Error(
        `Encrypted payload uses unknown key id '${keyId}' — configure it as the ` +
          `primary or secondary payload encryption key (rotation window?)`,
      );
    }

    const plaintext = decrypt(payload.data!, key, keyId);
    return temporal.api.common.v1.Payload.decode(plaintext);
  }
}

function isEncryptedPayload(payload: Payload): boolean {
  const encoding = payload.metadata?.[ENCODING_METADATA_KEY];
  if (!encoding) return false;
  return Buffer.from(encoding).toString("utf-8") === ENCRYPTED_ENCODING_VALUE;
}

function encrypt(plaintext: Uint8Array, key: EncryptionKey): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  // Layout iv ‖ ciphertext ‖ tag matches Java's AES/GCM/NoPadding, whose
  // doFinal() output is ciphertext ‖ tag.
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]);
}

function decrypt(data: Uint8Array, key: Buffer, keyId: string): Buffer {
  if (data.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error(
      `Encrypted payload under key id '${keyId}' is truncated (${data.length} bytes)`,
    );
  }
  const buf = Buffer.from(data);
  const iv = buf.subarray(0, IV_BYTES);
  const ciphertext = buf.subarray(IV_BYTES, buf.length - AUTH_TAG_BYTES);
  const tag = buf.subarray(buf.length - AUTH_TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM auth failure: tampered ciphertext or a key that does not match
    // its advertised id. Never surface partially decrypted bytes.
    throw new Error(
      `Failed to decrypt payload under key id '${keyId}' — ciphertext is ` +
        `corrupt or the configured key does not match`,
    );
  }
}
