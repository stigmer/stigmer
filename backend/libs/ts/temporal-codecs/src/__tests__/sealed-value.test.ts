/**
 * The sealed string: one value encrypted inside a readable payload
 * (encryption/sealed-value.ts). Pins that a seal round-trips under the key
 * it names, opens under a codec that holds that key as its secondary, and
 * fails closed on every other input: another key, tampering, bytes that
 * are no payload, a plaintext payload passed off as a seal, a sealed
 * payload that is not JSON, a non-string, and a codec that would not
 * encrypt.
 */
import { randomBytes } from "node:crypto";

import type { Payload, PayloadCodec } from "@temporalio/common";
import proto from "@temporalio/proto";
import { describe, expect, it } from "vitest";

import { EncryptionPayloadCodec } from "../encryption/payload-codec.js";
import { openSealedString, sealString } from "../encryption/sealed-value.js";

const { temporal } = proto;

function codec(keyId = "k1", key = randomBytes(32)): EncryptionPayloadCodec {
  return new EncryptionPayloadCodec({ primary: { keyId, key } });
}

describe("sealed string", () => {
  it("round-trips under the same key and never carries the value in the clear", async () => {
    const c = codec();
    const sealed = await sealString(c, "run-credential-xyz");
    expect(Buffer.from(sealed, "base64").toString("latin1")).not.toContain("run-credential-xyz");
    expect(await openSealedString(c, sealed)).toBe("run-credential-xyz");
  });

  it("opens under a codec holding the sealing key as its secondary (rotation)", async () => {
    const oldKey = randomBytes(32);
    const sealed = await sealString(codec("old", oldKey), "v");
    const rotated = new EncryptionPayloadCodec({
      primary: { keyId: "new", key: randomBytes(32) },
      secondary: { keyId: "old", key: oldKey },
    });
    expect(await openSealedString(rotated, sealed)).toBe("v");
  });

  it("refuses a seal made under another key", async () => {
    const sealed = await sealString(codec("k1"), "v");
    await expect(openSealedString(codec("k2"), sealed)).rejects.toThrow(/unknown key id 'k1'/);
    await expect(openSealedString(codec("k1"), sealed)).rejects.toThrow(/Failed to decrypt/);
  });

  it("refuses a tampered seal", async () => {
    const c = codec();
    const bytes = Buffer.from(await sealString(c, "v"), "base64");
    bytes[bytes.length - 1] ^= 0xff;
    await expect(openSealedString(c, bytes.toString("base64"))).rejects.toThrow();
  });

  it("refuses a plaintext payload passed off as a seal", async () => {
    const plain: Payload = { metadata: { encoding: Buffer.from("json/plain") }, data: Buffer.from('"v"') };
    const forged = Buffer.from(temporal.api.common.v1.Payload.encode(plain).finish()).toString("base64");
    await expect(openSealedString(codec(), forged)).rejects.toThrow(/not encrypted/);
  });

  it("refuses a value that is not base64 of a payload", async () => {
    // A length-delimited field (tag 0x0a) claiming 5 bytes, then none.
    const truncated = Buffer.from([0x0a, 0x05]).toString("base64");
    await expect(openSealedString(codec(), truncated)).rejects.toThrow("The sealed value is not a sealed payload");
  });

  it("refuses a seal whose payload is not a JSON one", async () => {
    const c = codec();
    const [encrypted] = await c.encode([{ metadata: { encoding: Buffer.from("binary/plain") }, data: Buffer.from("v") }]);
    const sealed = Buffer.from(temporal.api.common.v1.Payload.encode(encrypted!).finish()).toString("base64");
    await expect(openSealedString(c, sealed)).rejects.toThrow("The sealed value does not hold a JSON payload");
  });

  it("refuses a seal that holds no string", async () => {
    const c = codec();
    const [encrypted] = await c.encode([{ metadata: { encoding: Buffer.from("json/plain") }, data: Buffer.from("42") }]);
    const sealed = Buffer.from(temporal.api.common.v1.Payload.encode(encrypted!).finish()).toString("base64");
    await expect(openSealedString(c, sealed)).rejects.toThrow(/not hold a string/);
  });

  it("refuses to seal through a codec that does not encrypt", async () => {
    const identity: PayloadCodec = { encode: async (p) => p, decode: async (p) => p };
    await expect(sealString(identity, "v")).rejects.toThrow(/refusing to seal it in the clear/);
  });
});
