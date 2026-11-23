/**
 * One string sealed inside an otherwise readable Temporal payload.
 *
 * Why: a server's own workflow inputs stay readable in Temporal's UI (its
 * codec's encode is the identity), but a turn that runs on a runner shared
 * by many organizations carries a credential that acts for the turn's
 * person. That one value is sealed; everything around it stays readable.
 *
 * Format (wire contract, read by the runner, written by the server): the
 * value is a Temporal `json/plain` payload of the string, encoded by the
 * SAME `EncryptionPayloadCodec` that encrypts payloads at rest (AES-256-GCM,
 * the key id in the envelope's metadata, the envelope pinned by the
 * fixture in __tests__/fixtures/), serialized as a `Payload` proto and
 * written as standard base64. So a seal is opened by any process that holds
 * the key the seal names, and by no other: no new cryptography, no new key.
 *
 * Opening fails closed. A value that is not base64 of a payload, a payload
 * the codec did not encrypt (a seal must never be readable without a key),
 * an unknown key id, tampering, and a sealed payload that is not a JSON
 * string all throw, never answer a bogus credential.
 */
import type { Payload, PayloadCodec } from "@temporalio/common";
// Default-import + destructure: see payload-codec.ts (CommonJS interop).
import proto from "@temporalio/proto";

const { temporal } = proto;

const ENCODING_METADATA_KEY = "encoding";
const ENCRYPTED_ENCODING_VALUE = "binary/encrypted";
const JSON_ENCODING_VALUE = "json/plain";

/** Seals `value` with the codec's primary key (module header). */
export async function sealString(codec: PayloadCodec, value: string): Promise<string> {
  const plain: Payload = {
    metadata: { [ENCODING_METADATA_KEY]: Buffer.from(JSON_ENCODING_VALUE) },
    data: Buffer.from(JSON.stringify(value)),
  };
  const [sealed] = await codec.encode([plain]);
  if (sealed === undefined || encodingOf(sealed) !== ENCRYPTED_ENCODING_VALUE) {
    throw new Error("The payload codec did not encrypt the value; refusing to seal it in the clear");
  }
  return Buffer.from(temporal.api.common.v1.Payload.encode(sealed).finish()).toString("base64");
}

/** Opens a value `sealString` sealed; throws on anything else (module header). */
export async function openSealedString(codec: PayloadCodec, sealed: string): Promise<string> {
  let envelope: Payload;
  try {
    envelope = temporal.api.common.v1.Payload.decode(Buffer.from(sealed, "base64"));
  } catch {
    throw new Error("The sealed value is not a sealed payload");
  }
  if (encodingOf(envelope) !== ENCRYPTED_ENCODING_VALUE) {
    throw new Error("The sealed value is not encrypted; refusing to read it");
  }
  const [opened] = await codec.decode([envelope]);
  if (opened === undefined || encodingOf(opened) !== JSON_ENCODING_VALUE || opened.data === undefined || opened.data === null) {
    throw new Error("The sealed value does not hold a JSON payload");
  }
  const value: unknown = JSON.parse(Buffer.from(opened.data).toString("utf-8"));
  if (typeof value !== "string") {
    throw new Error("The sealed value does not hold a string");
  }
  return value;
}

function encodingOf(payload: Payload): string | undefined {
  const bytes = payload.metadata?.[ENCODING_METADATA_KEY];
  return bytes ? Buffer.from(bytes).toString("utf-8") : undefined;
}
